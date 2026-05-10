#!/usr/bin/env node

import process from "node:process";
import { Bot } from "grammy";
import type { Context } from "grammy";
import { TextChannelRuntime } from "../common/text-channel-runtime.js";
import type { ChannelMessagePart, IncomingChannelMessage, TextChannelAdapter } from "../common/channel-model.js";
import { ChannelTokenLock } from "../common/token-lock.js";
import { loadConfig, type TelegramBotConfig } from "./config.js";

class TelegramAdapter implements TextChannelAdapter {
	readonly kind = "telegram" as const;
	private readonly bot: Bot;
	private readonly lock: ChannelTokenLock;

	constructor(private readonly config: TelegramBotConfig) {
		this.bot = new Bot(config.telegram.token);
		this.lock = new ChannelTokenLock(config.homeDir, "telegram", config.telegram.token);
	}

	async start(handlers: { onMessage: (message: IncomingChannelMessage) => Promise<void> }): Promise<void> {
		this.lock.acquire();
		this.bot.on("message", async (ctx) => {
			const incoming = this.toIncomingMessage(ctx);
			if (incoming) {
				await handlers.onMessage(incoming);
			}
		});
		await this.bot.start({
			drop_pending_updates: true,
			onStart: (info) => {
				console.log(`Telegram bot authenticated: @${info.username}`);
			},
		});
	}

	async stop(): Promise<void> {
		await this.bot.stop().catch(() => undefined);
		this.lock.release();
	}

	async sendText(target: { channelId: string; threadId?: string }, text: string): Promise<void> {
		await this.bot.api.sendMessage(target.channelId, text, {
			reply_parameters: target.threadId ? { message_id: Number(target.threadId) } : undefined,
		});
	}

	private toIncomingMessage(ctx: Context): IncomingChannelMessage | undefined {
		const message = ctx.message;
		if (!message) {
			return undefined;
		}
		const chatId = String(message.chat.id);
		const messageId = String(message.message_id);
		const text = "text" in message && typeof message.text === "string" ? message.text : undefined;
		const caption = "caption" in message && typeof message.caption === "string" ? message.caption : undefined;
		const mentioned = Boolean(
			this.config.telegram.botUsername &&
			((text ?? caption ?? "").includes(`@${this.config.telegram.botUsername}`)),
		);
		const parts: ChannelMessagePart[] = text || caption ? [{ type: "text", text: text ?? caption ?? "" }] : [];
		if ("photo" in message && message.photo?.length) {
			parts.push({ type: "image" as const, altText: caption });
		}
		if ("document" in message && message.document) {
			parts.push({
				type: "file" as const,
				name: message.document.file_name ?? `telegram-${message.document.file_id}`,
				mimeType: message.document.mime_type,
			});
		}
		return {
			id: `${chatId}:${messageId}`,
			channel: "telegram",
			conversationKey: `telegram:${chatId}`,
			target: { channelId: chatId, threadId: messageId, userId: message.from?.id ? String(message.from.id) : undefined },
			parts,
			createdAtMs: message.date * 1000,
			isDirectMessage: message.chat.type === "private",
			isBotMentioned: mentioned,
			senderId: message.from?.id ? String(message.from.id) : undefined,
		};
	}
}

export function createTelegramBotRuntime(config: TelegramBotConfig): TextChannelRuntime {
	return new TextChannelRuntime(config, new TelegramAdapter(config));
}

export async function runTelegramBot(nextConfig: TelegramBotConfig = loadConfig()): Promise<number> {
	const runtime = createTelegramBotRuntime(nextConfig);
	const onSigint = (): void => {
		runtime.setShutdownExitCode(130);
		void runtime.stop();
	};
	const onSigterm = (): void => {
		runtime.setShutdownExitCode(143);
		void runtime.stop();
	};
	process.once("SIGINT", onSigint);
	process.once("SIGTERM", onSigterm);
	try {
		return await runtime.start();
	} finally {
		process.off("SIGINT", onSigint);
		process.off("SIGTERM", onSigterm);
		await runtime.stop();
	}
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
	try {
		const code = await runTelegramBot();
		process.exit(code);
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}
}
