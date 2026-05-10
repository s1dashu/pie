import type { AgentConversationSessionPool, AgentSessionStatus } from "../../agents/session-runtime.js";

export type ImCommandName = "clear" | "compact" | "new" | "status";

export interface ImCommand {
	name: ImCommandName;
}

export interface HandleImCommandOptions {
	conversationKey: string;
	sessionPool: AgentConversationSessionPool;
	reply: (text: string) => Promise<void>;
}

export function parseImCommand(text: string): ImCommand | undefined {
	const trimmed = text.trim();
	if (!trimmed.startsWith("/")) {
		return undefined;
	}
	const [rawName, ...rest] = trimmed.slice(1).split(/\s+/);
	if (rest.length > 0) {
		return undefined;
	}
	const name = rawName?.toLowerCase();
	if (name === "compact") {
		return { name };
	}
	if (name === "clear") {
		return { name };
	}
	if (name === "new") {
		return { name };
	}
	if (name === "status") {
		return { name };
	}
	return undefined;
}

export async function handleImCommand(command: ImCommand, options: HandleImCommandOptions): Promise<void> {
	if (command.name === "status") {
		try {
			const status = options.sessionPool.getSessionStatus
				? await options.sessionPool.getSessionStatus(options.conversationKey)
				: await getBasicSessionStatus(options.sessionPool, options.conversationKey);
			await options.reply(formatSessionStatus(status));
		} catch (error) {
			await options.reply(`读取状态失败：${formatError(error)}`);
		}
		return;
	}

	if (command.name === "compact") {
		if (!options.sessionPool.compactSession) {
			await options.reply("当前 harness 还不支持主动压缩。可以使用 /new 开一个新会话。");
			return;
		}
		await options.reply("正在压缩当前会话上下文...");
		try {
			await options.sessionPool.compactSession(options.conversationKey);
			await options.reply("已压缩当前会话。后续消息会继续使用压缩后的上下文。");
		} catch (error) {
			await options.reply(`压缩失败：${formatError(error)}`);
		}
		return;
	}

	if (command.name === "clear") {
		if (!options.sessionPool.resetSession) {
			await options.reply("当前 harness 还不支持 /clear。");
			return;
		}
		try {
			await options.sessionPool.resetSession(options.conversationKey);
			await options.reply("已清空当前会话历史。");
		} catch (error) {
			await options.reply(`清空会话失败：${formatError(error)}`);
		}
		return;
	}

	if (!options.sessionPool.resetSession) {
		await options.reply("当前 harness 还不支持 /new。");
		return;
	}
	try {
		await options.sessionPool.resetSession(options.conversationKey);
		await options.reply("已开启新会话。");
	} catch (error) {
		await options.reply(`开启新会话失败：${formatError(error)}`);
	}
}

async function getBasicSessionStatus(
	sessionPool: AgentConversationSessionPool,
	conversationKey: string,
): Promise<AgentSessionStatus> {
	const session = await sessionPool.getSession(conversationKey);
	return {
		totalMessages: session.state?.messages.length ?? 0,
	};
}

function formatSessionStatus(status: AgentSessionStatus): string {
	const lines = ["当前会话状态：", `消息数：${status.totalMessages}`];
	const usage = status.contextUsage;
	if (!usage) {
		lines.push("Context：当前 harness 未提供上下文用量。");
		return lines.join("\n");
	}
	const windowText = formatTokens(usage.contextWindow);
	if (usage.tokens === null || usage.percent === null) {
		lines.push(`Context：未知 / ${windowText}`);
		lines.push("占用：未知（通常是刚压缩过，需要下一次模型回复后刷新）");
		return lines.join("\n");
	}
	lines.push(`Context：${formatTokens(usage.tokens)} / ${windowText}`);
	lines.push(`占用：${formatPercent(usage.percent)}`);
	return lines.join("\n");
}

function formatTokens(tokens: number): string {
	return `${Math.round(tokens).toLocaleString("en-US")} tokens`;
}

function formatPercent(percent: number): string {
	return `${percent.toFixed(1)}%`;
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
