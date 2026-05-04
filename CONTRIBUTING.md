# Contributing

Pie is pre-release software. The current focus is a desktop-first personal Agent client, with Pi as the default stable runtime path and Ousia as an explicit experimental framework.

## Development Setup

```bash
npm install
npm run check
npm run build
npm run desktop:build
```

Use `npm run desktop:dev` for desktop development and `npm run start:onboard` for CLI onboarding.

## Pull Requests

1. Keep changes small and scoped.
2. Prefer existing runtime, channel, backend, and desktop patterns over new abstractions.
3. Do not commit local profile state, secrets, generated runtime files, or local tool configuration.
4. Run `npm run check` before opening a PR.
5. Run `npm run build` or `npm run desktop:build` when touching runtime, build, or desktop entrypoints.

## Project Boundaries

1. `src/runtime/` owns Pie client orchestration.
2. `src/channels/` owns channel adapters only.
3. `src/agents/adapters/` owns backend session adapters.
4. `src/frameworks/ousia/` owns Ousia prompt, Task Engine, and gateway behavior.
5. Sensitive values belong in profile-scoped `.env` files, not in `config.json`.
