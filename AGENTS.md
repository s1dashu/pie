# pie

AGENTS.md 是给 coding agents 的项目工作指南。先读本文件，再按需阅读 [DESIGN.md](./DESIGN.md)、源码和相邻文档。

## Project Overview

Pie 是一个个人 Agent 客户端产品，不是单纯的 coding bot。Pie 是客户端和产品名，不是 agent framework 名。

当前 runtime 主要基于 `@mariozechner/pi-coding-agent` 的 session/tool 能力。产品侧可以选择不同 harness/backend：默认稳定路径是 Pi；Ousia 是显式选择后才启用的独立 framework companion；Codex、Hermes、OpenClaw 都是 Pie 侧 adapter 接入的本机官方 runtime，其中 Hermes 默认按 profile 拉起本地 gateway，OpenClaw 默认复用共享官方 gateway/service，启动资源成本明显高于 Pi/Ousia session。

核心原则：

- 保持架构小而清楚，避免为了未来可能性过早抽象。
- 先做好客户端产品体验和长期工作能力，再扩展复杂记忆、知识或插件系统。
- 当前产品未上线，没有历史用户包袱；不要保留或恢复旧 `momo`、旧 config、旧 profile 兼容层。
- 保持文档描述当前真实状态，不要把规划、原型或早期接入写成稳定产品能力。

## Current Product State

- 根目录 `pie` 是客户端产品 runtime：desktop、CLI/onboard、channel adapters、profile/config/agent home 管理。
- 当前主要开发对象是桌面端；CLI/onboard、channel adapters 等能力服务于桌面端 Agent 客户端体验。
- `feishu` 是当前完成度较高的 channel。
- `wechat` 已有扫码登录、轮询和收发消息实现，但仍按早期集成处理。
- `discord` 已接入桌面创建入口和 runtime，可按当前实现维护；`slack`、`telegram` 仍是开发中 channel，桌面开发者模式开启后才开放，本地 runtime 在非开发者模式下会跳过它们。
- Pi / `pi-coding-agent` 是当前真正稳定运行的 harness/backend，默认创建新 Agent 时选择 Pi。
- Ousia 复用 `pi-coding-agent` session，但有自己的 system prompt、tools 配置、Task Engine 和 `/agent/run` gateway。
- Codex 通过本机官方 Codex CLI 的 `app-server --listen stdio://` 接入；桌面有安装/登录诊断和模型选择，但 permission/plan approval 的 IM 交互仍未完成。
- Hermes 复用本机官方 Hermes runtime/service；Pie 可负责发现、启动、健康检查和 adapter 接入，但不应替代 Hermes 自己的 profile/runtime 语义。当前 Hermes 多 profile 按多个 Hermes home 建模：一个 Pie profile 默认对应 `<profile-home>/hermes` 和一个 profile-local gateway/API server port，不走 OpenClaw 式共享 gateway。桌面创建流程会做本机诊断/安装；仍按早期接入处理。
- OpenClaw 是真实接入。Pie 复用本机官方 `openclaw`、官方 `~/.openclaw/openclaw.json` 和官方 gateway/multi-agent 能力；桌面端优先由 `SharedHarnessServiceRegistry` 管理同一个官方 OpenClaw gateway，再把 Pie profile 映射为 namespaced OpenClaw agent。OpenClaw 资源成本高，桌面自动恢复时要受启动预算、延迟调度和资源余量约束。Pie 不内置 Node，不静默安装 OpenClaw；本机缺失或不可用时只通过桌面 UI 给用户显式“安装官方版 OpenClaw”的入口。
- Task Engine 的 scheduled task、runtime heartbeat 和 Ousia daily session distillation 仍偏原型；不要描述为稳定产品能力。

## Development Commands

- 安装依赖：`npm install`
- 类型检查：`npm run check`
- 测试：`npm run test`
- Live/profile 测试分层和矩阵说明见 [docs/testing.md](./docs/testing.md)；完整 live matrix 用 `npm run test:live`
- 启动 runtime：`npm run start` 或 `pie`
- 构建：`npm run build`
- Desktop 开发：`npm run desktop:dev`
- Desktop 构建：`npm run desktop:build`（只生成 `out/`，不生成 `Pie.app`）
- Desktop 打包 Pie.app：`npm run desktop:build && CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dir && open dist/mac-arm64/Pie.app`，产物通常在 `dist/mac-arm64/Pie.app`。默认只打包 `Pie.app`；除非用户明确要求打包 DMG，不要跑 `electron-builder --mac dmg`。
- Desktop 打包 DMG/ZIP：`npm run desktop:build && npx electron-builder --mac dmg zip --publish never`。只在用户明确要求 DMG 时使用。

修改代码后至少跑 `npm run check`；改到已覆盖测试的模块时也跑 `npm run test` 或相关 `tsx --test` 子集。涉及构建入口、desktop、runtime 时也跑对应 build。

## Design Instructions

Desktop UI、视觉 tokens、组件样式和交互规范统一维护在 [DESIGN.md](./DESIGN.md)。不要在 AGENTS.md 里重复 UI/design 规则。

## Architecture Rules

- 一个 profile = 一个 agent instance。
- 一个 agent instance 的 config 可以挂多个 channels。当前多 channel 主要是配置结构和启动能力预留，还没有完整的一等路由策略。
- 未来同一个 bot 同时接 Feishu/Wechat/Slack 时，应在同一个 profile 下挂多个 channel adapter，而不是多个独立 bot。
- `config.json` 使用当前结构：`profile.harness + profile.channels[]`。旧 `profile.backend` 只作为读入兼容 fallback，不要写回或新增。
- 敏感信息只进 `<agent-home>/.env`，不要写入 `config.json`。
- Pie instance 编排入口放在 `src/runtime/`；agent/framework 层能力不要直接放在这里。
- `channel` 目录只负责 channel adapter：收消息、发消息、channel 事件解析与投递。不要让 channel 负责启动 Task Engine、run gateway 或 harness managed service。
- Runtime 选择和创建 enabled channel 的入口集中在 `src/runtime/channel-runtimes.ts`，release/developerMode 可见性由 `src/core/channel-availability.ts` 控制。
- Harness/backend 抽象保持轻量，注册入口集中在 `src/agents/harness-registry.ts`。不要再分别维护多套 capability 表。
- 外部 framework/backend 源码不要改；协议差异在 Pie 自己的 adapter / normalizer 中处理。
- Codex、Hermes、OpenClaw 这类外部 harness 的 runtime ownership 归各自官方 runtime；Pie 只做 discovery、managed start/stop、健康检查、profile 映射、会话 adapter 和 IM 编排，不 fork、不 patch、不重建一套 runtime-level multi-profile。
- Pie multi-profile 是产品/IM 层的 agent instance；底层 runtime 的多 profile/multi-agent 能力要按各自官方语义接入。Hermes 当前按 per-profile Hermes home/gateway 映射；OpenClaw 当前按共享官方 gateway + namespaced `pie-<profile-id>` agent 映射。不要把 Hermes 做成 OpenClaw 式共享 gateway，也不要把 OpenClaw 复制成 per-profile gateway。

## Ousia Boundary And Extraction Plan

Ousia 当前继续放在 Pie repo 内迭代，但要按“未来可独立 package / framework companion”的边界治理。不要现在为了拆 repo 增加发版复杂度；也不要让 Ousia 继续无边界地吸收 Pie 产品内部依赖。

阶段目标：

- 当前阶段：Ousia 物理上位于 repo 内 workspace package `packages/ousia`，逻辑上作为独立 framework boundary。Pie 可以 host Ousia，Ousia 不应知道 Pie 的 desktop、channel、profile registry 等产品内部。
- 下一阶段：当 Ousia 的 run/task/session/event API 更稳定后，继续收敛 `@pie/ousia` public exports、示例和 package-level 测试，仍保持和 Pie 原子提交、同仓 CI。
- 远期阶段：只有当 Ousia 有 Pie 之外的真实 host、独立测试/示例、稳定 public API，并且确实需要独立发版节奏时，才考虑拆成独立 repo。

边界规则：

- Ousia 对 Pie 的依赖只能通过小而明确的 host contract，例如 `homeDir`、`workDir`、run gateway options、task engine context、event sink、clock/FS/path 参数。
- Ousia 不得 import `src/desktop/`、`src/channels/`、`src/runtime/` 的 profile/process orchestration、`src/core/config-store.ts`、profile registry、onboard service、IM owner binding 或具体 Feishu/Wechat/Slack/Discord/Telegram 类型。
- Pie 可以在 harness lifecycle 层把 profile config、env、channel choice、gateway port 等产品状态解析成 Ousia options；Ousia 内部不要直接读取 Pie profile/config registry。
- Ousia 的 public surface 应集中在少数入口：agent home layout、system prompt path、Task Engine process manager、runtime run gateway、Ousia docs sync。新增入口前先确认是否属于 Ousia framework 语义，而不是 Pie host 语义。
- Ousia 内部可以拥有 project/task/docs layout、Task Engine、run gateway、session distillation 等 framework 语义；IM 收发、channel routing、desktop restore scheduling、harness selection、profile mutation 仍属于 Pie。
- 如果为了实现 Ousia 功能需要 Pie 内部能力，优先在 Pie host 层适配成参数或 callback，不要让 Ousia 反向 import Pie 产品模块。
- 不要为“未来可能拆包”过早引入复杂 plugin/DI/container；只保持 import 边界清晰、entrypoint 少、options 类型稳定。
- 做 Ousia 相关改动时，检查是否扩大了 `packages/ousia` 到 Pie 产品层的依赖面；如果扩大了，应在同一改动里收敛或说明原因。

## Agent Harness Model

- `AgentHarnessAdapter` 是 conversation/session port，负责把 Pi、Codex、Hermes、OpenClaw 等外部 backend 的会话能力适配成 Pie 的统一 session API 和事件协议。
- `HarnessLifecycleHooks` 是 harness lifecycle seam，负责 Pie 为特定 harness 提供的附属启动/停止能力，例如 system prompt 默认文件、agent home layout、Ousia Task Engine、Ousia run gateway，以及 Hermes/OpenClaw managed gateway process factory。
- `HarnessLifecycleHooks` 不负责 IM 收发，也不承载 Ousia project/task 等 framework 内部语义；具体实现应继续留在各自 framework 或 harness service 模块里。
- Hermes/OpenClaw gateway 启停属于 lifecycle hooks 下的 managed service，当前内聚在 `src/agents/harness-services/hermes.ts`、`src/agents/harness-services/openclaw.ts` 和通用 `src/agents/harness-services/managed-process.ts`。managed service 启动的是官方 runtime，不应使用 Pie 私有 fork 或强行覆盖官方配置。
- Codex CLI discovery/version check 集中在 `src/agents/harness-services/codex.ts`。桌面全局设置、创建流程、Codex app-server adapter 都应共用 `resolveCodexLaunchCommand` / `checkCodexCliRuntime`，不要在 UI 或 onboard service 里复制 `codex` 路径枚举和 `--version` 执行逻辑。
- 桌面端 Hermes 默认由每个 profile runtime 自己拉起/停止官方 `hermes gateway run`，`HERMES_HOME` 指向 `<profile-home>/hermes`，API server port 来自该 profile config/env。只有显式配置 `harness.config.hermesHome` 时才覆盖默认 home；不要让全局 `~/.hermes` 或进程环境里的 `HERMES_HOME` 污染多个 Pie profile。
- Hermes CLI 是 Python/venv 入口；打包态不要只依赖 shell `PATH` 或直接执行 shebang。应通过 `resolveHermesLaunchCommand` / `resolvePythonCliLaunchCommand` 找到官方 `~/.local/bin/hermes`、`~/.hermes/hermes-agent/venv/bin/hermes`、pipx/uv/Homebrew 等常见位置，并优先用同 venv 的真实 `python3` 显式执行 Hermes script。
- 桌面端 OpenClaw 使用 `src/desktop/main/shared-harness-services.ts` 管理共享官方 gateway；此时 profile runtime 通过 `PIE_MANAGED_HARNESS_SERVICE=external` 避免重复拉起 per-profile service。
- OpenClaw 接入应尊重官方 convention：优先读取官方 `~/.openclaw/openclaw.json` 的 gateway port/auth/agent 配置；如 gateway 已运行则 attach，不 `--force` 抢端口；如未运行则用官方 `openclaw gateway run` 启动。Pie 只 upsert namespaced `pie-<profile-id>` agent 映射，不改 OpenClaw 源码、不创建 Pie-only OpenClaw state。
- OpenClaw 和其他 Node CLI 在打包态必须由真实 `node` 显式执行，不能用 `Pie.app` / Electron 作为 Node fallback，也不能在找不到 Node 时退化成直接执行 `openclaw`。Node 解析顺序应以 CLI 所属 prefix 为锚点：先找 `dirname(openclaw)/node`，再解析 symlink 并从 npm global layout（如 `<prefix>/lib/node_modules/openclaw/...`）推断 `<prefix>/bin/node`，然后才看 `npm_node_execpath`、真实 `process.execPath`、登录 shell 的 `command -v node`、nvm/volta/Homebrew/系统常见路径。找不到真实 Node 时应明确失败并引导用户安装官方 OpenClaw，不要回退到 `ELECTRON_RUN_AS_NODE`。
- 桌面 OpenClaw 诊断和启动前检查要确认官方 OpenClaw runtime ready。创建 OpenClaw Agent 时如果 runtime 不可用，应进入显式安装步骤；启动已有 OpenClaw Agent 时如果 runtime 不可用，应写入 runtime unavailable/failed 状态并提示用户安装或修复官方 OpenClaw。
- 等 OpenClaw/Hermes/Codex 等 backend 更稳定后，再考虑提炼更完整的统一 Agent API；不要为了预留而过早扩大抽象。

## Channel Runtime Modules

- Channel adapter 只负责平台消息收发、平台事件解析和平台发送能力；不要让 channel adapter 拥有 backend session pool 之外的 framework lifecycle。
- 跨 channel 的 run 编排规则集中在 `src/channels/common/run-orchestration.ts`，包括 agent task prompt 格式、silent task 判断、owner session binding 和 scheduled run queue。不要在 Feishu/Wechat/common text runtime 里再复制这些规则。
- 跨 channel 的 IM event rendering 状态机集中在 `src/channels/common/im-event-rendering.ts`，包括 thinking buffer、assistant text stream buffer 和 IM thinking quote 格式。平台限制和发送动作仍留在各 channel adapter / reporter。
- 文本类 channel 的共享运行时在 `src/channels/common/text-channel-runtime.ts`；Slack/Discord/Telegram 应优先复用它，平台差异留在 adapter/message parsing 层。
- IM message part 到 agent input 的转换集中在 `src/channels/common/channel-model.ts`。图片附件会尽量转成 `AgentPromptInput.images` 并交给支持多模态的 harness；非图片 file 目前主要是下载/记录，不要描述成所有 harness 都已具备文件理解能力。
- Feishu 仍有专用 `ConversationController` 和 `LarkProgressReporter`，因为 card/bubble、消息编辑和平台交互比 common text runtime 复杂；不要为了统一而牺牲 Feishu 当前体验。

## Event Protocol

Pie 内部 agent 事件协议的概念层级以 `AgentRun -> AgentTurn -> text/thinking/tool_call` 为核心：

- `agent_run_started` / `agent_run_finished` 表示用户、IM、scheduled task、CLI 或 HTTP 一次外部输入触发的完整执行。
- `turn` / `AgentTurn` 表示 run 内部一次 agent/backend 模型迭代。
- 流式文本使用 `text_start/text_delta/text_finished`。
- 思考内容使用 `thinking_start/thinking_delta/thinking_finished`。
- 工具调用使用 `tool_call_started/tool_call_updated/tool_call_finished`。

Pi 原始的 `agent_start/agent_end/turn_start/turn_end/message_update/tool_execution_*` 通过 `src/agents/event-normalizer.ts` 映射为 Pie 事件。Codex/Hermes/OpenClaw 等 Pie 侧 adapter 应优先直接 emit Pie 事件。Pie runtime、logging、usage、channel progress reporter 和 desktop timeline 后续都应只消费归一化后的 Pie 事件。

`AgentConversationSession.prompt` 接收轻量 `AgentPromptInputLike`，当前支持 text 和 image 输入结构。Pi、Codex、Hermes、OpenClaw 会转发图片输入；新增或调整多模态行为时要在 adapter capability、channel 表述和 E2E 测试里同步说清楚。

Runtime stdout 日志不是完整事实源；profile-scoped normalized events 写入 `runtime/agent-events.jsonl`。`src/agents/session-logging.ts` 负责把事件投射成桌面运行日志，处理流式文本时要同时考虑 `text_delta` 和 `text_finished`：有些 backend（例如 OpenClaw）可能只在 delta 给出前缀，在 `text_finished` 给出完整文本，日志必须补齐缺失尾部，避免桌面日志和 IM 实际输出不一致。

## Runtime And Sandbox

Pie runtime 有一层轻量 Runtime Environment 抽象，定义 agent 的 `homeDir`、`workDir` 和生命周期状态。当前只用它指定工作目录和管理生命周期，不做文件、网络、命令权限限制。

- 默认 `workDir` 是 profile home。
- 配置里优先使用 `profile.runtime.workDir`。
- `profile.harness.model.workDir` 仍作为兼容/模型配置 fallback。
- `workDir` 只是 agent 默认工作目录，不是安全边界；不要描述成能阻止命令访问工作区外文件。

当前先不为 Pi/Ousia 实现 Pie 自己的 sandbox。后续如果支持 sandbox，应放在 agent adapter 或具体命令/文件执行层，而不是给整个 Pie Desktop/runtime 进程套 sandbox。

Sandbox 能力按 harness/backend capability 表达：

- Native sandbox：backend 自己提供执行层隔离，例如 Codex 的 `read-only`、`workspace-write`、`danger-full-access` 映射到 Codex app-server/CLI 的 sandbox。
- Pie sandbox：Pie 为不具备 native sandbox 的 backend 补执行层限制，例如未来在 Pi/Ousia 的 `bash`、`write`、`edit` 或 Task Engine exec runner 外包一层 macOS Seatbelt、Linux bubblewrap/Landlock、Windows restricted token。
- Workspace policy：只设置 `workDir`、工具开关和 system prompt 约束，不是安全 sandbox。Pi/Ousia 当前最多属于这一类。
- No sandbox/YOLO：不做文件或命令限制，接近当前用户终端权限。

Codex 的 permission/plan approval 后续应接入 IM 交互。Codex app-server 抛出 plan 或权限请求时，channel adapter 应发送可回复的确认消息；用户在 IM 中回复批准、拒绝或修改意见后，再由 Codex adapter 继续当前 turn 或发起实现 follow-up。当前不要把这项能力描述为已完成。

## Desktop Start Scheduling And Resources

Desktop 启动恢复 agent 时不能简单并发拉起所有 profile。不同 harness 启动成本差异很大，尤其 OpenClaw gateway 会明显占用 CPU 和内存。启动调度集中在 `src/desktop/main/agent-start-limiter.ts` 和 `src/desktop/main/agent-start-policy.ts`：

- `AgentStartLimiter` 同时考虑单 harness 并发上限、全局最大并发和启动权重预算。
- 桌面自动恢复会实时采样 CPU count、1 分钟 load average、free/total memory，并计算 `maxWeight` / `maxConcurrent`。
- OpenClaw 和 Hermes 自动恢复时如果资源余量不足，会 defer auto-start，写入 runtime state reason `restore-deferred-low-resources`；用户手动启动时仍允许重 harness 独占预算启动，避免永远排队。
- 自动恢复有额外 stagger：普通 profile 默认 500ms 间隔；OpenClaw 选中 profile 额外延迟约 4s，后台 OpenClaw 额外延迟约 15s。
- 当前单 harness 上限：`openclaw: 1`、`hermes: 1`。

当前本机测量得到的启动成本估算，作为调度策略参考，不要当作跨机器精确常数：

- OpenClaw gateway cold start：ready 约 3.8s，RSS peak 约 659MB，CPU peak 约 96%。策略权重 `6`，估算启动内存 `768MB`。
- Hermes gateway cold start：ready 约 2.8s，RSS peak 约 99MB，CPU peak 约 20%。策略权重 `3`，估算启动内存 `256MB`。
- Codex app-server init：ready 约 78ms，RSS peak 约 107MB，CPU peak 约 10%。策略权重 `2`，估算启动内存 `384MB`。
- Pi session init：ready 约 33ms，RSS delta 约 7MB。策略权重 `1`，估算启动内存 `192MB`。
- Ousia session init 本身很轻，但 Ousia 桌面启动会额外拉起 Task Engine runtime/engine 双进程；空载 Task Engine RSS peak 约 181MB。策略权重 `2`，估算启动内存 `384MB`。

资源策略应保持保守、可解释、可被日志观测。调整权重前优先用临时 home/state、随机端口和进程树 RSS/CPU 采样复测，避免凭直觉改数字。

## Ousia Rules

- Ousia 的 system prompt、Task Engine、run gateway、project/task 关系都内聚在 `packages/ousia`。
- Ousia 是 Pie repo 内的独立 framework boundary；新增 Ousia 代码时优先依赖 Ousia 内部模块、标准库和 host 传入 options，不要直接依赖 Pie desktop/channel/profile/config-store 等产品层模块。
- Pie 通过 `src/core/agent-harness.ts` 的 lifecycle contract host Ousia；不要让 Ousia 自己启动 channel adapter、读写 Pie profile registry、决定 channel routing 或管理 desktop restore scheduling。
- Standalone Ousia 默认 home 是 `~/.ousia`；Pie-hosted Ousia 应由 Pie 显式传入 profile-scoped home，不要让 Ousia state 默认落在 repo 根目录。
- Ousia 的 HTTP surface 使用 `/agent/run` 和 `/agent/task`；不要恢复 `/agent/turn` 命名。
- Ousia Task Engine 的新任务统一写入 `tasks/<task-id>/task.json`。
- 不要再创建 `projects/<project-id>/tasks/<task-id>/task.json`。
- Project 与 task 的关系通过 `task.json.projectId` 关联。
- `projects/` 保持为用户/project workspace 文件区，不承载 task runtime 文件。
- Ousia agent home 会同步内置 docs 到 `docs/`，当前包括 Task Engine 使用和 observability 文档。
- Ousia runtime 会确保一个 `session-distillation-daily` scheduled task；它是静默维护原型，可用 `OUSIA_DISABLE_DAILY_DISTILLATION=1` 关闭，不要把它包装成稳定记忆系统。

## Important Paths

- `src/cli/index.ts`：根 CLI 入口；`npm run start` / `pie` 启动 runtime；`pie onboard` 或 `pie --onboard` 进入配置。
- `src/runtime/main.ts`：Pie 客户端 runtime 编排入口，初始化 profile home，并按 `AgentHarnessDefinition.lifecycleHooks` 启动当前可用 channel、framework companion 和 managed harness service。
- `src/runtime/channel-runtimes.ts`：按 profile enabled channels 和 developerMode 创建 Feishu/Wechat/Discord/Slack/Telegram runtime。
- `src/runtime/environment.ts`：Runtime Environment 抽象，负责解析/创建工作目录并表达生命周期状态；当前不是安全沙盒。
- `src/agents/harness-registry.ts`：harness/backend 集中注册入口；每个 harness 同时声明 `AgentHarnessAdapter`、可选 `HarnessLifecycleHooks` 和 skill sources。不要再维护第二套 harness runtime registry。
- `src/agents/types.ts`：Pie agent session port 与统一事件协议定义。
- `src/agents/event-normalizer.ts`：把 Pi 等外部 backend 的原始事件映射为 Pie 的 normalized `agent_run/turn/text/thinking/tool_call` 事件。
- `src/agents/event-sink.ts`：轻量 observability event sink，把 profile-scoped normalized agent events 写入 `runtime/agent-events.jsonl`。
- `src/agents/session-logging.ts`：把 normalized agent events 投射成 stdout/usage 记录；流式 assistant 文本应在 `text_finished` 补齐最终文本中尚未出现在 delta 里的部分。
- `src/agents/session-runtime.ts`：按 harness 创建带 logging、usage、normalized event sink 和 Pi idle compaction maintenance 的 session pool wrapper。
- `src/agents/adapters/`：backend conversation/session adapters；只做 Pie 侧适配，不修改外部 framework/backend 源码。
- `src/agents/adapters/codex-cli.ts`：Codex CLI app-server adapter；处理 stdio JSON-RPC、Codex 登录诊断、sandbox/web search 配置和事件映射。
- `src/agents/adapters/pi/session.ts`：Pi session pool、system prompt 注入、工具配置。channel 不应直接拥有 backend session pool。
- `src/agents/skills.ts`：Skills 来源 resolver，按 profile、harness/global、universal 三类返回目录来源。
- `src/agents/harness-services/codex.ts`：Codex CLI discovery/version check 的单一入口，供桌面设置、创建流程和 Codex adapter 共享。
- `src/agents/harness-services/managed-process.ts`：Hermes/OpenClaw managed process 共享启动、健康检查和停止逻辑；负责 Node CLI 的真实 Node 解析，必须优先使用 CLI 同 prefix 的 Node，并禁止 Electron-as-node fallback。
- `src/agents/harness-services/hermes.ts`：Hermes managed harness service；负责可选启动/管理 Hermes gateway，不承载通用 agent 事件协议。
- `src/agents/harness-services/openclaw.ts`：OpenClaw managed harness service；负责可选启动/管理 OpenClaw gateway，不承载通用 agent 事件协议。
- `src/channels/feishu/main.ts`：Feishu channel adapter。
- `src/channels/wechat/main.ts`：WeChat channel adapter；当前仍属于早期集成。
- `src/channels/common/`：Slack/Discord/Telegram 等 text channel adapter 共享 runtime。
- `src/channels/common/channel-model.ts`：channel message parts 与 `AgentPromptInput` 转换，包含图片下载/读取到 base64 的共享逻辑。
- `src/channels/common/run-orchestration.ts`：跨 channel 的 owner session、scheduled run queue 和 agent task prompt 规则。
- `src/channels/common/im-event-rendering.ts`：跨 channel 的 thinking / assistant text event buffer。
- `src/core/agent-harness.ts`：`HarnessLifecycleHooks`、task engine manager 和 run gateway 类型；harness 注册入口不要放在这里，统一放在 `src/agents/harness-registry.ts`。
- `src/core/channel-availability.ts`：release/developerMode 下 channel 是否可用的集中判断。
- `src/core/config-store.ts`：agent profile/config schema。
- `src/core/agent-home.ts`：`PIE_AGENT_HOME`、`.env`、agent home 路径。
- `src/core/runtime-process.ts`：profile runtime process/state 文件读写和存活校验。
- `src/core/startup-spans.ts`：启动路径轻量 JSONL span，用于分析 desktop/runtime/harness service 启动耗时。
- `src/core/harness-service-state.ts`：共享 harness service 状态文件读写。
- `packages/ousia/`：Ousia workspace package；包含 Ousia system prompt、Task Engine、run gateway、project/task/docs layout，并通过 `@pie/ousia` 暴露 public API 给 Pie host。
- `src/desktop/`：Electron desktop。
- `src/desktop/main/agent-process-manager.ts`：桌面端 agent runtime 子进程启动/停止、日志采集、ready 识别和 runtime state 持久化。
- `src/desktop/main/agent-runtime-launcher.ts`：选择 tsx 源码入口或 dist runtime 入口，并分配本地 gateway port。
- `src/desktop/main/onboard-service.ts`：桌面端诊断、安装、登录和模型目录相关服务；Codex/Hermes/OpenClaw 的本机 runtime 检测、显式安装/升级入口集中在这里。
- `src/desktop/main/agent-restore-schedule.ts`：桌面自动恢复的 stagger/重 harness 延迟策略。
- `src/desktop/main/shared-harness-services.ts`：桌面端共享 OpenClaw gateway service 管理和 profile provisioning。
- `src/desktop/main/agent-start-policy.ts`：桌面端按机器资源和 harness 类型计算启动权重、预算和自动恢复 defer 规则。
- `src/desktop/main/agent-start-limiter.ts`：桌面端启动限流器，执行全局并发、权重预算和单 harness 上限。

## Config And State

- 默认 Pie root：`~/.pie`
- 默认 profile home：`~/.pie/profiles/<profile-id>/`
- 可用 `PIE_AGENT_HOME` 或 `--home` 指定某个 profile home。
- Profile registry：`~/.pie/profiles.json`
- Profile config：`<profile-home>/config.json`
- Secrets：`<profile-home>/.env`
- Profile-scoped skills：`<profile-home>/skills/`
- Pie/client runtime state：`sessions/`、`runtime/`
- Runtime process/state：`runtime/process.json`、`runtime/runtime-state.json`
- Runtime logs：`runtime/agent-logs.jsonl`
- Usage events：`runtime/agent-usage-events.jsonl`
- Normalized agent event log：`runtime/agent-events.jsonl`
- Startup spans：`runtime/startup-spans.jsonl`
- Shared harness service state：`~/.pie/runtime/harness-services/*.json`，共享 service home 默认在 `~/.pie/runtime/harness-services/<kind>-<group>/`
- Official OpenClaw runtime/config：`~/.openclaw/`；Pie 的 OpenClaw harness 复用官方路径和 gateway 配置，只在其中维护 namespaced Pie agent 映射。
- Downloaded channel attachments：`runtime/attachments/<channel>/...`
- Ousia framework state：`tasks/`、`projects/`、`docs/`，以及 Ousia Task Engine 写入的 `runtime/task-engine-*`

## Known Technical Debt

- `config-store` 和 `profile-registry` 需要更严格 schema 校验和清晰错误提示。
- `profiles.json`、`config.json`、`.env` 后续应使用 atomic write，避免 CLI 和 desktop 并发写半文件。
- 继续减少 runtime 对全局 `process.env` 的依赖；未来多 bot 同进程时，需要 per-profile config/env object。
- Desktop 使用 `desiredState` 表达“用户期望该 profile 随桌面端恢复运行”。agent 运行态用 `running/starting/paused/failed`，桌面选中态用 `selectedProfile`，不要把选中态混入 runtime 语义。
- 多 channel 路由策略仍未成为一等能力。当前不要实现默认 channel、owner channel、broadcast、指定 channel 等复杂路由；等第二个稳定 channel 真正和 Feishu 并行使用时再定。
- Feishu channel 仍有较多专用 conversation/progress 逻辑；Slack/Discord/Telegram 走 common text runtime。通用 run orchestration 和 IM event rendering 已收敛到 `src/channels/common/`；是否把 Feishu 主 controller 也收敛到 common runtime，等现有 Feishu card/bubble 体验稳定后再评估。
- Observability 目前是 profile-scoped JSONL 日志、usage 文件、normalized event sink、startup spans 和 runtime state，尚未形成完整 tracing/metrics 系统。后续如果扩展，应保持轻量，不引入复杂 telemetry。
- `runtime/agent-events.jsonl` 当前是 append-only event sink；后续如果用于 desktop timeline，应补 retention、读取 API 和错误容忍策略。
- 多 harness 抽象已经有轻量 registry，但 Codex/Hermes/OpenClaw 仍在快速变化。不要在这些 backend 稳定前继续扩大统一 Agent API。
- 图片输入已经穿过 channel model 和 Pi/Codex/Hermes/OpenClaw adapter；后续需要继续完善 capability 表达、UI/文档提示和真实图片理解 E2E 覆盖。

## Coding Constraints

- 不恢复旧 `momo` 命名和旧兼容逻辑。
- 不恢复旧 memory/cognition/motivation 默认目录；长期记忆应作为新产品能力重新设计。
- Shell 能力以 `pi-coding-agent` 内置 `bash` 工具为准，不再叠自定义 exec/process 工具链。
- Feishu 回复不要依赖 Markdown 表格；优先使用普通段落和有序列表。
- 用户经常使用语音输入，消息里可能有 typo 或同音误写；按上下文直接理解即可，不要因为拼写问题反复确认。
