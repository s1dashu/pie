# Pie

![Pre-release](https://img.shields.io/badge/status-pre--release-8A8F98)
![Desktop first](https://img.shields.io/badge/focus-desktop%20first-4F7A8A)
![Node.js 20+](https://img.shields.io/badge/node-%3E%3D20-5E8C61)
![License: MIT](https://img.shields.io/badge/license-MIT-6E7781)

Pie is a desktop-first personal Agent client for creating, running, and observing local Agents that work through IM channels.

It is a product client, not an agent framework. The stable path today is Pie Desktop with a Pi Agent Harness and Feishu/Lark channel, while Ousia, WeChat, Codex, Hermes, Slack, Discord, Telegram, and Openclaw remain early or experimental integration surfaces.

<video src="docs/assets/pie-product-demo.mp4" controls muted playsinline></video>

## Download

Desktop app downloads are coming soon.

- [Download for macOS](#download-coming-soon)
- [Download for Windows](#download-coming-soon)
- [Download for Linux](#download-coming-soon)

## What Pie Does

Pie gives you one desktop surface for day-to-day Agent work:

1. Create an Agent profile, choose an Agent Harness, connect an IM channel, select a model, and start running.
2. See which Agents exist, which channels they are connected to, whether they are running, what model they use, and how much they have been used.
3. Inspect recent runtime output, profile folders, logs, config, secrets, Skills, and working directories without hunting through terminal sessions.

## Product Shape

Pie is organized around a small set of boundaries:

1. **Desktop app**: manage Agents, channels, models, logs, folders, Skills, and global preferences.
2. **Runtime**: start one profile/Agent instance with its selected channels and harness capability.
3. **Agent Harnesses**: adapt Pi, Ousia, Codex, Hermes, Openclaw, and future backends into Pie's session and event surface.
4. **Channels**: receive messages, send replies, and translate IM events for Feishu/Lark, WeChat, Slack, Discord, Telegram, and future adapters.

## Status

Pie is pre-release software. The main development target is the desktop app.

The most complete path today is:

```text
Desktop app -> Pi Agent Harness -> Feishu/Lark channel
```

WeChat can log in, poll, receive, and send messages, but should still be treated as early support. Slack, Discord, Telegram, Codex, Hermes, and Openclaw have integration surfaces in the repo, but are not first-class stable release paths yet.

Ousia's Task Engine is prototype-level. It is useful for exploring scheduled or longer-running Agent work, but should not be used for critical automation.

Pie does not provide a security sandbox yet. The Runtime Environment sets an Agent's home directory, working directory, and lifecycle state; file, command, and network access are still controlled by the selected Agent Harness and underlying tools.

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

## Development

See [Development Guide](docs/development.md) for local setup, commands, data layout, debugging, and release notes.

## License

MIT
