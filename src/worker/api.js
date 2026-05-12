'use strict';

const db = require('./db');
const { dispatch } = require('./hooks');

function json(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 10_000_000) reject(new Error('too large')); });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

async function handleHook(req, res) {
  const body = await parseBody(req);
  const eventType = body.event_type || body.hook_event_name || req.url.split('/').pop();
  const type = body.vis_event_type || eventType;
  dispatch(type, body.payload || body);
  json(res, { ok: true });
}

function handlePing(req, res) {
  json(res, { ok: true, timestamp: Date.now() });
}

function handleListSessions(req, res) {
  json(res, db.listSessions());
}

function handleGetSession(req, res, session_id) {
  const session = db.getSession(session_id);
  if (!session) return json(res, { error: 'not found' }, 404);
  json(res, session);
}

function handleGetGraph(req, res, session_id) {
  json(res, db.getGraphData(session_id));
}

function handleGetActivity(req, res, session_id) {
  const url = new URL(req.url, 'http://localhost');
  const limit = parseInt(url.searchParams.get('limit') || '200', 10);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  json(res, db.getActivityLog(session_id, limit, offset));
}

function handleGetTokens(req, res, session_id) {
  json(res, db.getTokenBreakdown(session_id));
}

function handleStats(req, res) {
  const sessions = db.listSessions();
  const active = sessions.filter(s => s.status === 'active').length;
  const rss = process.memoryUsage().rss;
  json(res, { total_sessions: sessions.length, active_sessions: active, worker_rss_bytes: rss });
}

module.exports = {
  handleHook,
  handlePing,
  handleListSessions,
  handleGetSession,
  handleGetGraph,
  handleGetActivity,
  handleGetTokens,
  handleStats,
};
