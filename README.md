# pie

This repository is **pie** — a lightweight Pi-based personal assistant product focused on a good client experience, starting with the Feishu channel and a small local Task Engine.

The Feishu-only standalone package lives separately as `pi-feishu`.

Built on [Pi Agent](https://github.com/badlogic/pi-mono), optimized for fast synchronous interaction and future desktop integration.

## What Pie Is Now

Pie is being slimmed down around three product surfaces:

1. A product runtime that starts the selected channel and optional long-running capabilities.
2. A local setup and configuration experience, currently CLI + Clack TUI.
3. A Task Engine for scheduled command tasks, webhook intake, and scheduled agent turns.

The previous memory palace / perception / cognition / motivation ontology has been removed from the runtime. Future state and extension systems should be designed deliberately rather than baked into the default filesystem layout.

## Agent Home

Pie stores profile-scoped local state under `~/.pie` by default. Each profile is one bot / agent home with isolated config, secrets, sessions, tasks, and runtime state.

```
~/.pie/
  profiles.json
  profiles/
    bot-lumen-a3f0/
      config.json
      .env
      sessions/
      models.json
      tasks/
      projects/
      runtime/
      docs/
```

`PIE_HOME` / `PI_FEISHU_HOME` / `--home` can still point directly at a profile home for compatibility or host-app integration.

## Task Engine

Task Engine is the unified automation surface. New task specs live at `tasks/<task-id>/task.json` or `projects/<project-id>/tasks/<task-id>/task.json`. The engine writes `state.json` and `runs.jsonl` next to each `task.json`.

Agent task:

```json
{
  "version": 1,
  "id": "daily-review",
  "trigger": { "type": "cron", "cron": "0 9 * * *" },
  "action": {
    "type": "agent",
    "prompt": "Review open projects and decide what needs attention today."
  }
}
```

Exec task:

```json
{
  "version": 1,
  "id": "runtime-health",
  "trigger": { "type": "interval", "everySec": 180 },
  "action": {
    "type": "exec",
    "command": "./run.sh",
    "timeoutSec": 30
  },
  "sink": { "type": "append_jsonl", "path": "runtime/runtime-health.jsonl" }
}
```

Pie has not shipped yet, so Task Engine uses only the new `task.json` layout. There is no legacy workflow/wakeup compatibility layer.

## Quick Start

```bash
git clone https://github.com/<you>/pie.git
cd pie
npm install
npm run start:onboard
```

The onboarding wizard will ask for:

1. Feishu/Lark app setup. The recommended path shows a QR code and URL to create an app automatically; manual App ID / App Secret entry is still available.
2. A model provider and model (OpenAI, Anthropic, Google, etc.)
3. Thinking level.

After setup, start directly:

```bash
npm run start
```

Non-sensitive config is stored in `~/.pie/profiles/<profile-id>/config.json`; secrets such as `FEISHU_APP_SECRET` and model provider API keys are stored in `~/.pie/profiles/<profile-id>/.env`.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                   Feishu / IM Channel                │
│          (streaming replies, reactions, edits)        │
└────────────────────────┬─────────────────────────────┘
                         │
              ┌──────────▼──────────┐
              │     Agent Core      │
              │  (Pi Agent Runtime) │
              │                     │
              │  session management  │
              │  system prompt       │
              │  Pi builtin tools (bash, …)   │
              └──────────┬──────────┘
                         │
          ┌──────────────▼──────────────┐
          │   ~/.pie/profiles/<id> (Home)     │
          │                                   │
          │  config.json   sessions/          │
          │  tasks/        projects/          │
          │  runtime/      docs/              │
          └──────────────┬──────────────┘
                         │
         ┌───────────────▼───────────────┐
         │   Task Engine child process    │
         │                                │
         │  heartbeat + liveness          │
         │  interval / cron execution     │
         │  webhook intake (prototype)    │
         │  future agent turns            │
         └────────────────────────────────┘
```

The root Pie runtime starts Feishu and Task Engine side by side. Feishu remains a channel; it does not own scheduling. Task Engine scans `tasks/<id>/task.json` and `projects/<id>/tasks/<task-id>/task.json`.

## Task Engine

### Exec Task

```json
{
  "version": 1,
  "id": "runtime-health",
  "trigger": { "type": "interval", "everySec": 180 },
  "action": { "type": "exec", "command": "./run.sh", "timeoutSec": 30 },
  "sink": { "type": "append_jsonl", "path": "runtime/runtime-health.jsonl" }
}
```

### Agent Task

```json
{
  "version": 1,
  "id": "project-review",
  "trigger": { "type": "once", "runAt": "2026-03-30T10:00:00+08:00" },
  "action": {
    "type": "agent",
    "prompt": "Review the project status and decide on next steps."
  }
}
```

### Webhook Intake (prototype)

```json
{
  "version": 1,
  "id": "external-inbox",
  "trigger": { "type": "webhook", "path": "/tasks/external-inbox", "secret": "change-me" },
  "action": { "type": "exec", "command": "true" },
  "sink": { "type": "append_jsonl", "path": "runtime/external-inbox.jsonl" }
}
```

Task specs can be global (`tasks/<id>/task.json`) or scoped to a project (`projects/<id>/tasks/<task-id>/task.json`).
`task.json` is the user-editable definition; `state.json` and `runs.jsonl` are engine-owned runtime files.

## Requirements

- Node.js 20+
- A Feishu app with bot credentials
- At least one model provider key (OpenAI, Anthropic, Google, etc.)

## Channels

**Feishu** is the primary supported channel today, with streaming responses, reaction indicators, and edit-in-place message updates.

**WeChat** support is planned.

## Development

```bash
npm run check       # type check
npm run build       # build CLI binaries
npm run dev         # development mode
```

## How It Works

**Session management**: One agent session per conversation, with optional persistent history. Each session gets the repository system prompt and Pi builtin tools.

**Shell**: Command execution uses the `**bash` tool** from `pi-coding-agent` (same as upstream Pi), not custom exec/process wrappers.

**Task Engine observability**: Runtime heartbeats and summary state are written to `runtime/`; each task directory also gets `state.json` and `runs.jsonl`.

**internal turn gateway**: Local HTTP endpoint for future agent-turn delivery and programmatic turns.

## Security

pie executes tools and shell commands through the underlying agent runtime. Do not expose local webhook or gateway ports to the public internet without a separate ingress or tunnel layer.

## License

MIT
