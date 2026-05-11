#!/usr/bin/env node
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

const DATA_DIR = join(homedir(), '.claude-visualiser');

function emit(msg) {
  // In a Setup hook, output goes to the session context
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'Setup',
      additionalContext: msg,
    },
  }));
}

// Node version check
const [major] = process.versions.node.split('.').map(Number);
if (major < 18) {
  emit(`claude-visualiser: Node.js ${process.versions.node} detected — requires ≥18. Please upgrade.`);
  process.exit(0);
}

// Ensure data dir
mkdirSync(DATA_DIR, { recursive: true });

// Install better-sqlite3 if missing
const sqlitePath = join(DATA_DIR, 'node_modules', 'better-sqlite3');
if (!existsSync(sqlitePath)) {
  try {
    execSync(`npm install --prefix "${DATA_DIR}" better-sqlite3 --no-save --loglevel error`, {
      stdio: 'pipe',
      timeout: 120000,
      env: { ...process.env, npm_config_optional: 'false' },
    });
    emit('claude-visualiser: installed better-sqlite3 ✓');
  } catch (err) {
    emit(`claude-visualiser: warning — could not install better-sqlite3: ${err.message?.slice(0, 200)}`);
  }
}

process.exit(0);
