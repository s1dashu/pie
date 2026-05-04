# pie

## 项目定位

Pie 是一个个人 Agent 客户端产品，不是单纯的 coding bot。Pie 是客户端和产品名，不是 agent framework 名。当前 runtime 仍主要基于 `@mariozechner/pi-coding-agent` 的 session/tool 能力；产品侧可以选择不同 framework/backend，例如默认的 Pi，以及显式选择后才启用 Ousia runtime 能力的 Ousia。长期目标是能管理 Openclaw、Hermes 等更多 backend。

核心原则：

- 保持架构小而清楚，避免为了未来可能性过早抽象。
- 先做好客户端产品体验和长期工作能力，再扩展复杂记忆、知识或插件系统。
- 当前产品未上线，没有历史用户包袱；不需要保留旧 `momo`、旧 config、旧 profile 兼容层。

## 当前真实状态

- 根目录 `pie` 是客户端产品 runtime：desktop、CLI/onboard、channel adapters、profile/config/agent home 管理。
- 当前主要开发对象是桌面端；CLI/onboard、channel adapters 等能力服务于桌面端的 Agent 客户端体验。
- `pi-feishu/` 是独立子包，定位为纯 Feishu/Lark channel package；不要把根目录产品能力写进子包文档。
- 当前完成度较高的 channel 仍是 `feishu`；`wechat` 已有扫码登录、轮询和收发消息实现，但仍按早期集成处理；`slack/discord/telegram` 已有 adapter 和手动凭证入口，但首发前不要描述为稳定支持。
- 当前真正稳定运行的 backend/framework 是 Pi / `pi-coding-agent`，默认创建新 Agent 时选择 Pi。Ousia 是独立 framework：复用 `pi-coding-agent` session，但拥有自己的 Ousia system prompt、tools 配置、Task Engine 和 `/agent/turn` gateway。Codex、Hermes 已有 Pie 侧 adapter 雏形；Hermes 还可由 Pie 代管本地 gateway service，但仍按早期接入处理；Openclaw 只是架构预留。
- Task Engine 的 scheduled task、runtime heartbeat 仍偏原型；不要描述为稳定产品能力。

## 架构结论

- **一个 profile = 一个 agent instance。**
- 一个 agent instance 的 config 可以挂多个 channels。当前多 channel 主要是配置结构和启动能力预留，还没有完整的一等路由策略；未来同一个 bot 同时接 Feishu/Wechat/Slack 时，应该是同一个 profile 下挂多个 channel adapter，而不是多个独立 bot。
- `config.json` 使用新结构：`profile.backend + profile.channels[]`。
- 敏感信息只进 `<agent-home>/.env`，不要写入 `config.json`。
- Pie instance 编排入口放在 `src/runtime/`；agent/framework 层能力不要直接放在这里。
- channel 目录只负责 channel adapter：收消息、发消息、channel 事件解析与投递，不负责启动 Task Engine 或通用 gateway。
- backend/framework 抽象保持轻量，但注册入口要集中。当前通过 `src/agents/backend-registry.ts` 注册每种 backend 的 `AgentBackendAdapter`、`AgentFrameworkRuntime`、可选 managed backend service 和 backend skills 来源；不要再分别维护多套 backend capability 表。
- `AgentBackendAdapter` 是 conversation/session port，负责把 Pi、Codex、Hermes 等外部 backend 的会话能力适配成 Pie 的统一 session API 和事件协议。外部 framework/backend 源码不要改；所有协议差异在 Pie 自己的 adapter / normalizer 中处理。
- `AgentFrameworkRuntime` 是 framework companion，负责 Pie 为特定 framework 提供的附属生命周期能力，例如 system prompt 默认文件、agent home layout、Ousia Task Engine 和 turn gateway。它不负责 IM 收发，也不负责代管外部 backend 的核心 service process。
- Pie 内部 agent 事件协议以 `round -> turn -> text/thinking/tool_call` 为核心：`round` 表示用户一次完整请求触发的 agent 工作，`turn` 表示 round 内部一次 agent/backend 迭代；流式文本用 `text_start/text_delta/text_finished`，思考用 `thinking_start/thinking_delta/thinking_finished`，工具调用用 `tool_call_started/tool_call_updated/tool_call_finished`。Pi 原始的 `agent_start/agent_end/turn_start/turn_end/message_update/tool_execution_*` 通过 `src/agents/event-normalizer.ts` 映射为 Pie 事件；Codex/Hermes 等 Pie 侧 adapter 应优先直接 emit Pie 事件。Pie runtime、logging、usage、channel progress reporter 和 desktop timeline 后续都应只消费归一化后的 Pie 事件。
- `AgentConversationSession.prompt` 接收轻量 `AgentRoundInputLike`。当前实际能力仍是 text，但类型上已经为后续 file/image/attachment 输入留下扩展口；在真实附件能力实现前，不要把附件发送描述成已完成能力。
- Ousia 的 system prompt、Task Engine、turn gateway、project/task 关系都内聚在 `src/frameworks/ousia/`。Hermes gateway 启停属于 backend managed service，当前内聚在 `src/agents/backend-services/hermes.ts`。等 Openclaw/Hermes 等 backend 更稳定后，再考虑提炼更完整的统一 Agent API；不要为了预留而过早扩大抽象。
- Ousia Task Engine 的新任务统一写入 `tasks/<task-id>/task.json`；不要再创建 `projects/<project-id>/tasks/<task-id>/task.json`。Project 与 task 的关系通过 `task.json.projectId` 关联，`projects/` 保持为用户/project workspace 文件区。
- Pie runtime 有一层轻量 Runtime Environment 抽象，定义 agent 的 `homeDir`、`workDir` 和生命周期状态。当前只用它指定工作目录和管理生命周期，不做文件、网络、命令权限限制。默认 `workDir` 是 profile home；配置里优先使用 `profile.runtime.workDir`，旧的 `profile.backend.model.workDir` 仅作为兼容 fallback。

## Sandbox 未来规划

当前先不为 Pi/Ousia 实现 Pie 自己的 sandbox。`workDir` 只是 agent 默认工作目录，不是安全边界；不要把它描述成能阻止命令访问工作区外文件。

后续如果支持 sandbox，应放在 agent adapter 或具体命令/文件执行层，而不是给整个 Pie Desktop/runtime 进程套 sandbox。Pie 作为客户端需要读写 `~/.pie`、agent home、channel 凭证、skills 目录并启动不同 backend；整体 sandbox 容易破坏客户端能力，也会让 Electron 主进程、renderer 和子进程边界复杂化。

Sandbox 能力应按 backend capability 表达：

- Native sandbox：backend 自己提供执行层隔离，例如 Codex 的 `read-only`、`workspace-write`、`danger-full-access` 映射到 Codex app-server/CLI 的 sandbox。
- Pie sandbox：Pie 为不具备 native sandbox 的 backend 补执行层限制，例如未来在 Pi/Ousia 的 `bash`、`write`、`edit` 或 Task Engine exec runner 外包一层 macOS Seatbelt、Linux bubblewrap/Landlock、Windows restricted token。
- Workspace policy：只设置 `workDir`、工具开关和 system prompt 约束，不是安全 sandbox。Pi/Ousia 当前最多属于这一类。
- No sandbox/YOLO：不做文件或命令限制，接近当前用户终端权限。

产品 UI 可以统一叫 Access Mode，但文案必须区分 native sandbox、Pie sandbox 和 workspace policy。只有底层有真实 enforcement 时，才可以称为 sandbox。

Codex 的 permission/plan approval 后续应接入 IM 交互。Codex app-server 抛出 plan 或权限请求时，channel adapter 应发送可回复的确认消息；用户在 IM 中回复批准、拒绝或修改意见后，再由 Codex adapter 继续当前 turn 或发起实现 follow-up。当前不要把这项能力描述为已完成。

## 关键入口

- `src/cli/index.ts`：根 CLI 入口；`npm run start` / `pie` 启动 runtime；`pie onboard` 或 `pie --onboard` 进入配置。
- `src/runtime/main.ts`：Pie 客户端 runtime 编排入口，初始化 profile home，并按 `AgentBackendDefinition` 启动当前可用 channel、framework companion 和 managed backend service。
- `src/agents/backend-registry.ts`：backend 集中注册入口；每个 backend 同时声明 `AgentBackendAdapter`、`AgentFrameworkRuntime`、可选 managed backend service 和 backend skills 来源。
- `src/agents/types.ts`：Pie agent session port 与统一事件协议定义。
- `src/agents/event-normalizer.ts`：把 Pi 等外部 backend 的原始事件映射为 Pie 的 `round/turn/text/thinking/tool_call` 事件。
- `src/agents/event-sink.ts`：轻量 observability event sink，把 profile-scoped normalized agent events 写入 `runtime/agent-events.jsonl`。
- `src/agents/adapters/`：backend conversation/session adapters；只做 Pie 侧适配，不修改外部 framework/backend 源码。
- `src/agents/skills.ts`：Skills 来源 resolver，按 profile、backend/global、universal 三类返回目录来源。
- `src/channels/feishu/main.ts`：Feishu channel adapter。
- `src/channels/wechat/main.ts`：WeChat channel adapter；当前仍属于早期集成。
- `src/channels/common/`：Slack/Discord/Telegram 等 text channel adapter 共享 runtime。
- `src/agents/adapters/pi/session.ts`：Pi session pool、system prompt 注入、工具配置。channel 不应直接拥有 backend session pool。
- `src/core/backend-framework.ts`：`AgentFrameworkRuntime` 类型和 runtime companion 解析；backend 注册入口不要放在这里，统一放在 `src/agents/backend-registry.ts`。
- `src/frameworks/ousia/`：Ousia framework 项目边界；包含 Ousia system prompt、Task Engine、turn gateway、project/task/docs layout。`tasks/` 是唯一 Task Engine 数据域，`projects/` 不承载 task runtime 文件。
- `src/agents/backend-services/hermes.ts`：Hermes managed backend service；负责可选启动/管理 Hermes gateway，不承载通用 agent 事件协议。
- `src/runtime/environment.ts`：Runtime Environment 抽象，负责解析/创建工作目录并表达生命周期状态；当前不是安全沙盒。
- `src/core/config-store.ts`：agent profile/config schema。
- `src/core/agent-home.ts`：`PIE_AGENT_HOME`、`.env`、agent home 路径。
- `src/desktop/`：Electron desktop。

## Desktop UI 架构规划

这是当前阶段的 UI 架构规划，不是永远不变的规则；后续如果 shadcn/Base UI/Radix 生态或产品需求变化，可以重新调整。

- Desktop UI 明确采用 **Shadcn UI** 的 source-owned components 模式：组件源码放在项目里，由 Pie 自己维护视觉和 API，不把 shadcn 当成运行时组件库使用。
- 新增 Shadcn UI 组件时必须选择 **Base UI** 作为底层 primitive。使用 CLI 时在 renderer 项目内执行，并显式使用 `--base base` 初始化或查看文档，例如 `npx shadcn@latest init --base base --cwd src/desktop/renderer`、`npx shadcn@latest docs <component> --base base --cwd src/desktop/renderer`。
- 新增或迁移 headless primitives 时优先使用 Base UI；存量 Radix primitives 可以继续保留，避免为了迁移而迁移。新增 `components/ui/*` 不应引入新的 `@radix-ui/react-*` 依赖，除非本条规划被明确更新。
- Tailwind CSS 是样式表达层，用来消费 Pie 的设计 tokens，不把零散 utility 当成设计系统本身。
- Pie 自己拥有设计 tokens：颜色、字号、圆角、间距、状态等应集中定义并逐步收敛。
- Radix Colors 可以作为颜色 scale 的主要来源；Radix Themes 的 typography scale 可以作为字号参考。
- Radix Themes components 不作为默认组件库，避免和 shadcn/Base UI + Tailwind 的样式控制模型混用；只有在明确隔离或临时原型场景下再考虑使用。
- Desktop 全局设置里的深色/浅色模式仍在开发中，暂未支持；当前不要在设置 UI 暴露明暗主题切换，只保留已可用的外观收敛项。

## Desktop 视觉规范

当前桌面端视觉是低饱和、柔和圆角、信息密度适中的工具界面。默认不要做营销页式的大标题、大面积插画、强渐变或高饱和装饰；界面应优先让 Agent 状态、配置、日志和用量信息容易扫描。

### 色彩

- 主色系统基于 Radix Slate scale，并在 `src/desktop/renderer/src/styles.css` 中映射为语义 token：`background`、`foreground`、`muted`、`muted-foreground`、`border`、`input`、`ring`、`primary`、`accent` 等。新增 UI 优先消费这些语义 token 或 `var(--slate-*)`，不要随手写新的灰色 hex。
- 当前默认界面背景是浅灰层级：应用壳和页面背景多用 `var(--slate-2)` / `var(--slate-3)`，卡片多用 `var(--slate-2)`、白色或透明白，分隔、轨道和弱边界使用 `var(--slate-4)` 到 `var(--slate-6)`。
- 正文主文字使用 `text-foreground` / `var(--slate-12)`；次级说明、hint、路径、计数说明使用 `text-muted-foreground` / `var(--slate-11)`；弱图形、图表柱、进度条填充常用 `var(--slate-8)` 到 `var(--slate-10)`。
- Lime、Amber、Red 只作为状态色使用：Lime 表示运行、成功、可继续；Amber 表示等待、警告、需注意；Red 表示错误、危险、删除。不要把这些状态色扩展成大面积品牌背景。
- 外观设置可以通过 `src/desktop/renderer/src/lib/appearance-theme.ts` 调整 Slate 的 hue；因此新组件应保持对 Slate token 的依赖，让全局色相变化能自然生效。
- 深色模式 token 已有部分基础映射，但产品设置里暂未正式开放明暗主题切换。新增 UI 可以兼容 `.dark`，但不要把暗色主题当成已完成产品能力来写文案或入口。

### 字号

- 全局字体栈定义在 `styles.css`：Inter 优先，中文使用系统中文字体 fallback。不要在局部组件引入新的正文字体。
- Tailwind 字号 token 当前只收敛到 `text-xs`、`text-sm`、`text-base`、`text-lg`、`text-xl`、`text-2xl`，并统一 `letter-spacing: 0`。不要使用 viewport 字号、负字距或随意新增巨大 display 尺寸。
- 常规卡片标题使用 `text-base font-semibold leading-snug`，例如 `SectionTitle`。卡片副标题和 hint 使用 `text-xs leading-none` 或 `text-xs leading-5 text-muted-foreground`，避免比同区块标题抢眼。
- 表单 label、状态小字、路径、计数说明通常用 `text-xs font-medium` 或普通 `text-xs`；普通说明正文用 `text-sm`。
- 指标卡主数字保持克制：小指标卡用 `text-lg` 到 `text-2xl`，资源/详情卡主值用 `text-xl` 到 `text-2xl`。不要为了突出数据改成 `text-3xl` / `text-4xl`，除非这是明确的页面主 Hero 或弹窗主结果。
- 代码、路径、日志片段使用 `font-mono text-[11px]` 或接近尺寸，保持辅助信息属性，不要和正文层级混淆。

### 字重

- 默认正文使用正常字重；可点击项、表单 label、列表主标题常用 `font-medium`。
- 区块标题和卡片标题使用 `font-semibold`；指标数值使用 `font-bold`，并搭配 `tabular-nums` 保持数字稳定。
- 避免在同一卡片里堆叠多个 `font-bold` 层级。通常只让主指标或当前区块标题加重，副标题、hint、路径和说明保持 muted 普通字重。
- 大写标签仅用于概览指标类卡片，使用 `uppercase text-xs font-medium text-muted-foreground`；不要把普通导航、按钮或描述文案全大写。

## Desktop Skills 管理

桌面端要真正实现 Skills 管理，但当前管理能力的边界很轻：**展示分组 + 打开对应 folder**。不要把它设计成复杂的 marketplace、安装器、权限系统或插件运行时。

- Agent 独有 Skills：保存在该 Agent 自己 profile home 下的 `skills/`，例如 `<profile-home>/skills/`。
- 同类型 Agent 共享 Skills：来自同 backend / 同 agent 类型自己的全局目录，由 `src/agents/backend-registry.ts` 中的 backend 注册信息声明，再由 `src/agents/skills.ts` 统一解析。例如 Codex 使用 `~/.codex/skills/`，Pi/Ousia 当前使用 `~/.pi/skills/`。
- 通用 Skills：来自跨 agent 的全局目录 `~/.agents/skills/`。
- Desktop UI 中可以展示上述来源、路径和当前是否存在；主要操作是用系统文件管理器打开 folder。
- 如果目录不存在，可以在用户打开时创建目录，或明确显示为空目录状态；不要把缺目录解释成配置错误。
- Skills 的发现和展示只按目录来源分组。当前只做 resolver + 打开目录，不要在还没有真实需求前引入数据库、同步状态、marketplace、权限系统或插件运行时。

## 配置与状态

- 默认 Pie root：`~/.pie`
- 默认 profile home：`~/.pie/profiles/<profile-id>/`
- 可用 `PIE_AGENT_HOME` 或 `--home` 指定某个 profile home。
- profile registry：`~/.pie/profiles.json`
- profile config：`<profile-home>/config.json`
- secrets：`<profile-home>/.env`
- profile-scoped skills：`<profile-home>/skills/`
- Pie/client runtime state：`sessions/`、`runtime/`
- normalized agent event log：`runtime/agent-events.jsonl`
- Ousia framework state：`tasks/`、`projects/`、`docs/`，以及 Ousia Task Engine 写入的 `runtime/task-engine-*`。新 task 只写 `tasks/`，用 `projectId` 指向 project。

## 开发命令

- 根目录：`npm install`、`npm run check`、`npm run start`、`npm run build`
- Desktop：`npm run desktop:dev`、`npm run desktop:build`
- pi-feishu 子包：`cd pi-feishu && npm install && npm run check`

修改代码后至少跑 `npm run check`。涉及构建入口、desktop、runtime 时也跑对应 build。

## 近期技术债

- `config-store` 和 `profile-registry` 需要更严格 schema 校验和清晰错误提示。
- `profiles.json`、`config.json`、`.env` 后续应使用 atomic write，避免 CLI 和 desktop 并发写半文件。
- 继续减少 runtime 对全局 `process.env` 的依赖；未来多 bot 同进程时，需要 per-profile config/env object。
- Desktop 使用 `desiredState` 表达“用户期望该 profile 随桌面端恢复运行”。agent 运行态用 `running/starting/paused/failed`，桌面选中态用 `selectedProfile`，不要把选中态混入 runtime 语义。
- 多 channel 路由策略仍未成为一等能力。当前不要实现默认 channel、owner channel、broadcast、指定 channel 等复杂路由；等第二个稳定 channel 真正和 Feishu 并行使用时再定。
- Feishu channel 仍有较多专用 conversation/progress 逻辑；Slack/Discord/Telegram 走 common text runtime。是否把 Feishu 也收敛到 common runtime，等现有 Feishu card/bubble 体验稳定后再评估。
- Observability 目前是 profile-scoped JSONL 日志、usage 文件和 normalized event sink，尚未形成完整 tracing/metrics 系统。后续如果扩展，应保持轻量，不引入复杂 telemetry。
- `runtime/agent-events.jsonl` 当前是 append-only event sink；后续如果用于 desktop timeline，应补 retention、读取 API 和错误容忍策略。
- 多 backend 抽象已经有轻量 registry，但 Codex/Hermes 仍属早期接入。不要在 Openclaw/Hermes 等 backend 稳定前继续扩大统一 Agent API。

## 开发约束

- 不恢复旧 `momo` 命名和旧兼容逻辑。
- 不恢复旧 memory/cognition/motivation 默认目录；长期记忆应作为新产品能力重新设计。
- Shell 能力以 `pi-coding-agent` 内置 `bash` 工具为准，不再叠自定义 exec/process 工具链。
- Feishu 回复不要依赖 Markdown 表格；优先使用普通段落和有序列表。
- 保持文档描述当前真实状态，不要把规划写成已完成能力。
- 用户经常使用语音输入，消息里可能有 typo 或同音误写；按上下文直接理解即可，不要因为拼写问题反复确认。
