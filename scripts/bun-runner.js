#!/usr/bin/env node
import { spawnSync, spawn } from 'child_process';
import { existsSync, readFileSync, mkdirSync, appendFileSync, writeFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const IS_WINDOWS = process.platform === 'win32';
const __dirname_esm = dirname(fileURLToPath(import.meta.url));
const RESOLVED_PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || resolve(__dirname_esm, '..');

function fixBrokenScriptPath(argPath) {
  if (argPath.startsWith('/scripts/') && !existsSync(argPath)) {
    const fixedPath = join(RESOLVED_PLUGIN_ROOT, argPath);
    if (existsSync(fixedPath)) return fixedPath;
  }
  return argPath;
}

function findBun() {
  const pathCheck = IS_WINDOWS
    ? spawnSync('where bun', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], shell: true })
    : spawnSync('which', ['bun'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });

  if (pathCheck.status === 0 && pathCheck.stdout.trim()) {
    if (IS_WINDOWS) {
      const lines = pathCheck.stdout.split('\n').map(l => l.trim()).filter(Boolean);
      // Prefer .exe — windowsHide:true only suppresses the directly spawned process,
      // not cmd.exe's children, so .cmd wrappers still show a window.
      const exePath = lines.find(l => l.toLowerCase().endsWith('bun.exe'));
      if (exePath) return exePath;
      const cmdPath = lines.find(l => l.toLowerCase().endsWith('bun.cmd'));
      if (cmdPath) return cmdPath;
      if (lines[0]) return lines[0];
      return null;
    }
    return 'bun';
  }

  const bunPaths = IS_WINDOWS
    ? [join(homedir(), '.bun', 'bin', 'bun.exe')]
    : [
        join(homedir(), '.bun', 'bin', 'bun'),
        '/usr/local/bin/bun',
        '/opt/homebrew/bin/bun',
        '/home/linuxbrew/.linuxbrew/bin/bun',
      ];

  for (const p of bunPaths) {
    if (existsSync(p)) return p;
  }
  return null;
}

function isPluginDisabled() {
  try {
    const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
    const settingsPath = join(configDir, 'settings.json');
    if (!existsSync(settingsPath)) return false;
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    return settings?.enabledPlugins?.['claude-visualiser@tapir'] === false;
  } catch {
    return false;
  }
}

if (isPluginDisabled()) process.exit(0);

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node bun-runner.js <script> [args...]');
  process.exit(1);
}

args[0] = fixBrokenScriptPath(args[0]);

const bunPath = findBun();
if (!bunPath) {
  console.error('claude-visualiser: Bun not found. Install from https://bun.sh then restart terminal.');
  process.exit(0);
}

function collectStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) { resolve(null); return; }
    const chunks = [];
    process.stdin.on('data', c => chunks.push(c));
    process.stdin.on('end', () => resolve(chunks.length > 0 ? Buffer.concat(chunks) : null));
    process.stdin.on('error', () => resolve(null));
    setTimeout(() => {
      process.stdin.removeAllListeners();
      process.stdin.pause();
      resolve(chunks.length > 0 ? Buffer.concat(chunks) : null);
    }, 5000);
  });
}

const stdinData = await collectStdin();

const spawnOptions = { stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true, env: process.env };
let spawnCmd = bunPath;
let spawnArgs = args;

if (IS_WINDOWS && bunPath.toLowerCase().endsWith('.cmd')) {
  // .cmd files require shell:true, but windowsHide won't reach bun.exe through cmd.exe.
  // This is a fallback only — findBun() prefers .exe to avoid this path.
  const quote = s => `"${String(s).replace(/"/g, '\\"')}"`;
  spawnOptions.shell = true;
  spawnCmd = [bunPath, ...args].map(quote).join(' ');
  spawnArgs = [];
}
// For .exe: spawn directly — windowsHide:true applies to bun.exe itself, no window.

const child = spawn(spawnCmd, spawnArgs, spawnOptions);

if (child.stdin) {
  if (stdinData && stdinData.length > 0) {
    child.stdin.write(stdinData);
    child.stdin.end();
  } else {
    const dataDir = join(homedir(), '.claude-visualiser');
    const payloadType = stdinData === null ? 'null' : stdinData === undefined ? 'undefined' : 'empty Buffer';
    const diagnostic = [
      `[bun-runner] empty stdin payload`,
      `  script: ${args[0]}`,
      `  payload type: ${payloadType}`,
      `  platform: ${process.platform}`,
      `  timestamp: ${new Date().toISOString()}`,
    ].join('\n');
    console.error(diagnostic);
    try {
      mkdirSync(join(dataDir, 'logs'), { recursive: true });
      appendFileSync(join(dataDir, 'logs', 'runner-errors.log'), diagnostic + '\n\n');
    } catch {}
    try { child.stdin.end(); } catch {}
    try { child.kill(); } catch {}
    process.exit(0);
  }
}

child.on('error', err => { console.error(`claude-visualiser: failed to start Bun: ${err.message}`); process.exit(0); });
child.on('close', (code, signal) => {
  if ((signal || code > 128) && args.includes('hook')) process.exit(0);
  process.exit(code || 0);
});
