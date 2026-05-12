# claude-visualiser

A Claude Code plugin that records every active Claude session and renders a real-time dashboard at **http://localhost:37778**.

Live D3 force graph of agents and tools, activity log, token usage — zero ongoing user action after installation.

---

## What it does

- **Real-time agent graph** — force-directed D3 v7 graph showing main agent → sub-agents → tools/MCPs/skills
- **Activity log** — scrollable table of every tool call across all sessions, newest first
- **Token usage** — prompt/completion breakdown per session, parsed from Claude transcripts
- **Session list** — all sessions with live/idle status, searchable by project name
- **WebSocket live updates** — graph and log update in real time as Claude works
- **Zero post-install steps** — hooks fire automatically on every Claude session

---

## Architecture

```
Claude Session(s)
  └─ Lifecycle Hooks (SessionStart, PostToolUse, Stop, SubagentStop, UserPromptSubmit)
       └─ scripts/bun-runner.js       (finds Bun runtime, relays stdin)
            └─ scripts/worker-wrapper.cjs  (process supervisor)
                 └─ scripts/worker-service.cjs  (HTTP + WebSocket + SQLite)
                      └─ ui/index.html + ui/app-bundle.js  (browser dashboard)
```

Modelled after [claude-mem](https://github.com/thedotmack/claude-mem) — same hook lifecycle, same process management pattern, same plugin structure.

---

## Installation

```bash
claude plugins marketplace add TamirTapiro/claude-visualiser
claude plugins install claude-visualiser
```

After installation every new Claude session automatically:
1. Starts the worker service on port 37778 (if not already running)
2. Injects a startup message: `Agent Visualiser running → http://localhost:37778`
3. Streams all tool calls and lifecycle events to the worker

---

## Usage

Open the dashboard in your browser:
```
http://localhost:37778
```

Or use the built-in skill:
```
/visualiser:open
```

---

## File structure

```
claude-visualiser/
├── .claude-plugin/plugin.json     Claude Code manifest
├── hooks/hooks.json               Lifecycle hook registrations
├── scripts/
│   ├── bun-runner.js              Runtime finder + stdin relay (ESM, ships as-is)
│   ├── version-check.js           Setup hook: validates Node ≥18, installs better-sqlite3
│   ├── worker-wrapper.cjs         Pre-bundled process supervisor
│   └── worker-service.cjs         Pre-bundled HTTP + WebSocket + SQLite server
├── src/
│   ├── wrapper/index.js           Source for worker-wrapper.cjs
│   └── worker/                    Source for worker-service.cjs
│       ├── index.js               Entry: server-mode vs hook-client-mode
│       ├── db.js                  SQLite schema + queries
│       ├── api.js                 REST endpoint handlers
│       ├── ws.js                  WebSocket server + broadcast
│       └── hooks.js               Hook event processing
├── ui/
│   ├── index.html                 App shell
│   └── app-bundle.js              Pre-bundled UI (D3 + styles)
├── src/ui/                        UI source (bundled by esbuild)
├── skills/open/SKILL.md           /visualiser:open skill
├── build.js                       esbuild build script
└── package.json                   Build-time deps only
```

---

## Data model

SQLite at `~/.claude-visualiser/data.db`

| Table | Description |
|---|---|
| `sessions` | One row per Claude session (id, project, cwd, status, timestamps) |
| `agents` | Main agent + sub-agents, with parent relationships |
| `tool_calls` | Every PostToolUse event (tool name, agent, duration, I/O sizes) |
| `token_usage` | Prompt + completion tokens parsed from session transcripts |

---

## API

Base: `http://localhost:37778`

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Dashboard UI |
| `GET` | `/api/sessions` | List all sessions |
| `GET` | `/api/sessions/:id` | Single session |
| `GET` | `/api/sessions/:id/graph` | Graph nodes + edges for D3 |
| `GET` | `/api/sessions/:id/activity` | Activity log (paginated) |
| `GET` | `/api/sessions/:id/tokens` | Token breakdown |
| `WS` | `/ws` | Live event stream |

---

## Building from source

```bash
npm install
node build.js
```

This produces `scripts/worker-service.cjs`, `scripts/worker-wrapper.cjs`, and `ui/app-bundle.js`. The built artifacts are committed so users never run a build step.

---

## Requirements

- **Node ≥ 18** (checked on Setup hook)
- **Bun** (used as the runtime for the worker — install from [bun.sh](https://bun.sh))
- Port 37778 available

---

## Status

**Work in progress.** Core scripts, hooks, and worker wrapper are complete. The full worker service (HTTP + WebSocket + SQLite), UI, and build are in active development.

| Component | Status |
|---|---|
| Plugin manifests + skills | ✅ Done |
| Lifecycle hooks | ✅ Done |
| bun-runner.js | ✅ Done |
| version-check.js | ✅ Done |
| Worker wrapper (process supervisor) | ✅ Done |
| SQLite layer | 🔄 In progress |
| WebSocket server | 🔄 In progress |
| Hook event handlers | 🔄 In progress |
| REST API | 🔄 In progress |
| Worker entry point | 🔄 In progress |
| Dashboard UI | 🔄 In progress |
| Build system | 🔄 In progress |

---

## License

MIT
