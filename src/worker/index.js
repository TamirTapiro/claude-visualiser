#!/usr/bin/env bun
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = process.env.CLAUDE_VIS_DATA_DIR || path.join(os.homedir(), '.claude-visualiser');
const PID_FILE = path.join(DATA_DIR, 'worker.pid');
const PORT = 37778;
const HOST = '127.0.0.1';

// ── MODE DETECTION ──────────────────────────────────────────────────────────
const mode = process.argv[2]; // 'hook' or undefined/start

if (mode === 'hook') {
  runHookClient();
} else {
  runServer();
}

// ── HOOK CLIENT MODE ─────────────────────────────────────────────────────────

async function runHookClient() {
  const eventType = process.argv[3] === 'claude-vis' ? process.argv[4] : process.argv[3];

  const stdinData = await readStdin();
  let payload = {};
  if (stdinData) {
    try { payload = JSON.parse(stdinData); } catch {}
  }

  const serverAlive = await pingServer();
  if (!serverAlive) {
    await startServerProcess();
    for (let i = 0; i < 15; i++) {
      await sleep(200);
      if (await pingServer()) break;
    }
  }

  try {
    await postHook({ vis_event_type: eventType, payload });
  } catch (err) {
    // Non-fatal: exit 0 always
  }

  process.exit(0);
}

function readStdin() {
  return new Promise(resolve => {
    if (process.stdin.isTTY) { resolve(null); return; }
    const chunks = [];
    process.stdin.on('data', c => chunks.push(c));
    const join = () => chunks.length > 0 ? Buffer.concat(chunks).toString('utf-8').replace(/^﻿/, '') : null;
    process.stdin.on('end', () => resolve(join()));
    process.stdin.on('error', () => resolve(null));
    setTimeout(() => { process.stdin.removeAllListeners(); resolve(join()); }, 3000);
  });
}

function pingServer() {
  return new Promise(resolve => {
    const req = http.get(`http://${HOST}:${PORT}/api/ping`, { timeout: 500 }, res => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function postHook(data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = http.request({
      hostname: HOST, port: PORT, path: '/hook',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 5000,
    }, res => { res.resume(); resolve(); });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

function startServerProcess() {
  const { spawn } = require('child_process');
  const wrapperPath = path.join(__dirname, 'worker-wrapper.cjs');
  const target = fs.existsSync(wrapperPath) ? wrapperPath : __filename;
  const child = spawn(process.execPath, [target], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, CLAUDE_VIS_DATA_DIR: DATA_DIR },
  });
  child.unref();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── SERVER MODE ──────────────────────────────────────────────────────────────

function runServer() {
  if (isServerAlreadyRunning()) {
    process.exit(0);
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });

  const api = require('./api');
  const { attachWebSocket } = require('./ws');

  const server = http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0];

    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' });
      res.end(); return;
    }

    if (req.method === 'POST' && urlPath === '/hook') return api.handleHook(req, res);
    if (req.method === 'GET'  && urlPath === '/api/ping') return api.handlePing(req, res);
    if (req.method === 'GET'  && urlPath === '/api/sessions') return api.handleListSessions(req, res);
    if (req.method === 'GET'  && urlPath === '/api/stats') return api.handleStats(req, res);

    const sessionMatch = urlPath.match(/^\/api\/sessions\/([^/]+)\/?(graph|activity|tokens)?$/);
    if (sessionMatch) {
      const [, sid, sub] = sessionMatch;
      if (!sub)               return api.handleGetSession(req, res, sid);
      if (sub === 'graph')    return api.handleGetGraph(req, res, sid);
      if (sub === 'activity') return api.handleGetActivity(req, res, sid);
      if (sub === 'tokens')   return api.handleGetTokens(req, res, sid);
    }

    serveStatic(req, res, urlPath);
  });

  attachWebSocket(server);

  server.listen(PORT, HOST, () => {
    writePid();
    console.log(`[vis-worker] listening on http://${HOST}:${PORT}`);
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      process.exit(0);
    }
    console.error(`[vis-worker] server error: ${err.message}`);
  });

  process.on('SIGTERM', () => gracefulShutdown(server));
  process.on('SIGINT',  () => gracefulShutdown(server));
}

function isServerAlreadyRunning() {
  try {
    if (!fs.existsSync(PID_FILE)) return false;
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
    if (!pid || isNaN(pid)) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    try { fs.unlinkSync(PID_FILE); } catch {}
    return false;
  }
}

function writePid() {
  try { fs.writeFileSync(PID_FILE, String(process.pid)); } catch {}
}

function gracefulShutdown(server) {
  try { fs.unlinkSync(PID_FILE); } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}

const UI_DIR = path.join(__dirname, '..', '..', 'ui');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };

function serveStatic(req, res, urlPath) {
  let filePath;
  if (urlPath === '/' || urlPath === '') {
    filePath = path.join(UI_DIR, 'index.html');
  } else if (urlPath.startsWith('/ui/')) {
    filePath = path.join(UI_DIR, urlPath.slice(4));
  } else {
    res.writeHead(404); res.end('not found'); return;
  }

  try {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('not found');
  }
}
