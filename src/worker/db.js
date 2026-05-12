'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const DATA_DIR = process.env.CLAUDE_VIS_DATA_DIR || path.join(os.homedir(), '.claude-visualiser');
const DB_PATH = path.join(DATA_DIR, 'data.db');

let db = null;

function getDb() {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // bun:sqlite is Bun's built-in SQLite — no native addon needed
  const { Database } = require('bun:sqlite');

  db = new Database(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  initSchema(db);
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id   TEXT PRIMARY KEY,
      project_name TEXT,
      cwd          TEXT,
      status       TEXT NOT NULL DEFAULT 'active',
      started_at   INTEGER NOT NULL,
      last_activity INTEGER NOT NULL,
      context_summary TEXT
    );

    CREATE TABLE IF NOT EXISTS agents (
      agent_id    TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL REFERENCES sessions(session_id),
      parent_id   TEXT,
      status      TEXT NOT NULL DEFAULT 'active',
      started_at  INTEGER NOT NULL,
      ended_at    INTEGER
    );

    CREATE TABLE IF NOT EXISTS tool_calls (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  TEXT NOT NULL,
      agent_id    TEXT NOT NULL,
      tool_name   TEXT NOT NULL,
      duration_ms INTEGER,
      input_bytes INTEGER,
      output_bytes INTEGER,
      timestamp   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS token_usage (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id       TEXT NOT NULL,
      agent_id         TEXT NOT NULL,
      prompt_tokens    INTEGER,
      completion_tokens INTEGER,
      timestamp        INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_ts ON tool_calls(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_agents_session ON agents(session_id);
    CREATE INDEX IF NOT EXISTS idx_token_session ON token_usage(session_id);
  `);
}

// Sessions
function upsertSession({ session_id, project_name, cwd, started_at }) {
  const db = getDb();
  const now = Date.now();
  db.prepare(`
    INSERT INTO sessions (session_id, project_name, cwd, status, started_at, last_activity)
    VALUES (?, ?, ?, 'active', ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      last_activity = excluded.last_activity,
      status = 'active'
  `).run(session_id, project_name, cwd, started_at ?? now, now);
}

function touchSession(session_id) {
  getDb().prepare(
    `UPDATE sessions SET last_activity = ?, status = 'active' WHERE session_id = ?`
  ).run(Date.now(), session_id);
}

function markSessionIdle(session_id) {
  getDb().prepare(
    `UPDATE sessions SET status = 'idle', last_activity = ? WHERE session_id = ?`
  ).run(Date.now(), session_id);
}

function updateContextSummary(session_id, summary) {
  getDb().prepare(
    `UPDATE sessions SET context_summary = ? WHERE session_id = ?`
  ).run(summary, session_id);
}

function listSessions() {
  return getDb().prepare(`
    SELECT s.*,
      COALESCE(t.total_prompt_tokens, 0)     AS total_prompt_tokens,
      COALESCE(t.total_completion_tokens, 0) AS total_completion_tokens,
      COALESCE(tc.total_tool_calls, 0)       AS total_tool_calls
    FROM sessions s
    LEFT JOIN (
      SELECT session_id,
        SUM(prompt_tokens)     AS total_prompt_tokens,
        SUM(completion_tokens) AS total_completion_tokens
      FROM token_usage GROUP BY session_id
    ) t ON t.session_id = s.session_id
    LEFT JOIN (
      SELECT session_id, COUNT(*) AS total_tool_calls
      FROM tool_calls GROUP BY session_id
    ) tc ON tc.session_id = s.session_id
    ORDER BY s.last_activity DESC
  `).all();
}

function getSession(session_id) {
  return getDb().prepare(`SELECT * FROM sessions WHERE session_id = ?`).get(session_id);
}

// Agents
function upsertAgent({ agent_id, session_id, parent_id, started_at }) {
  getDb().prepare(`
    INSERT INTO agents (agent_id, session_id, parent_id, status, started_at)
    VALUES (?, ?, ?, 'active', ?)
    ON CONFLICT(agent_id) DO NOTHING
  `).run(agent_id, session_id, parent_id ?? null, started_at ?? Date.now());
}

function markAgentEnded(agent_id) {
  getDb().prepare(
    `UPDATE agents SET status = 'ended', ended_at = ? WHERE agent_id = ?`
  ).run(Date.now(), agent_id);
}

function getAgentsBySession(session_id) {
  return getDb().prepare(`SELECT * FROM agents WHERE session_id = ? ORDER BY started_at ASC`).all(session_id);
}

// Tool calls
function insertToolCall({ session_id, agent_id, tool_name, duration_ms, input_bytes, output_bytes }) {
  return getDb().prepare(`
    INSERT INTO tool_calls (session_id, agent_id, tool_name, duration_ms, input_bytes, output_bytes, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(session_id, agent_id, tool_name, duration_ms ?? null, input_bytes ?? 0, output_bytes ?? 0, Date.now());
}

function getActivityLog(session_id, limit = 200, offset = 0) {
  return getDb().prepare(`
    SELECT * FROM tool_calls WHERE session_id = ?
    ORDER BY timestamp DESC LIMIT ? OFFSET ?
  `).all(session_id, limit, offset);
}

// Graph data
function getGraphData(session_id) {
  const agents = getAgentsBySession(session_id);
  const tools = getDb().prepare(`
    SELECT agent_id, tool_name, COUNT(*) as call_count, SUM(duration_ms) as total_ms
    FROM tool_calls WHERE session_id = ?
    GROUP BY agent_id, tool_name
  `).all(session_id);

  const nodes = [];
  const edges = [];

  for (const a of agents) {
    nodes.push({
      id: a.agent_id,
      type: a.parent_id ? 'subagent' : 'main',
      label: a.agent_id,
      status: a.status,
    });
    if (a.parent_id) {
      edges.push({ source: a.parent_id, target: a.agent_id, type: 'spawned' });
    }
  }

  const toolNodeIds = new Set();
  for (const t of tools) {
    const isMcp = t.tool_name.startsWith('mcp__');
    const isSkill = t.tool_name.startsWith('skill__') || t.tool_name.includes(':');
    const nodeType = isMcp ? 'mcp' : isSkill ? 'skill' : 'tool';
    const nodeId = `tool:${t.agent_id}:${t.tool_name}`;
    if (!toolNodeIds.has(nodeId)) {
      toolNodeIds.add(nodeId);
      nodes.push({ id: nodeId, type: nodeType, label: t.tool_name, callCount: t.call_count, totalMs: t.total_ms });
    }
    edges.push({ source: t.agent_id, target: nodeId, type: 'tool_call', callCount: t.call_count });
  }

  return { nodes, edges };
}

// Token usage
function insertTokenUsage({ session_id, agent_id, prompt_tokens, completion_tokens }) {
  getDb().prepare(`
    INSERT INTO token_usage (session_id, agent_id, prompt_tokens, completion_tokens, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `).run(session_id, agent_id, prompt_tokens ?? 0, completion_tokens ?? 0, Date.now());
}

function getTokenBreakdown(session_id) {
  return getDb().prepare(`
    SELECT agent_id,
      SUM(prompt_tokens)     AS prompt_tokens,
      SUM(completion_tokens) AS completion_tokens
    FROM token_usage WHERE session_id = ?
    GROUP BY agent_id
  `).all(session_id);
}

module.exports = {
  getDb,
  upsertSession, touchSession, markSessionIdle, updateContextSummary,
  listSessions, getSession,
  upsertAgent, markAgentEnded, getAgentsBySession,
  insertToolCall, getActivityLog,
  getGraphData,
  insertTokenUsage, getTokenBreakdown,
};
