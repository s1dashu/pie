# pie

Pie is a personal Agent client product. It is not an agent framework name.

The current runtime is built on `@mariozechner/pi-coding-agent`, with a desktop-first product direction and lightweight support for multiple future agent frameworks such as Pi, Ousia, Openclaw, Hermes, Claude Code, and Codex.

## Current Status

Pie has not shipped a first public release yet. The main development target is the desktop app; the CLI onboarding flow, channel adapters, runtime process, and framework integration support that desktop experience.

See [First Release Notes](docs/first-release.md) for the current release scope, experimental features, known limitations, debugging paths, and reset steps.

The current framework behavior is:

1. **Pi** is the default framework. Selecting Pi starts a clean Pi Coding Agent-backed agent with the selected channel runtime. It does not initialize Ousia system prompt, Ousia Task Engine, or Ousia turn gateway.
2. **Ousia** is an independent framework boundary inside this repo. It reuses Pi Coding Agent sessions, but owns the Ousia system prompt, tool policy, Task Engine, internal turn gateway, and `tasks/` / `projects/` layout.
3. **Openclaw**, **Hermes**, **Claude Code**, and **Codex** are product/framework slots or future integration points, not stable runtime backends in this repo yet.

Channel status:

1. **Feishu/Lark** is the most complete channel today.
2. **WeChat** has an early integration with login, polling, message receive/send, and retry handling.
3. **Slack**, **Discord**, and **Telegram** have adapter/config surfaces, but should still be treated as early or placeholder support before release.

## Product Shape

Pie is organized around these surfaces:

1. **Desktop app**: manage Agents, frameworks, channels, model settings, logs, local folders, and global preferences.
2. **Runtime**: start one profile/agent instance, selected channels, and the selected framework capability.
3. **CLI/onboarding**: initialize profile config, secrets, channel credentials, and model provider settings.
4. **Frameworks**: agent-layer behavior such as prompts, tools, task engines, gateways, and project layout.
5. **Channels**: IM adapters that receive messages, send replies, and translate channel events.

Core model:

1. One profile equals one agent instance.
2. One agent instance can have multiple channels.
3. Secrets live in `.env`; non-sensitive profile config lives in `config.json`.
4. Each agent starts inside a Runtime Environment with a `homeDir`, `workDir`, and lifecycle state.
5. Pie runtime orchestration lives in `src/runtime/`.
6. Framework-specific behavior lives under `src/frameworks/<framework>/`.
7. Channel adapters live under `src/channels/` and should not own generic framework runtime behavior.

## Repository Layout

```text
src/
  cli/                 CLI entry and onboarding
  core/                profile config, registry, agent home, framework resolution
  runtime/             Pie runtime orchestration
    environment.ts     lightweight runtime environment and lifecycle
  channels/
    feishu/            Feishu/Lark channel adapter
    wechat/            WeChat channel adapter
    common/            shared text-channel runtime helpers
    slack/             early Slack adapter
    discord/           early Discord adapter
    telegram/          early Telegram adapter
  frameworks/
    ousia/             Ousia framework boundary
      prompts/         Ousia system prompt
      docs/            Ousia runtime docs copied into agent home
      runtime/         Ousia task engine process and turn gateway
      task-engine/     Ousia Task Engine implementation
  desktop/             Electron desktop app
```

## Agent Home

Pie stores profile-scoped local state under `~/.pie` by default.

```text
~/.pie/
  profiles.json
  profiles/
    <profile-id>/
      config.json
      .env
      sessions/
      models.json
      runtime/
      skills/
      tasks/       # Ousia framework state
      projects/    # Ousia project/workspace files
      docs/        # Ousia local docs
```

Useful paths and variables:

1. Default Pie root: `~/.pie`
2. Profile registry: `~/.pie/profiles.json`
3. Default profile home: `~/.pie/profiles/<profile-id>/`
4. Profile config: `<profile-home>/config.json`
5. Secrets: `<profile-home>/.env`
6. Agent home override: `PIE_AGENT_HOME` or `--home`

## Runtime Environment

Pie now has a lightweight Runtime Environment abstraction. It is not a security sandbox yet.

For each agent runtime, Pie resolves:

1. `homeDir`: the profile home, where config, secrets, sessions, logs, and framework state live.
2. `workDir`: the directory where the runtime process works.
3. lifecycle state: `created`, `starting`, `running`, `stopping`, `stopped`, or `failed`.

Default `workDir` is the profile home. If configured, `profile.runtime.workDir` overrides it. The old `profile.backend.model.workDir` is still read as a compatibility fallback.

The current implementation only creates the directory, starts the child process with that cwd, and tracks lifecycle state. It does not enforce filesystem, command, or network permissions.

## Frameworks

### Pi

Pi is the default framework and should stay minimal. A Pi profile starts the selected channel runtime and uses upstream Pi Coding Agent defaults. It should not load Ousia prompt, Ousia Task Engine, or Ousia gateway.

### Ousia

Ousia owns the extra agent-layer work currently in this repo:

1. Ousia system prompt
2. Ousia tools policy
3. Ousia Task Engine
4. Ousia internal `/agent/turn` gateway
5. Ousia `tasks/`, `projects/`, `runtime/`, and `docs/` layout

Ousia lives under `src/frameworks/ousia/` so it can later be split into an independent GitHub project, similar to Openclaw or Hermes.

## Ousia Task Engine

Ousia Task Engine is the automation surface for Ousia. It is still prototype-level before the first release.

New task specs live only at:

```text
tasks/<task-id>/task.json
```

Do not create new specs under `projects/<project-id>/tasks/`. Associate a task with a project by setting `projectId` in `task.json`. `projects/` is for explicit user/project workspace files.

The engine writes runtime files next to each spec:

```text
tasks/<task-id>/
  task.json      # user-editable definition
  state.json     # engine-owned state
  runs.jsonl     # engine-owned run history
```

Agent task:

```json
{
  "version": 1,
  "id": "daily-review",
  "projectId": "personal-ops",
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

Scheduling support:

1. Agent tasks: `once`, `interval`, `cron`
2. Exec tasks: `interval`, `cron`

Observability files are written under `<agent-home>/runtime/`, including task engine state, event streams, heartbeat files, and internal gateway logs.

## Quick Start

Requirements:

1. Node.js 20+
2. At least one model provider key
3. Channel credentials for the channel you enable

```bash
npm install
npm run start:onboard
```

After onboarding:

```bash
npm run start
```

Desktop development:

```bash
npm run desktop:dev
```

The onboarding flow configures profile metadata, framework/backend choice, channel credentials, model provider, model, and thinking level. Non-sensitive values are stored in `config.json`; secrets such as channel tokens and provider API keys are stored in `.env`.

## Development

```bash
npm run check          # type check
npm run build          # build CLI/runtime/channel entrypoints
npm run desktop:build  # build desktop app
npm run dev            # start runtime in dev mode
```

After code changes, run at least:

```bash
npm run check
```

For runtime, build entrypoint, or desktop changes, also run the relevant build command.

## Security

Pie executes tools and shell commands through the underlying agent runtime. Do not expose local gateway ports to the public internet without an explicit ingress, auth, and deployment design.

## Release Hygiene

Do not commit local profile state, provider keys, channel credentials, generated runtime files, or local Codex environment files. Keep secrets in profile-scoped `.env` files under `~/.pie/profiles/<profile-id>/`.

## License

MIT
