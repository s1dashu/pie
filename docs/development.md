# Development Guide

This guide is for developing Pie locally.

## Requirements

1. Node.js 20+
2. At least one model provider API key
3. Channel credentials for the channel you want to connect

## Setup

Install dependencies:

```bash
npm install
```

Start the desktop app in development:

```bash
npm run desktop:dev
```

Or run CLI onboarding and start the runtime:

```bash
npm run start:onboard
npm run start
```

## Commands

Common commands:

```bash
npm run check          # type check
npm run build          # build CLI/runtime/channel entrypoints
npm run desktop:build  # build desktop app
npm run desktop:dev    # run desktop development app
```

After code changes, run at least:

```bash
npm run check
```

For runtime, build, or desktop changes, also run the relevant build command.

## Local Data

By default, Pie stores local data here:

```text
~/.pie/
  profiles.json
  profiles/
    <profile-id>/
      config.json
      .env
      sessions/
      runtime/
      skills/
```

Non-sensitive settings live in `config.json`. Provider keys, channel tokens, and other secrets live in the profile `.env`.

Current profile config uses `profile.harness + profile.channels[]`. Older pre-release profiles with `profile.backend` are still read as a compatibility fallback.

Do not commit local profile folders, generated runtime files, or secrets.

## Current Development Status

Pie is pre-release software. The main development target is the desktop app.

The most complete path today is:

```text
Desktop app -> Pi Agent Harness -> Feishu/Lark channel
```

WeChat can log in, poll, receive, and send messages, but should still be treated as early support. Overseas IM channels, Hermes, and OpenClaw are still in development. Codex has integration surfaces in the repo, but is not a first-class stable release path yet.

Ousia's Task Engine is prototype-level. It is useful for exploring scheduled or longer-running Agent work, but should not be used for critical automation.

Pie does not provide a security sandbox yet. The Runtime Environment sets an Agent's home directory, working directory, and lifecycle state; file, command, and network access are still controlled by the selected Agent Harness and underlying tools.

## Debugging

1. Open the Agent detail page and check the runtime log panel.
2. Use "Open Agent Profile" to inspect the local profile folder.
3. Check `<profile-home>/runtime/runtime-state.json` for runtime lifecycle state.
4. Check `<profile-home>/runtime/process.json` for the active runtime process record.
5. Check `<profile-home>/runtime/task-engine-*.jsonl` for Ousia Task Engine activity.
6. Check `<profile-home>/.env` for profile-scoped secrets.

Do not paste `.env` contents or provider/channel secrets into issue reports.

## Release Scope

See [First Release Notes](first-release.md) for the current release scope, experimental features, known limitations, reset steps, and release checklist.
