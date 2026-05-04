import type { AgentConversationSessionPool } from "../../agents/session-runtime.js";

export type ImCommandName = "compact" | "new";

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
	if (name === "new") {
		return { name };
	}
	return undefined;
}

export async function handleImCommand(command: ImCommand, options: HandleImCommandOptions): Promise<void> {
	if (command.name === "compact") {
		if (!options.sessionPool.compactSession) {
			await options.reply("当前 backend 还不支持主动压缩。可以使用 /new 开一个新会话。");
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

	if (!options.sessionPool.resetSession) {
		await options.reply("当前 backend 还不支持 /new。");
		return;
	}
	try {
		await options.sessionPool.resetSession(options.conversationKey);
		await options.reply("已开启新会话。下一条消息会从干净上下文开始。");
	} catch (error) {
		await options.reply(`开启新会话失败：${formatError(error)}`);
	}
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
