import './styles.css';
import { connect, onEvent } from './ws-client.js';
import { createGraph } from './graph.js';
import { renderSessionsList, renderActivityLog, prependActivityRow, renderStats } from './panels.js';

// ── DOM scaffold ──────────────────────────────────────────────────────────────

document.getElementById('app').innerHTML = `
  <div class="topbar">
    <span class="topbar-title">CLAUDE VISUALISER</span>
    <span class="topbar-meta" id="topbar-project">—</span>
    <span class="topbar-meta" id="topbar-sessions">0 sessions</span>
    <span class="topbar-meta"><span class="live-dot offline" id="live-dot"></span><span id="live-label">Connecting…</span></span>
  </div>
  <div class="main-layout">
    <div class="left-panel">
      <div class="panel-header">Sessions</div>
      <div class="session-search"><input id="session-search" placeholder="Filter by project…" /></div>
      <div class="sessions-list" id="sessions-list"></div>
    </div>
    <div class="center-panels">
      <div class="graph-panel" id="graph-panel">
        <div class="graph-empty" id="graph-empty">Select a session to view its agent graph</div>
      </div>
      <div class="activity-panel">
        <div class="panel-header">Activity Log</div>
        <div class="activity-table-wrap">
          <table class="activity">
            <thead><tr>
              <th>Time</th><th>Tool</th><th>Agent</th><th>Duration</th><th>Output</th>
            </tr></thead>
            <tbody id="activity-table-body"></tbody>
          </table>
        </div>
      </div>
    </div>
    <div class="right-panel" id="stats-panel">
      <div class="stat-section" style="color:var(--text-muted);font-size:12px;">Select a session</div>
    </div>
  </div>`;

// ── State ─────────────────────────────────────────────────────────────────────

let sessions = [];
let currentSessionId = null;
let graph = null;

// ── Graph init ────────────────────────────────────────────────────────────────

graph = createGraph(document.getElementById('graph-panel'));
graph.onNodeClick(node => {
  console.log('node clicked', node);
});

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchSessions() {
  try {
    const res = await fetch('/api/sessions');
    sessions = await res.json();
    const active = sessions.filter(s => s.status === 'active').length;
    document.getElementById('topbar-sessions').textContent = `${sessions.length} sessions (${active} active)`;
    renderSessionsList(sessions, currentSessionId, selectSession);
  } catch {}
}

async function loadSession(id) {
  try {
    const [graphRes, actRes, tokRes, sesRes] = await Promise.all([
      fetch(`/api/sessions/${id}/graph`),
      fetch(`/api/sessions/${id}/activity`),
      fetch(`/api/sessions/${id}/tokens`),
      fetch(`/api/sessions/${id}`),
    ]);
    const [graphData, activity, tokens, session] = await Promise.all([
      graphRes.json(), actRes.json(), tokRes.json(), sesRes.json(),
    ]);

    graph.setData(graphData);
    renderActivityLog(activity);
    document.getElementById('graph-empty').style.display = 'none';

    const statsRes = await fetch('/api/stats');
    const statsData = await statsRes.json();
    renderStats(session, tokens, statsData);

    const project = session.project_name || 'unknown';
    document.getElementById('topbar-project').textContent = `Project: ${project}`;
  } catch {}
}

function selectSession(id) {
  currentSessionId = id;
  renderSessionsList(sessions, currentSessionId, selectSession);
  loadSession(id);
}

// ── WebSocket events ───────────────────────────────────────────────────────────

onEvent(event => {
  const dot = document.getElementById('live-dot');
  const label = document.getElementById('live-label');

  switch (event.type) {
    case 'connected':
      dot.className = 'live-dot';
      label.textContent = 'Live';
      fetchSessions();
      break;

    case 'disconnected':
      dot.className = 'live-dot offline';
      label.textContent = 'Reconnecting…';
      break;

    case 'session_start':
      fetchSessions();
      break;

    case 'tool_call':
      fetchSessions();
      if (event.session_id === currentSessionId) {
        const nodeId = `tool:${event.agent_id}:${event.tool_name}`;
        const isMcp = event.tool_name.startsWith('mcp__');
        const isSkill = event.tool_name.includes(':');
        graph.addOrUpdateNode(
          { id: nodeId, type: isMcp ? 'mcp' : isSkill ? 'skill' : 'tool', label: event.tool_name },
          { source: event.agent_id, target: nodeId, type: 'tool_call' }
        );
        prependActivityRow({
          timestamp: event.timestamp,
          tool_name: event.tool_name,
          agent_id: event.agent_id,
          duration_ms: event.duration_ms,
          output_bytes: event.output_bytes,
        });
      }
      break;

    case 'tokens_updated':
      if (event.session_id === currentSessionId) {
        loadSession(currentSessionId);
      }
      break;

    case 'session_end':
      fetchSessions();
      break;
  }
});

// ── Search ────────────────────────────────────────────────────────────────────

document.getElementById('session-search').addEventListener('input', () => {
  renderSessionsList(sessions, currentSessionId, selectSession);
});

// ── Boot ──────────────────────────────────────────────────────────────────────

connect();
fetchSessions();
setInterval(fetchSessions, 10000);
