#!/usr/bin/env bun
'use strict';

const { spawn, execSync } = require('child_process');
const path = require('path');

const IS_WINDOWS = process.platform === 'win32';
const WORKER_PATH = path.join(__dirname, 'worker-service.cjs');

let child = null;
let shuttingDown = false;

function log(msg) {
  console.log(`[${new Date().toISOString()}] [vis-wrapper] ${msg}`);
}

function spawnWorker() {
  log(`Spawning worker: ${WORKER_PATH}`);
  child = spawn(process.execPath, [WORKER_PATH], {
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    env: { ...process.env, CLAUDE_VIS_MANAGED: 'true' },
    cwd: path.dirname(WORKER_PATH),
  });

  child.on('message', async msg => {
    if (msg.type === 'restart' || msg.type === 'shutdown') {
      log(`${msg.type} requested`);
      shuttingDown = true;
      await killWorker();
      log('Exiting wrapper');
      process.exit(0);
    }
  });

  child.on('exit', (code, signal) => {
    log(`Worker exited code=${code} signal=${signal}`);
    child = null;
    if (!shuttingDown) {
      log('Worker exited unexpectedly, wrapper exiting');
      process.exit(code ?? 0);
    }
  });

  child.on('error', err => log(`Worker error: ${err.message}`));
}

async function killWorker() {
  if (!child?.pid) { log('No worker to kill'); return; }
  const pid = child.pid;
  log(`Killing worker tree pid=${pid}`);

  if (IS_WINDOWS) {
    try {
      execSync(`taskkill /PID ${pid} /T /F`, { timeout: 10000, stdio: 'ignore' });
    } catch (e) {
      log(`taskkill failed: ${e}`);
    }
  } else {
    const localChild = child;
    localChild.kill('SIGTERM');
    await Promise.race([
      new Promise(r => localChild.on('exit', r)),
      new Promise(r => setTimeout(r, 5000)),
    ]);
    if (!localChild.killed) localChild.kill('SIGKILL');
  }

  await waitForPid(pid, 5000);
  child = null;
  log('Worker terminated');
}

async function waitForPid(pid, timeout) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { process.kill(pid, 0); await new Promise(r => setTimeout(r, 100)); }
    catch (e) { if (e.code === 'ESRCH') return; }
  }
}

process.on('SIGTERM', async () => { if (shuttingDown) return; shuttingDown = true; await killWorker(); process.exit(0); });
process.on('SIGINT', async () => { if (shuttingDown) return; shuttingDown = true; await killWorker(); process.exit(0); });

log('Wrapper starting');
spawnWorker();
