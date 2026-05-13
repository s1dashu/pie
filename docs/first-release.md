# First Release Notes

This document describes the intended first public release scope for Pie.

## Supported

1. Desktop app for creating, starting, pausing, deleting, and inspecting local Agent profiles.
2. One profile equals one Agent instance.
3. Pi Agent Harness as the default runtime path.
4. Ousia Agent Harness as an explicit advanced/experimental harness.
5. Feishu/Lark as the primary IM channel.
6. WeChat as early channel support.
7. Discord as an available desktop creation and runtime channel.
8. DingTalk as early text channel support through app bot Stream mode.
8. Profile-scoped config, secrets, sessions, logs, usage, skills, and runtime state.
9. Runtime Environment with `homeDir`, `workDir`, and persisted lifecycle state.
10. Model provider/model selection and profile-scoped API key storage.
11. Local API key reuse across profiles as a setup convenience.

## Experimental

1. Ousia Task Engine: scheduled work, exec tasks, agent tasks, heartbeat, and observability.
2. Ousia internal run gateway.
3. WeChat channel stability, especially login expiry, send rate limits, long message splitting, and multiple WeChat Agents.
4. Discord channel stability, especially bot permissions, message-content access, and live delivery behavior.
5. DingTalk channel stability, especially Stream reconnect behavior, sessionWebhook expiry, and long message splitting.
6. Slack and Telegram adapters are still hidden development channels.
6. Codex, Hermes, and OpenClaw adapters are real local runtime integrations with desktop diagnostics and setup surfaces, but are not the default stable path yet.
7. Restore enabled Agents on desktop launch.
8. Runtime lifecycle persistence for crash/restart visibility.

Experimental features can be used for local testing, but should not be presented as stable automation or production channel support.

## Known Limitations

1. Runtime Environment is not a security sandbox. It sets the runtime working directory and tracks lifecycle state only.
2. Shell/file/network permissions are still controlled by the underlying agent runtime and provider behavior.
3. Ousia Task Engine is prototype-level and should not be used for critical scheduled work.
4. Slack and Telegram are not release channels yet.
5. Codex, Hermes, and OpenClaw should still be treated as advanced harness choices rather than the default stable path.
6. Multi-channel per Agent is part of the architecture, but the first release should still treat channel setup conservatively.
7. Restore-on-launch supports multiple enabled profiles, but still lacks polished recovery UI, backoff controls, and detailed failure remediation.
8. Config writes are not fully atomic yet. Avoid editing the same profile from multiple Pie processes at once.
9. Runtime lifecycle state can report stale processes after crashes; Pie clears stale process records on the next desktop read.
10. There is no migration guarantee for pre-release local profile data.

## Logs And Debugging

1. Open the Agent detail page and check the runtime log panel.
2. Use "Open Agent Profile" to inspect the local profile folder.
3. Check `<profile-home>/runtime/runtime-state.json` for runtime lifecycle state.
4. Check `<profile-home>/runtime/process.json` for the active runtime process record.
5. Check `<profile-home>/runtime/task-engine-*.jsonl` for Ousia Task Engine activity.
6. Check `<profile-home>/.env` for profile-scoped secrets.

Do not paste `.env` contents or provider/channel secrets into issue reports.

## Reset

To reset one Agent:

1. Stop the Agent from Desktop.
2. Open its Agent Profile folder.
3. Delete or rename the profile directory under `~/.pie/profiles/<profile-id>/`.
4. Remove the profile entry from `~/.pie/profiles.json` if Desktop still lists it.

To reset all local Pie state:

1. Quit Pie.
2. Move `~/.pie` aside, for example `~/.pie.bak`.
3. Start Pie and run onboarding again.

## Release Checklist

Before publishing:

1. Commit changes in small, reviewable commits.
2. Confirm no real secrets are committed.
3. Run `npm run check`.
4. Run `npm run build`.
5. Run `npm run desktop:build`.
6. Manually create and start Pi + Feishu.
7. Manually create and start Ousia + Feishu.
8. If included, manually create and start Pi + WeChat.
9. Confirm selecting Pi does not initialize Ousia prompt, Ousia Task Engine, or Ousia gateway.
10. Confirm runtime lifecycle and logs update in Desktop.
