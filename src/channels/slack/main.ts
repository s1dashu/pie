#!/usr/bin/env node

import process from "node:process";
import { App, LogLevel } from "@slack/bolt";
import { TextChannelRuntime } from "../common/text-channel-runtime.js";
import type { IncomingChannelMessage, TextChannelAdapter } from "../common/channel-model.js";
import { ChannelTokenLock } from "../common/token-lock.js";
import { loadConfig, type SlackBotConfig } from "./config.js";

function stripBotMention(text: string, botUserId: string | undefined): string {
	if (!botUserId) {
		return text.trim();
	}
	return text.replace(new RegExp(`<@${botUserId}>`, "g"), "").trim();
}

function isBotMessage(event: Record<string, unknown>): boolean {
	return Boolean(event.bot_id || event.subtype === "bot_message");
}

class SlackAdapter implements TextChannelAdapter {
	readonly kind = "slack" as const;
	private readonly app: App;
	private readonly lock: ChannelTokenLock;
	private botUserId: string | undefined;
	private resolveStopped: (() => void) | undefined;

	constructor(private readonly config: SlackBotConfig) {
		this.app = new App({
			token: config.slack.botToken,
			appToken: config.slack.appToken,
			signingSecret: config.slack.signingSecret || "pie-local-socket-mode",
			socketMode: true,
			logLevel: config.debug ? LogLevel.DEBUG : LogLevel.ERROR,
		});
		this.lock = new ChannelTokenLock(config.homeDir, "slack", `${config.slack.botToken}:${config.slack.appToken}`);
		this.botUserId = config.slack.botUserId;
	}

	async start(handlers: { onMessage: (message: IncomingChannelMessage) => Promise<void> }): Promise<void> {
		this.lock.acquire();
		const auth = await this.app.client.auth.test({ token: this.config.slack.botToken });
		this.botUserId = typeof auth.user_id === "string" ? auth.user_id : this.botUserId;
		this.app.message(async ({ message }) => {
			const incoming = this.toIncomingMessage(message as unknown as Record<string, unknown>);
			if (incoming) {
				await handlers.onMessage(incoming);
			}
		});
		await this.app.start();
		await new Promise<void>((resolve) => {
			this.resolveStopped = resolve;
		});
	}

	async stop(): Promise<void> {
		await this.app.stop().catch(() => undefined);
		this.resolveStopped?.();
		this.resolveStopped = undefined;
		this.lock.release();
	}

	async sendText(target: { channelId: string; threadId?: string }, text: string): Promise<void> {
		await this.app.client.chat.postMessage({
			token: this.config.slack.botToken,
			channel: target.channelId,
			text,
			thread_ts: target.threadId,
		});
	}

	private toIncomingMessage(event: Record<string, unknown>): IncomingChannelMessage | undefined {
		if (isBotMessage(event)) {
			return undefined;
		}
		const channelId = typeof event.channel === "string" ? event.channel : "";
		const ts = typeof event.ts === "string" ? event.ts : "";
		const userId = typeof event.user === "string" ? event.user : undefined;
		if (!channelId || !ts) {
			return undefined;
		}
		const rawText = typeof event.text === "string" ? event.text : "";
		const isDirectMessage = event.channel_type === "im";
		const mentioned = this.botUserId ? rawText.includes(`<@${this.botUserId}>`) : false;
		if (!isDirectMessage && !mentioned) {
			return undefined;
		}
		const threadTs = typeof event.thread_ts === "string" ? event.thread_ts : ts;
		const text = stripBotMention(rawText, this.botUserId);
		return {
			id: `slack:${channelId}:${ts}`,
			channel: "slack",
			conversationKey: `slack:${channelId}:${threadTs}`,
			target: { channelId, threadId: threadTs, userId },
			parts: text ? [{ type: "text", text }] : [],
			createdAtMs: Math.floor(Number(ts.split(".")[0] ?? Date.now() / 1000) * 1000),
			isDirectMessage,
			senderId: userId,
		};
	}
}

export function createSlackBotRuntime(config: SlackBotConfig): TextChannelRuntime {
	return new TextChannelRuntime(config, new SlackAdapter(config));
}

export async function runSlackBot(nextConfig: SlackBotConfig = loadConfig()): Promise<number> {
	const runtime = createSlackBotRuntime(nextConfig);
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
		const code = await runSlackBot();
		process.exit(code);
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}
}
