# Testing

Pie tests are split by how much of the real product path they exercise. Keep the
levels separate so failures stay diagnosable.

## Commands

- `npm run test`
  - Default local suite.
  - Does not require real IM accounts, tokens, gateways, or model calls.
  - Covers unit behavior, mocked gateway adapters, and IM runtime integration
    with fake sessions.
- `npm run test:live`
  - Profile-aware live suite.
  - Scans `~/.pie/profiles/*/config.json`, profile `.env` files, and official
    runtime config such as `~/.openclaw/openclaw.json`.
  - Prints the current `harness on channel` matrix for Pi, Ousia, Codex, Hermes,
    and OpenClaw on Feishu/Discord.
  - Runs L1 connectivity and L2a synthetic IM runtime checks for each live-testable
    Feishu/Discord profile.

## Levels

### L0: Local Logic

Scope:

- Pure functions and deterministic modules.
- Mocked SDK/gateway behavior.
- No real external network or credentials.

Examples:

- `channel-model.test.ts`
- `run-orchestration.test.ts`
- `openclaw.test.ts` with a mock gateway.

Run:

```bash
npm run test
```

### L1: Connectivity

Scope:

- Real credentials and endpoints.
- No user message round trip.
- Verifies that a profile can reach its platform/backend surface today.

Current checks:

| Target | Check |
|---|---|
| Feishu/Lark | App credentials can probe bot info. |
| Discord | Bot token can call `/users/@me`. |
| Hermes | Profile-local health endpoint responds. |
| OpenClaw | Official gateway websocket can be opened. |

The default live suite intentionally does not test WeChat, Telegram, or Slack.

Run:

```bash
npm run test:live
```

### L2a: Synthetic IM Runtime With Real Harness

Scope:

- Starts at Pie's IM runtime boundary with a synthetic inbound IM message.
- Uses fake IM send/receive boundary, but real `TextChannelRuntime`,
  `AgentSessionPool`, harness adapter, backend runtime, and model.
- Captures the outbound IM reply at `sendText`.

Path:

```text
synthetic IncomingChannelMessage
  -> TextChannelRuntime
  -> createAgentSessionPool(...)
  -> real AgentHarnessAdapter
  -> real backend/model
  -> fake TextChannelAdapter.sendText(...)
```

This is stronger than testing the agent adapter directly because it includes Pie
IM orchestration: prompt construction, dedup, owner-session behavior where
applicable, image conversion when the test provides images, reply extraction,
and IM send boundaries.

Current default assertion:

- The synthetic prompt asks a normal historical question in Chinese.
- The captured IM reply must match `安史之乱改变了唐朝的财政与边防格局`.

Run:

```bash
npm run test:live
```

Single-profile example:

```bash
PIE_AGENT_HOME="$HOME/.pie/profiles/bot-fhhnta" \
PIE_LIVE_IM_RUNTIME_TESTS=1 \
PIE_LIVE_PROFILE_ID=bot-fhhnta \
PIE_LIVE_CHANNEL_KIND=discord \
npx tsx --test src/integration/live-im-runtime.test.ts
```

Process exit note:

- Each L2a profile case runs in its own child process.
- On success, `live-im-runtime.test.ts` calls `process.exit(0)` shortly after the
  assertion. This prevents long-lived harness subprocesses, such as Codex
  app-server, from keeping the test runner alive.
- On failure, it exits through the normal failing test path.

### L2b: Real Platform Parser With Real Harness

Planned scope:

- Fake platform event objects, real platform parser/adapter mapping, real Pie IM
  runtime, and real harness.
- Does not open a desktop IM client or send through the real platform.

Example target path:

```text
fake Discord Message / fake Lark event / fake WeChat update
  -> real platform parser
  -> Pie runtime
  -> real harness
  -> captured send boundary
```

This requires extracting or exposing platform parsing seams that are currently
private in some adapters.

### L3: Real IM End-To-End

Scope:

- Real desktop/web IM client or real test account sends messages.
- Real platform ingress/egress.
- Real Pie runtime, harness adapter, backend runtime, and model.

Examples:

- Feishu -> OpenClaw -> Feishu reply.
- Discord -> Pi -> Discord reply.
- Discord image -> Hermes/OpenClaw -> Discord reply with image understanding.

This level is slow and environment-sensitive. Use it as smoke coverage for key
release paths rather than as default local testing.

Current Feishu Lab batch check:

- `src/integration/live-feishu-lab.test.ts`
- Requires `PIE_LIVE_FEISHU_LAB_TESTS=1`.
- Uses the profile Feishu app credentials and sends real Feishu replies to
  `PIE_LIVE_FEISHU_LAB_CHAT_ID`, or falls back to `ownerSession.chatId` in the
  profile config.
- Sends 10 rapid synthetic turns by default and asserts every real harness reply
  contains its unique token. The Feishu reporter must successfully deliver every
  final reply, otherwise the test fails.

Current Discord Lab batch check:

- `src/integration/live-discord-lab.test.ts`
- Requires `PIE_LIVE_DISCORD_LAB_TESTS=1`.
- Uses the profile Discord bot token and sends real Discord replies to
  `PIE_LIVE_DISCORD_LAB_CHANNEL_ID`, or falls back to `ownerSession.chatId` in
  the profile config.
- Sends 10 rapid synthetic turns by default and asserts every real harness reply
  matches the historical knowledge expectation.

Run a single Feishu Lab batch:

```bash
PIE_AGENT_HOME="$HOME/.pie/profiles/<profile-id>" \
PIE_LIVE_FEISHU_LAB_TESTS=1 \
PIE_LIVE_FEISHU_LAB_CHAT_ID="<oc_or_chat_id>" \
npx tsx --test src/integration/live-feishu-lab.test.ts
```

Optional knobs:

- `PIE_LIVE_FEISHU_LAB_BATCH_COUNT=10`
- `PIE_LIVE_FEISHU_LAB_TIMEOUT_MS=300000`
- `PIE_LIVE_FEISHU_LAB_PROMPT_TEMPLATE="... {index} ... {token} ..."`
- `PIE_LIVE_FEISHU_LAB_EXPECTED_REGEX="..."`
- `PIE_LIVE_DISCORD_LAB_BATCH_COUNT=10`
- `PIE_LIVE_DISCORD_LAB_TIMEOUT_MS=300000`
- `PIE_LIVE_DISCORD_LAB_PROMPT_TEMPLATE="... {index} ... {token} ..."`
- `PIE_LIVE_DISCORD_LAB_EXPECTED_REGEX="..."`

## Current Live Matrix

`npm run test:live` prints the matrix from the local machine before running. A
case is displayed as:

```text
<harness> on <channel>
```

The `Interface Checks` column lists the L1 surfaces that are tested for that
profile. L2a then runs one synthetic IM prompt against the same profile.

## Adding Tests

- Put stable, deterministic behavior in L0.
- Add L1 only when the check proves a real credential or endpoint is usable.
- Add L2a when the behavior should pass through Pie IM orchestration but does
  not need a real IM client.
- Add L3 only for the highest-risk user paths, especially real IM delivery,
  consecutive messages, and image understanding.
