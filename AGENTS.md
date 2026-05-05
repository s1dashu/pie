# pie

AGENTS.md 是给 coding agents 的项目工作指南。先读本文件，再按需阅读 [DESIGN.md](./DESIGN.md)、源码和相邻文档。

## Project Overview

Pie 是一个个人 Agent 客户端产品，不是单纯的 coding bot。Pie 是客户端和产品名，不是 agent framework 名。

当前 runtime 主要基于 `@mariozechner/pi-coding-agent` 的 session/tool 能力。产品侧可以选择不同 backend/framework：默认稳定路径是 Pi；Ousia 是显式选择后才启用的独立 framework；Codex、Hermes 仍是 Pie 侧早期 adapter；Openclaw 只是架构预留。

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
- `slack`、`discord`、`telegram` 等海外渠道仍在开发中，adapter 代码可以保留，但 release 前不要开放入口，也不要描述为可用或稳定支持。
- Pi / `pi-coding-agent` 是当前真正稳定运行的 backend/framework，默认创建新 Agent 时选择 Pi。
- Ousia 复用 `pi-coding-agent` session，但有自己的 system prompt、tools 配置、Task Engine 和 `/agent/turn` gateway。
- Hermes 可由 Pie 代管本地 gateway service，但仍按早期接入处理；release UI 中暂不开放 Hermes 和 OpenClaw 创建入口。
- Task Engine 的 scheduled task、runtime heartbeat 仍偏原型；不要描述为稳定产品能力。

## Development Commands

- 安装依赖：`npm install`
- 类型检查：`npm run check`
- 启动 runtime：`npm run start` 或 `pie`
- 构建：`npm run build`
- Desktop 开发：`npm run desktop:dev`
- Desktop 构建：`npm run desktop:build`

修改代码后至少跑 `npm run check`。涉及构建入口、desktop、runtime 时也跑对应 build。

## Design Instructions

Desktop UI、视觉 tokens、组件样式和交互规范统一维护在 [DESIGN.md](./DESIGN.md)。不要在 AGENTS.md 里重复 UI/design 规则。

## Architecture Rules

- 一个 profile = 一个 agent instance。
- 一个 agent instance 的 config 可以挂多个 channels。当前多 channel 主要是配置结构和启动能力预留，还没有完整的一等路由策略。
- 未来同一个 bot 同时接 Feishu/Wechat/Slack 时，应在同一个 profile 下挂多个 channel adapter，而不是多个独立 bot。
- `config.json` 使用新结构：`profile.backend + profile.channels[]`。
- 敏感信息只进 `<agent-home>/.env`，不要写入 `config.json`。
- Pie instance 编排入口放在 `src/runtime/`；agent/framework 层能力不要直接放在这里。
- `channel` 目录只负责 channel adapter：收消息、发消息、channel 事件解析与投递。不要让 channel 负责启动 Task Engine 或通用 gateway。
- Backend/framework 抽象保持轻量，注册入口集中在 `src/agents/backend-registry.ts`。不要再分别维护多套 backend capability 表。
- 外部 framework/backend 源码不要改；协议差异在 Pie 自己的 adapter / normalizer 中处理。

## Agent Backend Model

- `AgentBackendAdapter` 是 conversation/session port，负责把 Pi、Codex、Hermes 等外部 backend 的会话能力适配成 Pie 的统一 session API 和事件协议。
- `AgentFrameworkRuntime` 是 framework companion，负责 Pie 为特定 framework 提供的附属生命周期能力，例如 system prompt 默认文件、agent home layout、Ousia Task Engine 和 turn gateway。
- `AgentFrameworkRuntime` 不负责 IM 收发，也不负责代管外部 backend 的核心 service process。
- Hermes gateway 启停属于 backend managed service，当前内聚在 `src/agents/backend-services/hermes.ts`。
- 等 Openclaw/Hermes 等 backend 更稳定后，再考虑提炼更完整的统一 Agent API；不要为了预留而过早扩大抽象。

## Event Protocol

Pie 内部 agent 事件协议以 `round -> turn -> text/thinking/tool_call` 为核心：

- `round` 表示用户一次完整请求触发的 agent 工作。
- `turn` 表示 round 内部一次 agent/backend 迭代。
- 流式文本使用 `text_start/text_delta/text_finished`。
- 思考内容使用 `thinking_start/thinking_delta/thinking_finished`。
- 工具调用使用 `tool_call_started/tool_call_updated/tool_call_finished`。

Pi 原始的 `agent_start/agent_end/turn_start/turn_end/message_update/tool_execution_*` 通过 `src/agents/event-normalizer.ts` 映射为 Pie 事件。Codex/Hermes 等 Pie 侧 adapter 应优先直接 emit Pie 事件。Pie runtime、logging、usage、channel progress reporter 和 desktop timeline 后续都应只消费归一化后的 Pie 事件。

`AgentConversationSession.prompt` 接收轻量 `AgentRoundInputLike`。当前实际能力仍是 text；类型上为后续 file/image/attachment 输入留下扩展口。在真实附件能力实现前，不要把附件发送描述成已完成能力。

## Runtime And Sandbox

Pie runtime 有一层轻量 Runtime Environment 抽象，定义 agent 的 `homeDir`、`workDir` 和生命周期状态。当前只用它指定工作目录和管理生命周期，不做文件、网络、命令权限限制。

- 默认 `workDir` 是 profile home。
- 配置里优先使用 `profile.runtime.workDir`。
- 旧的 `profile.backend.model.workDir` 仅作为兼容 fallback。
- `workDir` 只是 agent 默认工作目录，不是安全边界；不要描述成能阻止命令访问工作区外文件。

当前先不为 Pi/Ousia 实现 Pie 自己的 sandbox。后续如果支持 sandbox，应放在 agent adapter 或具体命令/文件执行层，而不是给整个 Pie Desktop/runtime 进程套 sandbox。

Sandbox 能力按 backend capability 表达：

- Native sandbox：backend 自己提供执行层隔离，例如 Codex 的 `read-only`、`workspace-write`、`danger-full-access` 映射到 Codex app-server/CLI 的 sandbox。
- Pie sandbox：Pie 为不具备 native sandbox 的 backend 补执行层限制，例如未来在 Pi/Ousia 的 `bash`、`write`、`edit` 或 Task Engine exec runner 外包一层 macOS Seatbelt、Linux bubblewrap/Landlock、Windows restricted token。
- Workspace policy：只设置 `workDir`、工具开关和 system prompt 约束，不是安全 sandbox。Pi/Ousia 当前最多属于这一类。
- No sandbox/YOLO：不做文件或命令限制，接近当前用户终端权限。

Codex 的 permission/plan approval 后续应接入 IM 交互。Codex app-server 抛出 plan 或权限请求时，channel adapter 应发送可回复的确认消息；用户在 IM 中回复批准、拒绝或修改意见后，再由 Codex adapter 继续当前 turn 或发起实现 follow-up。当前不要把这项能力描述为已完成。

## Ousia Rules

- Ousia 的 system prompt、Task Engine、turn gateway、project/task 关系都内聚在 `src/frameworks/ousia/`。
- Ousia Task Engine 的新任务统一写入 `tasks/<task-id>/task.json`。
- 不要再创建 `projects/<project-id>/tasks/<task-id>/task.json`。
- Project 与 task 的关系通过 `task.json.projectId` 关联。
- `projects/` 保持为用户/project workspace 文件区，不承载 task runtime 文件。

## Important Paths

- `src/cli/index.ts`：根 CLI 入口；`npm run start` / `pie` 启动 runtime；`pie onboard` 或 `pie --onboard` 进入配置。
- `src/runtime/main.ts`：Pie 客户端 runtime 编排入口，初始化 profile home，并按 `AgentBackendDefinition` 启动当前可用 channel、framework companion 和 managed backend service。
- `src/runtime/environment.ts`：Runtime Environment 抽象，负责解析/创建工作目录并表达生命周期状态；当前不是安全沙盒。
- `src/agents/backend-registry.ts`：backend 集中注册入口；每个 backend 同时声明 `AgentBackendAdapter`、`AgentFrameworkRuntime`、可选 managed backend service 和 backend skills 来源。
- `src/agents/types.ts`：Pie agent session port 与统一事件协议定义。
- `src/agents/event-normalizer.ts`：把 Pi 等外部 backend 的原始事件映射为 Pie 的 `round/turn/text/thinking/tool_call` 事件。
- `src/agents/event-sink.ts`：轻量 observability event sink，把 profile-scoped normalized agent events 写入 `runtime/agent-events.jsonl`。
- `src/agents/adapters/`：backend conversation/session adapters；只做 Pie 侧适配，不修改外部 framework/backend 源码。
- `src/agents/adapters/pi/session.ts`：Pi session pool、system prompt 注入、工具配置。channel 不应直接拥有 backend session pool。
- `src/agents/skills.ts`：Skills 来源 resolver，按 profile、backend/global、universal 三类返回目录来源。
- `src/agents/backend-services/hermes.ts`：Hermes managed backend service；负责可选启动/管理 Hermes gateway，不承载通用 agent 事件协议。
- `src/channels/feishu/main.ts`：Feishu channel adapter。
- `src/channels/wechat/main.ts`：WeChat channel adapter；当前仍属于早期集成。
- `src/channels/common/`：Slack/Discord/Telegram 等 text channel adapter 共享 runtime。
- `src/core/backend-framework.ts`：`AgentFrameworkRuntime` 类型和 runtime companion 解析；backend 注册入口不要放在这里，统一放在 `src/agents/backend-registry.ts`。
- `src/core/config-store.ts`：agent profile/config schema。
- `src/core/agent-home.ts`：`PIE_AGENT_HOME`、`.env`、agent home 路径。
- `src/frameworks/ousia/`：Ousia framework 项目边界；包含 Ousia system prompt、Task Engine、turn gateway、project/task/docs layout。
- `src/desktop/`：Electron desktop。

## Config And State

- 默认 Pie root：`~/.pie`
- 默认 profile home：`~/.pie/profiles/<profile-id>/`
- 可用 `PIE_AGENT_HOME` 或 `--home` 指定某个 profile home。
- Profile registry：`~/.pie/profiles.json`
- Profile config：`<profile-home>/config.json`
- Secrets：`<profile-home>/.env`
- Profile-scoped skills：`<profile-home>/skills/`
- Pie/client runtime state：`sessions/`、`runtime/`
- Normalized agent event log：`runtime/agent-events.jsonl`
- Ousia framework state：`tasks/`、`projects/`、`docs/`，以及 Ousia Task Engine 写入的 `runtime/task-engine-*`

## Known Technical Debt

- `config-store` 和 `profile-registry` 需要更严格 schema 校验和清晰错误提示。
- `profiles.json`、`config.json`、`.env` 后续应使用 atomic write，避免 CLI 和 desktop 并发写半文件。
- 继续减少 runtime 对全局 `process.env` 的依赖；未来多 bot 同进程时，需要 per-profile config/env object。
- Desktop 使用 `desiredState` 表达“用户期望该 profile 随桌面端恢复运行”。agent 运行态用 `running/starting/paused/failed`，桌面选中态用 `selectedProfile`，不要把选中态混入 runtime 语义。
- 多 channel 路由策略仍未成为一等能力。当前不要实现默认 channel、owner channel、broadcast、指定 channel 等复杂路由；等第二个稳定 channel 真正和 Feishu 并行使用时再定。
- Feishu channel 仍有较多专用 conversation/progress 逻辑；Slack/Discord/Telegram 走 common text runtime。是否把 Feishu 也收敛到 common runtime，等现有 Feishu card/bubble 体验稳定后再评估。
- Observability 目前是 profile-scoped JSONL 日志、usage 文件和 normalized event sink，尚未形成完整 tracing/metrics 系统。后续如果扩展，应保持轻量，不引入复杂 telemetry。
- `runtime/agent-events.jsonl` 当前是 append-only event sink；后续如果用于 desktop timeline，应补 retention、读取 API 和错误容忍策略。
- 多 backend 抽象已经有轻量 registry，但 Codex/Hermes 仍属早期接入。不要在 Openclaw/Hermes 等 backend 稳定前继续扩大统一 Agent API。

## Coding Constraints

- 不恢复旧 `momo` 命名和旧兼容逻辑。
- 不恢复旧 memory/cognition/motivation 默认目录；长期记忆应作为新产品能力重新设计。
- Shell 能力以 `pi-coding-agent` 内置 `bash` 工具为准，不再叠自定义 exec/process 工具链。
- Feishu 回复不要依赖 Markdown 表格；优先使用普通段落和有序列表。
- 用户经常使用语音输入，消息里可能有 typo 或同音误写；按上下文直接理解即可，不要因为拼写问题反复确认。
