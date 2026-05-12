'use strict';

const fs = require('fs');
const db = require('./db');
const { broadcast } = require('./ws');

function deriveProjectName(cwd) {
  if (!cwd) return 'unknown';
  return cwd.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'unknown';
}

function ensureSession(payload) {
  const session_id = payload.session_id;
  if (!session_id) return null;
  const cwd = payload.cwd || '';
  const project_name = deriveProjectName(cwd);
  db.upsertSession({ session_id, project_name, cwd, started_at: Date.now() });
  const mainAgentId = `main:${session_id}`;
  db.upsertAgent({ agent_id: mainAgentId, session_id, parent_id: null });
  return { session_id, project_name, main_agent_id: mainAgentId };
}

function handleSessionStart(payload) {
  const ctx = ensureSession(payload);
  if (!ctx) return;
  broadcast({
    type: 'session_start',
    session_id: ctx.session_id,
    project_name: ctx.project_name,
    timestamp: Date.now(),
  });
}

function handleUserPrompt(payload) {
  const session_id = payload.session_id;
  if (!session_id) return;
  const prompt = String(payload.prompt || payload.message || '').slice(0, 150);
  db.updateContextSummary(session_id, prompt);
  broadcast({ type: 'context_update', session_id, summary: prompt, timestamp: Date.now() });
}

function handleToolUse(payload) {
  const session_id = payload.session_id;
  if (!session_id) return;

  const tool_name = payload.tool_name || payload.tool || 'unknown';
  const agent_id = payload.agent_id || `main:${session_id}`;
  const duration_ms = payload.duration_ms ?? null;
  const input_bytes = payload.tool_input ? JSON.stringify(payload.tool_input).length : 0;
  const output_bytes = payload.tool_response ? JSON.stringify(payload.tool_response).length : 0;

  ensureSession(payload);
  db.touchSession(session_id);
  db.upsertAgent({ agent_id, session_id, parent_id: `main:${session_id}` === agent_id ? null : `main:${session_id}` });
  db.insertToolCall({ session_id, agent_id, tool_name, duration_ms, input_bytes, output_bytes });

  broadcast({
    type: 'tool_call',
    session_id,
    agent_id,
    tool_name,
    duration_ms,
    input_bytes,
    output_bytes,
    timestamp: Date.now(),
  });
}

function handleSessionStop(payload) {
  const session_id = payload.session_id;
  if (!session_id) return;
  db.markSessionIdle(session_id);

  const transcriptPath = payload.transcript_path;
  if (transcriptPath) {
    parseTranscriptAsync(transcriptPath, session_id, `main:${session_id}`);
  }

  broadcast({ type: 'session_end', session_id, timestamp: Date.now() });
}

function handleAgentStop(payload) {
  const agent_id = payload.agent_id;
  const session_id = payload.session_id;
  if (!agent_id || !session_id) return;

  db.markAgentEnded(agent_id);

  const transcriptPath = payload.transcript_path;
  if (transcriptPath) {
    parseTranscriptAsync(transcriptPath, session_id, agent_id);
  }

  broadcast({ type: 'agent_end', session_id, agent_id, timestamp: Date.now() });
}

function parseTranscriptAsync(transcriptPath, session_id, agent_id) {
  setImmediate(() => {
    try {
      const lines = fs.readFileSync(transcriptPath, 'utf-8').trim().split('\n');
      let prompt_tokens = 0;
      let completion_tokens = 0;
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.usage) {
            prompt_tokens += entry.usage.input_tokens ?? 0;
            completion_tokens += entry.usage.output_tokens ?? 0;
          }
        } catch {}
      }
      if (prompt_tokens > 0 || completion_tokens > 0) {
        db.insertTokenUsage({ session_id, agent_id, prompt_tokens, completion_tokens });
        broadcast({ type: 'tokens_updated', session_id, agent_id, prompt_tokens, completion_tokens, timestamp: Date.now() });
      }
    } catch {}
  });
}

function dispatch(eventType, payload) {
  try {
    switch (eventType) {
      case 'session-start': return handleSessionStart(payload);
      case 'user-prompt':   return handleUserPrompt(payload);
      case 'tool-use':      return handleToolUse(payload);
      case 'session-stop':  return handleSessionStop(payload);
      case 'agent-stop':    return handleAgentStop(payload);
    }
  } catch (err) {
    console.error(`[hooks] dispatch error for ${eventType}: ${err.message}`);
  }
}

module.exports = { dispatch };
