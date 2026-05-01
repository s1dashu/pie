# pie

## 项目定位

Pie 是一个个人 Agent 客户端产品，不是单纯的 coding bot。当前 runtime 基于 `@mariozechner/pi-coding-agent`，但长期目标是能管理不同 backend 的 agent，例如 Pi、Openclaw、Hermes。

核心原则：

- 保持架构小而清楚，避免为了未来可能性过早抽象。
- 先做好客户端产品体验和长期工作能力，再扩展复杂记忆、知识或插件系统。
- 当前产品未上线，没有历史用户包袱；不需要保留旧 `momo`、旧 config、旧 profile 兼容层。

## 当前真实状态

- 根目录 `pie` 是产品 runtime：desktop、CLI/onboard、Feishu channel、Task Engine、system prompt、agent home。
- `pi-feishu/` 是独立子包，定位为纯 Feishu/Lark channel package；不要把根目录产品能力写进子包文档。
- 当前完成度较高的 channel 只有 `feishu`；`wechat/slack/discord/telegram` 只能作为规划或占位，不要描述为已支持。
- 当前真正运行的 backend 是 Pi / `pi-coding-agent`；Openclaw、Hermes 只是架构预留。
- Task Engine 的 scheduled task、runtime heartbeat、webhook/external intake 仍偏原型；不要描述为稳定产品能力。

## 架构结论

- **一个 profile = 一个 agent instance。**
- 一个 agent instance 可以有多个 channels。未来同一个 bot 同时接 Feishu/Wechat/Slack 时，应该是同一个 profile 下挂多个 channel adapter，而不是多个独立 bot。
- `config.json` 使用新结构：`profile.backend + profile.channels[]`。
- 敏感信息只进 `<agent-home>/.env`，不要写入 `config.json`。
- instance-level 能力放在 `src/runtime/`，例如 `/agent/turn` gateway、Task Engine 管理。
- channel 目录只负责 channel adapter：收消息、发消息、channel 事件解析与投递，不负责启动 Task Engine 或通用 gateway。
- backend 抽象先保持轻量。等第二个 backend 真接入时，再提炼统一 Agent API。

## 关键入口

- `src/cli/index.ts`：根 CLI 入口；`npm run start` / `pie` 启动 runtime；`pie onboard` 或 `pie --onboard` 进入配置。
- `src/runtime/main.ts`：产品 runtime，初始化 agent home、启动 instance gateway、Task Engine 和当前可用 channel。
- `src/channels/feishu/main.ts`：Feishu channel adapter。
- `src/channels/feishu/session.ts`：Pi session pool、system prompt 注入、工具配置。
- `src/core/config-store.ts`：agent profile/config schema。
- `src/core/agent-home.ts`：`PIE_AGENT_HOME`、`.env`、agent home 路径。
- `src/task-engine/`：Task Engine；入口是 `engine.ts` 和 `runtime.ts`。
- `src/desktop/`：Electron desktop。

## Desktop UI 架构规划

这是当前阶段的 UI 架构规划，不是永远不变的规则；后续如果 shadcn/Base UI/Radix 生态或产品需求变化，可以重新调整。

- Desktop UI 采用 shadcn-style 的 source-owned components：组件源码放在项目里，由 Pie 自己维护视觉和 API。
- 新增 headless primitives 优先考虑 Base UI；存量 Radix primitives 可以继续保留，避免为了迁移而迁移。
- Tailwind CSS 是样式表达层，用来消费 Pie 的设计 tokens，不把零散 utility 当成设计系统本身。
- Pie 自己拥有设计 tokens：颜色、字号、圆角、间距、状态等应集中定义并逐步收敛。
- Radix Colors 可以作为颜色 scale 的主要来源；Radix Themes 的 typography scale 可以作为字号参考。
- Radix Themes components 不作为默认组件库，避免和 shadcn/Base UI + Tailwind 的样式控制模型混用；只有在明确隔离或临时原型场景下再考虑使用。

## 配置与状态

- 默认 Pie root：`~/.pie`
- 默认 profile home：`~/.pie/profiles/<profile-id>/`
- 可用 `PIE_AGENT_HOME` 或 `--home` 指定某个 profile home。
- profile registry：`~/.pie/profiles.json`
- profile config：`<profile-home>/config.json`
- secrets：`<profile-home>/.env`
- runtime state：`sessions/`、`tasks/`、`projects/`、`runtime/`、`docs/`

## 开发命令

- 根目录：`npm install`、`npm run check`、`npm run start`、`npm run build`
- Desktop：`npm run desktop:dev`、`npm run desktop:build`
- pi-feishu 子包：`cd pi-feishu && npm install && npm run check`

修改代码后至少跑 `npm run check`。涉及构建入口、desktop、runtime 时也跑对应 build。

## 近期技术债

- `config-store` 和 `profile-registry` 需要更严格 schema 校验和清晰错误提示。
- `profiles.json`、`config.json`、`.env` 后续应使用 atomic write，避免 CLI 和 desktop 并发写半文件。
- 继续减少 runtime 对全局 `process.env` 的依赖；未来多 bot 同进程时，需要 per-profile config/env object。
- Desktop 未来需要支持启动所有 `enabled` profiles；当前不要宣称已支持一次启动多个 bot。
- 多 channel adapter 抽象等第二个真实 channel 接入时再定，不要只根据 Feishu 过早设计。
- 多 backend 抽象等 Openclaw/Hermes 至少一个开始接入时再定。

## 开发约束

- 不恢复旧 `momo` 命名和旧兼容逻辑。
- 不恢复旧 memory/cognition/motivation 默认目录；长期记忆应作为新产品能力重新设计。
- Shell 能力以 `pi-coding-agent` 内置 `bash` 工具为准，不再叠自定义 exec/process 工具链。
- Feishu 回复不要依赖 Markdown 表格；优先使用普通段落和有序列表。
- 保持文档描述当前真实状态，不要把规划写成已完成能力。
- 用户经常使用语音输入，消息里可能有 typo 或同音误写；按上下文直接理解即可，不要因为拼写问题反复确认。
