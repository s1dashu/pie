#!/usr/bin/env node

import process from "node:process";
import { DWClient, TOPIC_ROBOT, type DWClientDownStream } from "dingtalk-stream";
import { TextChannelRuntime } from "../common/text-channel-runtime.js";
import type { IncomingChannelMessage, TextChannelAdapter } from "../common/channel-model.js";
import { ChannelTokenLock } from "../common/token-lock.js";
import { loadConfig, type DingTalkBotConfig } from "./config.js";

interface DingTalkRobotMessage {
	conversationId?: string;
	conversationType?: string;
	msgId?: string;
	msgtype?: string;
	senderId?: string;
	senderStaffId?: string;
	createAt?: number;
	sessionWebhook?: string;
	sessionWebhookExpiredTime?: number;
	isInAtList?: boolean;
	text?: {
		content?: string;
	};
	content?: unknown;
}

function parseRobotMessage(payload: string): DingTalkRobotMessage | undefined {
	try {
		const parsed: unknown = JSON.parse(payload);
		return typeof parsed === "object" && parsed !== null ? parsed as DingTalkRobotMessage : undefined;
	} catch {
		return undefined;
	}
}

function extractText(message: DingTalkRobotMessage): string {
	const text = message.text?.content;
	if (typeof text === "string") {
		return stripLeadingMentions(text);
	}
	if (typeof message.content === "string") {
		return stripLeadingMentions(message.content);
	}
	if (typeof message.content === "object" && message.content !== null) {
		const contentText = (message.content as { text?: unknown }).text;
		if (typeof contentText === "string") {
			return stripLeadingMentions(contentText);
		}
	}
	return "";
}

function stripLeadingMentions(text: string): string {
	let current = text.trim();
	for (;;) {
		const next = current.replace(/^@\S+\s*/u, "").trim();
		if (next === current) {
			return current;
		}
		current = next;
	}
}

function isDirectMessage(message: DingTalkRobotMessage): boolean {
	return message.conversationType === "1";
}

class DingTalkAdapter implements TextChannelAdapter {
	readonly kind = "dingtalk" as const;
	private readonly client: DWClient;
	private readonly lock: ChannelTokenLock;
	private readonly sessionWebhooks = new Map<string, { url: string; expiredTime?: number }>();
	private accessToken: { value: string; expiresAtMs: number } | undefined;
	private resolveStopped: (() => void) | undefined;

	constructor(private readonly config: DingTalkBotConfig) {
		this.client = new DWClient({
			clientId: config.dingtalk.clientId,
			clientSecret: config.dingtalk.clientSecret,
			keepAlive: true,
			debug: config.debug,
			autoReconnect: true,
		} as ConstructorParameters<typeof DWClient>[0] & { autoReconnect: boolean });
		this.lock = new ChannelTokenLock(config.homeDir, "dingtalk", config.dingtalk.clientId);
	}

	async start(handlers: { onMessage: (message: IncomingChannelMessage) => Promise<void> }): Promise<void> {
		this.lock.acquire();
		this.client.registerCallbackListener(TOPIC_ROBOT, (downstream) => {
			void this.handleDownstream(downstream, handlers).catch((error) => {
				console.error(`DingTalk message handling failed: ${error instanceof Error ? error.message : String(error)}`);
			});
		});
		await this.client.connect();
		console.log(`DingTalk bot stream connected: ${this.config.dingtalk.clientId}`);
		await new Promise<void>((resolve) => {
			this.resolveStopped = resolve;
		});
	}

	async stop(): Promise<void> {
		this.client.disconnect();
		this.resolveStopped?.();
		this.resolveStopped = undefined;
		this.lock.release();
	}

	async sendText(target: { channelId: string; dingtalkSessionWebhook?: string; dingtalkSessionWebhookExpiredTime?: number }, text: string): Promise<void> {
		const webhook = this.resolveSessionWebhook(target);
		if (!webhook) {
			throw new Error(`No DingTalk sessionWebhook is available for conversation ${target.channelId}`);
		}
		const accessToken = await this.getAccessToken();
		const response = await fetch(webhook.url, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-acs-dingtalk-access-token": accessToken,
			},
			body: JSON.stringify({
				msgtype: "text",
				text: { content: text },
			}),
		});
		if (!response.ok) {
			throw new Error(`DingTalk send failed: HTTP ${response.status} ${await response.text().catch(() => "")}`);
		}
	}

	private async handleDownstream(
		downstream: DWClientDownStream,
		handlers: { onMessage: (message: IncomingChannelMessage) => Promise<void> },
	): Promise<void> {
		const messageId = downstream.headers?.messageId;
		if (messageId) {
			this.client.socketCallBackResponse(messageId, null);
		}
		const robotMessage = parseRobotMessage(downstream.data);
		const incoming = robotMessage ? this.toIncomingMessage(downstream, robotMessage) : undefined;
		if (incoming) {
			await handlers.onMessage(incoming);
		}
	}

	private toIncomingMessage(downstream: DWClientDownStream, message: DingTalkRobotMessage): IncomingChannelMessage | undefined {
		const conversationId = message.conversationId?.trim();
		const msgId = message.msgId?.trim() || downstream.headers?.messageId?.trim();
		if (!conversationId || !msgId) {
			return undefined;
		}
		const text = extractText(message);
		if (message.sessionWebhook) {
			this.sessionWebhooks.set(conversationId, {
				url: message.sessionWebhook,
				expiredTime: message.sessionWebhookExpiredTime,
			});
		}
		const directMessage = isDirectMessage(message);
		return {
			id: `dingtalk:${msgId}`,
			channel: "dingtalk",
			conversationKey: `dingtalk:${conversationId}`,
			target: {
				channelId: conversationId,
				threadId: msgId,
				userId: message.senderStaffId || message.senderId,
				dingtalkSessionWebhook: message.sessionWebhook,
				dingtalkSessionWebhookExpiredTime: message.sessionWebhookExpiredTime,
			},
			parts: text ? [{ type: "text", text }] : [],
			createdAtMs: typeof message.createAt === "number" ? message.createAt : Date.now(),
			isDirectMessage: directMessage,
			isBotMentioned: directMessage || message.isInAtList === true,
			senderId: message.senderStaffId || message.senderId,
		};
	}

	private resolveSessionWebhook(target: { channelId: string; dingtalkSessionWebhook?: string; dingtalkSessionWebhookExpiredTime?: number }): { url: string; expiredTime?: number } | undefined {
		const webhook = target.dingtalkSessionWebhook
			? { url: target.dingtalkSessionWebhook, expiredTime: target.dingtalkSessionWebhookExpiredTime }
			: this.sessionWebhooks.get(target.channelId);
		if (!webhook?.url) {
			return undefined;
		}
		if (webhook.expiredTime && webhook.expiredTime <= Date.now()) {
			this.sessionWebhooks.delete(target.channelId);
			return undefined;
		}
		return webhook;
	}

	private async getAccessToken(): Promise<string> {
		if (this.accessToken && this.accessToken.expiresAtMs > Date.now()) {
			return this.accessToken.value;
		}
		const token = await this.client.getAccessToken();
		if (typeof token !== "string" || !token.trim()) {
			throw new Error("DingTalk access token is empty");
		}
		this.accessToken = {
			value: token,
			expiresAtMs: Date.now() + 90 * 60 * 1000,
		};
		return token;
	}
}

export function createDingTalkBotRuntime(config: DingTalkBotConfig): TextChannelRuntime {
	return new TextChannelRuntime(config, new DingTalkAdapter(config));
}

export async function runDingTalkBot(nextConfig: DingTalkBotConfig = loadConfig()): Promise<number> {
	const runtime = createDingTalkBotRuntime(nextConfig);
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
		const code = await runDingTalkBot();
		process.exit(code);
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}
}
