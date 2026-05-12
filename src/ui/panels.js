// ── Sessions Panel ────────────────────────────────────────────────────────────

export function renderSessionsList(sessions, currentId, onSelect) {
  const list = document.getElementById('sessions-list');
  if (!list) return;
  list.innerHTML = '';

  const filter = document.getElementById('session-search')?.value?.toLowerCase() || '';
  const filtered = sessions.filter(s =>
    !filter || s.project_name?.toLowerCase().includes(filter) || s.session_id.includes(filter)
  );

  if (filtered.length === 0) {
    list.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:12px;">No sessions yet</div>';
    return;
  }

  for (const s of filtered) {
    const el = document.createElement('div');
    el.className = 'session-item' + (s.session_id === currentId ? ' active' : '');
    const dotClass = s.status === 'active' ? 'session-live-dot' : 'session-idle-dot';
    const tokens = (s.total_prompt_tokens || 0) + (s.total_completion_tokens || 0);
    el.innerHTML = `
      <div class="session-item-name">
        <span class="${dotClass}"></span>
        ${escHtml(s.project_name || 'unknown')}
      </div>
      <div class="session-meta">
        ${s.total_tool_calls || 0} calls · ${formatTokens(tokens)}
      </div>`;
    el.addEventListener('click', () => onSelect(s.session_id));
    list.appendChild(el);
  }
}

// ── Activity Log ─────────────────────────────────────────────────────────────

export function renderActivityLog(rows) {
  const wrap = document.getElementById('activity-table-body');
  if (!wrap) return;
  wrap.innerHTML = '';

  for (const row of rows.slice(0, 300)) {
    const tr = document.createElement('tr');
    const isSubagent = !row.agent_id.startsWith('main:');
    tr.className = isSubagent ? 'row-subagent' : 'row-main';
    const toolClass = row.tool_name.startsWith('mcp__') ? 'tool-mcp' : row.tool_name.includes(':') ? 'tool-skill' : '';
    tr.innerHTML = `
      <td>${formatTime(row.timestamp)}</td>
      <td><span class="${toolClass}">${escHtml(row.tool_name)}</span></td>
      <td style="color:var(--text-muted)">${escHtml(shortId(row.agent_id))}</td>
      <td>${row.duration_ms != null ? `<span class="duration-pill">${row.duration_ms}ms</span>` : ''}</td>
      <td style="color:var(--text-muted)">${formatBytes(row.output_bytes)}</td>`;
    wrap.appendChild(tr);
  }
}

export function prependActivityRow(row) {
  const wrap = document.getElementById('activity-table-body');
  if (!wrap) return;
  const tr = document.createElement('tr');
  const isSubagent = !row.agent_id.startsWith('main:');
  tr.className = (isSubagent ? 'row-subagent' : 'row-main') + ' row-new';
  const toolClass = row.tool_name.startsWith('mcp__') ? 'tool-mcp' : row.tool_name.includes(':') ? 'tool-skill' : '';
  tr.innerHTML = `
    <td>${formatTime(row.timestamp)}</td>
    <td><span class="${toolClass}">${escHtml(row.tool_name)}</span></td>
    <td style="color:var(--text-muted)">${escHtml(shortId(row.agent_id))}</td>
    <td>${row.duration_ms != null ? `<span class="duration-pill">${row.duration_ms}ms</span>` : ''}</td>
    <td style="color:var(--text-muted)">${formatBytes(row.output_bytes)}</td>`;
  wrap.insertBefore(tr, wrap.firstChild);
  while (wrap.children.length > 300) wrap.removeChild(wrap.lastChild);
}

// ── Stats Panel ───────────────────────────────────────────────────────────────

export function renderStats(session, tokenBreakdown, statsData) {
  if (!session) {
    document.getElementById('stats-panel').innerHTML = '<div class="stat-section" style="color:var(--text-muted);font-size:12px;">Select a session</div>';
    return;
  }

  const totalPrompt = tokenBreakdown.reduce((s, r) => s + (r.prompt_tokens || 0), 0);
  const totalComp   = tokenBreakdown.reduce((s, r) => s + (r.completion_tokens || 0), 0);

  const panel = document.getElementById('stats-panel');
  panel.innerHTML = `
    <div class="stat-section">
      <div class="stat-section-title">Token Usage</div>
      <div class="donut-wrap">
        ${renderDonut(totalPrompt, totalComp)}
        <div class="donut-legend">
          <div class="legend-item"><span class="legend-dot" style="background:#58a6ff"></span>Prompt: ${formatTokens(totalPrompt)}</div>
          <div class="legend-item"><span class="legend-dot" style="background:#a371f7"></span>Output: ${formatTokens(totalComp)}</div>
        </div>
      </div>
    </div>
    <div class="stat-section">
      <div class="stat-section-title">Session</div>
      <div class="stat-row"><span class="stat-label">Status</span><span class="stat-value">${session.status}</span></div>
      <div class="stat-row"><span class="stat-label">Tool calls</span><span class="stat-value">${session.total_tool_calls || 0}</span></div>
      <div class="stat-row"><span class="stat-label">Worker RSS</span><span class="stat-value">${statsData ? formatBytes(statsData.worker_rss_bytes) : '—'}</span></div>
    </div>
    <div class="stat-section">
      <div class="stat-section-title">Context</div>
      <div class="context-summary">${escHtml(session.context_summary || 'No prompt captured yet')}</div>
    </div>
    <div class="stat-section">
      <div class="stat-section-title">Settings</div>
      ${renderToggle('auto-open', 'Auto-open browser')}
      ${renderToggle('verbose-log', 'Verbose logging')}
    </div>`;
}

function renderDonut(prompt, completion) {
  const total = prompt + completion || 1;
  const promptPct = (prompt / total) * 100;
  const r = 28; const circ = 2 * Math.PI * r;
  const promptDash = (promptPct / 100) * circ;
  return `<svg width="72" height="72" viewBox="0 0 72 72">
    <circle cx="36" cy="36" r="${r}" fill="none" stroke="var(--border)" stroke-width="10"/>
    <circle cx="36" cy="36" r="${r}" fill="none" stroke="#a371f7" stroke-width="10"
      stroke-dasharray="${circ}" stroke-dashoffset="0" transform="rotate(-90 36 36)"/>
    <circle cx="36" cy="36" r="${r}" fill="none" stroke="#58a6ff" stroke-width="10"
      stroke-dasharray="${promptDash} ${circ - promptDash}" stroke-dashoffset="0" transform="rotate(-90 36 36)"/>
  </svg>`;
}

function renderToggle(id, label) {
  return `<div class="toggle-row">
    <span class="toggle-label">${label}</span>
    <label class="toggle"><input type="checkbox" id="toggle-${id}"><span class="toggle-track"></span></label>
  </div>`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-GB', { hour12: false });
}

function formatTokens(n) {
  if (!n) return '0';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function formatBytes(n) {
  if (!n) return '';
  if (n >= 1024) return (n / 1024).toFixed(1) + 'k';
  return n + 'b';
}

function shortId(id) {
  if (id.startsWith('main:')) return 'main';
  return id.slice(0, 12);
}
