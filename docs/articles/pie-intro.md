# 我做了一个可以将 Codex/Hermes/OpenClaw 发布到微信/飞书的开源项目

我最近做了一个开源项目，叫 **Pie**。

GitHub 项目地址：[https://github.com/s1dashu/pie](https://github.com/s1dashu/pie)

一句话介绍：**Pie 是一个个人 Agent 客户端，用来把 Codex、Hermes、OpenClaw、Pi 等 Agent 快速发布到飞书、微信、Discord 等 IM 渠道，并在桌面端集中管理它们的运行状态、模型、Skills 和聊天行为。**

<video controls playsinline poster="https://pieim.com/articles/pie-intro/intro-preview.gif" src="https://pieim.com/articles/pie-intro/intro.mp4" width="100%"></video>

我做 Pie 的原因很简单：现在 Agent 的能力越来越强，但很多 Agent 仍然停留在命令行、网页或单独工具里，离我们每天真正工作的地方还有一段距离。

而真实的工作流，大量发生在 IM 里。

我们在飞书里讨论需求，在微信里同步事情，在 Discord 里协作项目。很多时候，Agent 不应该只是一个需要我主动打开的工具，而应该可以进入这些日常对话场景，成为一个能被提到、被分配任务、能持续工作的助手。

Pie 想解决的就是这个问题。

## 1. 把 Agent 快速发布到 IM 渠道

Pie 的第一个核心功能，是把不同 Agent 接到 IM 里。

你可以在 Pie 里创建一个 Agent，选择它背后的能力来源，比如 Codex、Hermes、OpenClaw 或 Pi，然后选择要接入的渠道，比如飞书、微信、Discord。

![创建 Agent](https://pieim.com/articles/pie-intro/create-agent.png)

配置完成后，这个 Agent 就可以在对应的聊天环境里工作。

这件事的价值不是“多了一个聊天入口”，而是 Agent 终于可以进入真实协作流：

- 在飞书群里，让 Agent 整理信息、跟进问题、执行任务。
- 在微信里，给个人 Agent 发自然语言指令。
- 在 Discord 频道里，接入特定用途的 Agent。
- 未来有新的 IM 渠道，也可以继续接入 Pie。

![IM 渠道配置](https://pieim.com/articles/pie-intro/im-channel-config.png)

Pie 不想重新发明 Codex、Hermes、OpenClaw 或 Pi。它更像是一个发布和连接层，让这些 Agent 能出现在用户真正工作的地方。

## 2. 集中管理多个 Agent

真正用起 Agent 后，一个人往往不会只有一个 Agent。

你可能会有一个 Agent 专门处理代码问题，一个 Agent 负责群里的日常答疑，一个 Agent 用来跑长期任务，一个 Agent 只服务某个频道。

如果这些 Agent 都靠命令行、配置文件和临时脚本维护，很快就会变得混乱：

- 哪个 Agent 正在运行？
- 哪个 Agent 已经停止？
- 每个 Agent 接了哪个 IM 渠道？
- 用的是哪个模型？
- 配了哪些 Skills？
- 日志在哪里看？
- 重启电脑后哪些 Agent 应该自动恢复？

Pie 提供了一个桌面端，把这些东西集中起来。

![Pie 桌面端总览](https://pieim.com/articles/pie-intro/desktop-overview.png)

你可以在一个地方创建 Agent、启动或暂停 Agent、查看运行状态、调整模型、管理 Skills、检查日志和本地目录。

它不是要把所有复杂度都藏掉，而是让这些复杂度有一个清楚的位置。

![Agent 运行配置](https://pieim.com/articles/pie-intro/agent-runtime.png)

对我来说，Pie 更像是一个个人 Agent 控制台。它让多个 Agent 不再散落在不同终端和配置文件里，而是变成可以被长期管理的本地工作实例。

## 3. 设置 Agent 在 IM 里的行为

把 Agent 接进 IM 之后，另一个很重要的问题是：它应该怎么说话。

不同场景对 Agent 的行为要求不一样。

有些任务需要透明。比如代码修复、复杂排查、长任务执行，用户可能希望看到 Agent 的思考过程、工具调用过程和当前进展。

有些场景需要安静。比如在群聊里，Agent 不应该把中间过程刷满屏，也不应该每个人说一句话它都响应。

所以 Pie 会把这些 IM 行为做成可配置项：

- 是否展示思考过程；
- 是否展示工具调用过程；
- 是否响应非 Owner 的消息；
- 是否静默潜水，不响应任何消息。

我觉得这件事很关键。

一个能接进 IM 的 Agent，不只是“模型加消息接口”。它需要知道自己在什么场合、面对谁、应该多主动、应该多透明、什么时候保持安静。

Pie 不是只解决“Agent 能不能回复”的问题，而是解决“Agent 如何在聊天场景里更自然地存在”的问题。

## 本地调试和日志

除了 IM 场景，Pie 也提供了本地调试和日志查看能力。

有时候你不想直接去群里测试 Agent，可以先在桌面端用本地聊天检查效果。

![本地调试聊天](https://pieim.com/articles/pie-intro/local-chat.png)

如果 Agent 运行异常，也可以直接看运行日志，而不是在多个终端和文件夹之间来回找。

![运行日志](https://pieim.com/articles/pie-intro/runtime-logs.png)

## Pie 当前处于什么状态

Pie 现在还是早期项目。

目前 Pie 支持微信、飞书和 Discord，Telegram 和 Slack 还在支持中。

Codex、Hermes、OpenClaw、Pi 这些 Agent 能力会以不同方式接入 Pie。Pie 不替代它们，而是让它们更容易被发布到 IM、被管理、被长期使用。

所以再总结一下：

**Pie 是一个个人 Agent 客户端，用来把不同 Agent 发布到 IM 渠道，并集中管理它们的运行、配置和聊天行为。**

它解决的不是“再造一个 Agent”的问题，而是解决 Agent 进入日常工作流之后，如何连接、如何管理、如何不打扰、如何长期使用的问题。
