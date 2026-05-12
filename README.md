# Pie

![Pre-release](https://img.shields.io/badge/status-pre--release-8A8F98)
![Node.js 20+](https://img.shields.io/badge/node-%3E%3D20-5E8C61)
![License: MIT](https://img.shields.io/badge/license-MIT-6E7781)
![Supported IM channels](https://img.shields.io/badge/supported%20IM-Feishu%2FLark%20%7C%20WeChat-4F7A8A)

Pie is a desktop-first Agent client for creating, running, and observing local Agents that work through IM channels.

The stable path today is Pie Desktop with a Pi Agent Harness and Feishu/Lark channel. WeChat is early, overseas IM channels are still in development, Hermes and OpenClaw are not exposed in the release UI yet, and Ousia/Codex remain experimental integration surfaces.

<a href="docs/assets/pie-intro-video.mp4">
  <img src="docs/assets/pie-intro-video-preview.gif" alt="Pie intro video" width="100%">
</a>

## What Pie Does

Pie gives you one desktop surface for day-to-day Agent work:

1. Create an Agent profile, choose an Agent Harness, connect an IM channel, select a model, and start running.
2. See which Agents exist, which channels they are connected to, whether they are running, what model they use, and how much they have been used.
3. Inspect recent runtime output, profile folders, logs, config, secrets, Skills, and working directories without hunting through terminal sessions.

## Key Features

### Monitor Agent Activity

Follow messages, runtime state, CPU, memory, and recent activity from the desktop view.

<img src="docs/assets/screenshots/dashboard.png" alt="Pie desktop dashboard" width="100%">

### Create Local Agent Profiles

Create a profile, choose a harness, connect channels, and set the working directory.

<img src="docs/assets/screenshots/create-easily.png" alt="Create an Agent profile in Pie" width="100%">

### Connect Channels And Choose Models

Configure IM channels and model settings from the desktop app.

<img src="docs/assets/screenshots/channel-config.png" alt="Configure an IM channel in Pie" width="48%"> <img src="docs/assets/screenshots/model-configuration.png" alt="Model configuration in Pie" width="48%">

### Manage Skills

Manage Skill sources from the desktop app.

<img src="docs/assets/screenshots/skills-management.png" alt="Skills management in Pie" width="100%">

### Inspect Runtime Output

Review logs and terminal output when an Agent is running for a long time.

<img src="docs/assets/screenshots/agent-terminal-logs.png" alt="Agent terminal logs in Pie" width="100%">

### Customize The Workspace

Adjust the desktop theme and profile presentation details.

<img src="docs/assets/screenshots/customizable-theme.png" alt="Theme customization in Pie" width="48%"> <img src="docs/assets/screenshots/cute-avatars.png" alt="Agent avatars in Pie" width="48%">

## Status

Pie is pre-release software. The main development target is the desktop app.

The most complete path today is:

```text
Desktop app -> Pi Agent Harness -> Feishu/Lark channel
```

WeChat can log in, poll, receive, and send messages, but should still be treated as early support. Overseas IM channels, Hermes, and OpenClaw are still in development. Codex has integration surfaces in the repo, but is not a first-class stable release path yet.

Ousia's Task Engine is prototype-level. It is useful for exploring scheduled or longer-running Agent work, but should not be used for critical automation.

Pie does not provide a security sandbox yet. The Runtime Environment sets an Agent's home directory, working directory, and lifecycle state; file, command, and network access are still controlled by the selected Agent Harness and underlying tools.

## Download

The latest pre-release build is [Pie 0.2.2](https://github.com/s1dashu/pie/releases/tag/v0.2.2).

- [Download for macOS Apple Silicon](https://github.com/s1dashu/pie/releases/download/v0.2.2/Pie-0.2.2-arm64.dmg)
- Windows and Linux builds are not published yet.

## Quick Start

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

## Architecture

Pie is organized around a small set of boundaries:

1. **Desktop app**: manage Agents, channels, models, logs, folders, Skills, and global preferences.
2. **Runtime**: start one profile/Agent instance with its selected channels and harness capability.
3. **Agent Harnesses**: adapt Pi, Ousia, Codex, Hermes, Openclaw, and future backends into Pie's session and event surface.
4. **Channels**: receive messages, send replies, and translate IM events for Feishu/Lark, WeChat, and future adapters.

## Development

See [Development Guide](docs/development.md) for local setup, commands, data layout, debugging, and release notes.

## License

MIT

## Notice

The Feishu/Lark messaging delivery code in `src/channels/feishu/platform/messaging/send.ts`
is adapted from `larksuite/openclaw-lark`, which is distributed under the MIT License.
