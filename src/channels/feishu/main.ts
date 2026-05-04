#!/usr/bin/env node

import process from "node:process";
import * as Lark from "@larksuiteoapi/node-sdk";
import chalk from "chalk";
import { getAgentBackendLabel } from "../../agents/backend-registry.js";
import {
	createAgentSessionPool,
	extractAssistantText,
	type AgentConversationSessionPool,
} from "../../agents/session-runtime.js";
import {
	getOwnerSessionBinding,
	loadConfigStore,
	saveConfigStore,
	setOwnerSessionBinding,
	type OwnerSessionBinding,
} from "../../core/config-store.js";
import type { AgentTurnInput, AgentTurnPort, ManagedRuntime } from "../../runtime/types.js";
import { handleImCommand, parseImCommand } from "../common/im-commands.js";
import {
	extractPromptText,
	getConversationKey,
	isRecentMessage,
	MessageDedup,
	shouldHandleMessage,
} from "./messages.js";
import { ConversationController } from "./conversation-controller.js";
import { loadConfig, type FeishuBotConfig } from "./config.js";
import { type LarkMessageEvent, LarkClient } from "./platform/index.js";
import { sendPlainReply } from "./progress-reporter.js";

function formatRuntimeTitle(kind: FeishuBotConfig["backendKind"]): string {
	return `${getAgentBackendLabel(kind)} Feishu channel ready`;
}

function formatTaskPrompt(prompt: string): string {
	const trimmed = prompt.trim();
	if (!trimmed) {
		throw new Error("Task prompt is empty.");
	}
	return trimmed.startsWith("Task:") ? trimmed : `Task: ${trimmed}`;
}

export class FeishuBotRuntime implements ManagedRuntime, AgentTurnPort {
	readonly identity;
	private readonly dedup = new MessageDedup();
	private readonly abortController = new AbortController();
	private readonly sessionPool: AgentConversationSessionPool;
	private readonly conversations = new Map<string, ConversationController>();
	private readonly scheduledTurnQueues = new Map<string, Promise<void>>();
	private currentBotOpenId: string | undefined;
	private larkClient: LarkClient | undefined;
	private shutdownExitCode = 0;

	constructor(private readonly config: FeishuBotConfig) {
		this.identity = {
			backend: config.backendKind,
			channel: "feishu" as const,
			homeDir: config.homeDir,
		};
		this.sessionPool = createAgentSessionPool({
			backendKind: config.backendKind,
			backendConfig: config.backendConfig,
			homeDir: config.homeDir,
			model: config.model,
			modelId: config.modelId,
			assistantSystemPrompt: config.assistantSystemPrompt,
			thinkingLevel: config.thinkingLevel,
			tools: config.tools,
			debug: config.debug,
			verboseLogs: config.verboseLogs,
			resumeSessions: config.resumeSessions,
		});
	}

	async start(): Promise<number> {
		const client = LarkClient.fromConfig(this.config.feishu);
		const probe = await client.probe();
		if (!probe.ok) {
			throw new Error(`Lark probe failed: ${probe.error ?? "unknown error"}`);
		}
		this.currentBotOpenId = client.botOpenId;
		this.larkClient = client;

		this.printStartupSummary();

		try {
			await client.startWS({
				abortSignal: this.abortController.signal,
				wsLoggerLevel: Lark.LoggerLevel.error,
				handlers: {
					"im.message.receive_v1": async (data: unknown) => {
						await this.handleMessageEvent(data as LarkMessageEvent, client.botOpenId);
					},
					// Feishu sends this when a user opens the bot p2p chat. Pie has no
					// product action for it yet, but registering it keeps the SDK from
					// logging a misleading "no handle" warning for normal user entry.
					"im.chat.access_event.bot_p2p_chat_entered_v1": () => undefined,
					"im.message.reaction.created_v1": () => undefined,
					"im.message.reaction.deleted_v1": () => undefined,
				},
			});
		} finally {
			this.larkClient = undefined;
		}
		return this.shutdownExitCode;
	}

	async stop(): Promise<void> {
		this.larkClient?.disconnect();
		this.abortController.abort();
	}

	async deliverTurn(request: AgentTurnInput): Promise<{ sessionKey: string; assistantText: string }> {
		return this.enqueueScheduledAgentTurn(request);
	}

	private printStartupSummary(): void {
		const sessionMode = this.config.resumeSessions ? "persistent" : "ephemeral";
		const lines = [
			chalk.bold(formatRuntimeTitle(this.config.backendKind)),
			chalk.gray(`channel    Feishu`),
			chalk.gray(`model      ${this.config.modelLabel}`),
			chalk.gray(`tools      ${this.config.toolLabel}`),
			chalk.gray(`thinking   ${this.config.thinkingLevel}`),
			chalk.gray(`message    ${this.config.messageOutputMode}`),
			chalk.gray(`sessions   ${sessionMode}`),
			chalk.gray(`debug      ${this.config.debug ? "on" : "off"}`),
			chalk.gray(`verbose    ${this.config.verboseLogs ? "on" : "off"}`),
			chalk.gray("status     waiting for Feishu events..."),
		];
		console.log(lines.join("\n"));
	}

	private createSyntheticTaskEvent(ownerSession: OwnerSessionBinding, request: AgentTurnInput): LarkMessageEvent {
		const now = Date.now();
		return {
			sender: {
				sender_id: {
					open_id: ownerSession.openId,
				},
				sender_type: "system",
			},
			message: {
				message_id: `task:${request.sessionKey}:${now}`,
				create_time: String(now),
				chat_id: ownerSession.chatId,
				chat_type: "p2p",
				message_type: "text",
				content: JSON.stringify({
					text: formatTaskPrompt(request.prompt),
				}),
				user_agent: "ousia-task-engine",
			},
		};
	}

	private rememberOwnerSessionBinding(event: LarkMessageEvent): void {
		if (event.message.chat_type !== "p2p") {
			return;
		}
		const ownerSession: OwnerSessionBinding = {
			chatId: event.message.chat_id,
			sessionKey: getConversationKey(event),
			openId: event.sender.sender_id.open_id,
			updatedAt: new Date().toISOString(),
		};
		const store = loadConfigStore();
		const existing = getOwnerSessionBinding(store);
		if (!existing) {
			saveConfigStore(setOwnerSessionBinding(store, ownerSession));
			return;
		}
		const isSameOwner =
			existing.chatId === ownerSession.chatId || Boolean(existing.openId && existing.openId === ownerSession.openId);
		if (!isSameOwner) {
			return;
		}
		if (
			existing.chatId === ownerSession.chatId &&
			existing.sessionKey === ownerSession.sessionKey &&
			existing.openId === ownerSession.openId
		) {
			return;
		}
		saveConfigStore(setOwnerSessionBinding(store, ownerSession));
	}

	private async handleScheduledAgentTurn(request: AgentTurnInput): Promise<{
		sessionKey: string;
		assistantText: string;
	}> {
		if (request.kind === "agent_task") {
			const ownerSession = getOwnerSessionBinding(loadConfigStore());
			if (!ownerSession) {
				throw new Error("No owner session is bound yet. Send the bot a private message first.");
			}
			const event = this.createSyntheticTaskEvent(ownerSession, request);
			const promptText = extractPromptText(event, this.currentBotOpenId) ?? formatTaskPrompt(request.prompt);
			const controller = this.getConversationController(ownerSession.sessionKey);
			const result = await controller.submit(event, promptText);
			return {
				sessionKey: ownerSession.sessionKey,
				assistantText: result.assistantText,
			};
		}
		const session = await this.sessionPool.getSession(request.sessionKey);
		await session.prompt(request.prompt);
		return {
			sessionKey: request.sessionKey,
			assistantText: extractAssistantText(session),
		};
	}

	private resolveScheduledTurnQueueKey(request: AgentTurnInput): string {
		if (request.kind !== "agent_task") {
			return request.sessionKey;
		}
		return getOwnerSessionBinding(loadConfigStore())?.sessionKey ?? request.sessionKey;
	}

	private async enqueueScheduledAgentTurn(request: AgentTurnInput): Promise<{
		sessionKey: string;
		assistantText: string;
	}> {
		let result: { sessionKey: string; assistantText: string } | undefined;
		const queueKey = this.resolveScheduledTurnQueueKey(request);
		const previous = this.scheduledTurnQueues.get(queueKey) ?? Promise.resolve();
		const current = previous
			.catch(() => undefined)
			.then(async () => {
				result = await this.handleScheduledAgentTurn(request);
			})
			.finally(() => {
				if (this.scheduledTurnQueues.get(queueKey) === current) {
					this.scheduledTurnQueues.delete(queueKey);
				}
			});
		this.scheduledTurnQueues.set(queueKey, current);
		await current;
		if (!result) {
			throw new Error("Scheduled agent turn produced no result.");
		}
		return result;
	}

	private getConversationController(conversationKey: string): ConversationController {
		let controller = this.conversations.get(conversationKey);
		if (!controller) {
			controller = new ConversationController({
				conversationKey,
				config: this.config,
				sessionPool: this.sessionPool,
			});
			this.conversations.set(conversationKey, controller);
		}
		return controller;
	}

	private async handleMessageEvent(event: LarkMessageEvent, botOpenId: string | undefined): Promise<void> {
		const messageId = event.message.message_id;
		if (!this.dedup.record(messageId)) {
			return;
		}
		if (!isRecentMessage(event, this.config.startedAtMs)) {
			return;
		}
		if (!shouldHandleMessage(event, botOpenId)) {
			return;
		}
		this.rememberOwnerSessionBinding(event);

		const promptText = extractPromptText(event, botOpenId);
		if (!promptText) {
			await sendPlainReply(this.config.feishu, event, "Only text messages are supported.");
			return;
		}

		const conversationKey = getConversationKey(event);
		const command = parseImCommand(promptText);
		if (command) {
			await handleImCommand(command, {
				conversationKey,
				sessionPool: this.sessionPool,
				reply: async (text) => {
					await sendPlainReply(this.config.feishu, event, text);
				},
			});
			return;
		}
		console.log(chalk.cyan(`Message received: ${conversationKey} ${promptText.slice(0, 120)}`));
		const controller = this.getConversationController(conversationKey);
		await controller.submit(event, promptText);
	}

	setShutdownExitCode(code: number): void {
		this.shutdownExitCode = code;
	}
}

export function createFeishuBotRuntime(config: FeishuBotConfig): FeishuBotRuntime {
	return new FeishuBotRuntime(config);
}

function armForceExitAfterInterrupt(code: number): ReturnType<typeof setTimeout> {
	return setTimeout(() => {
		console.error("\n[pie/feishu] Graceful shutdown is taking too long; forcing exit.");
		process.exit(code);
	}, 2500);
}

export async function runFeishuBot(nextConfig: FeishuBotConfig = loadConfig()): Promise<number> {
	const runtime = createFeishuBotRuntime(nextConfig);
	let forceExitAfterInterruptTimer: ReturnType<typeof setTimeout> | undefined;
	let sigintCount = 0;

	const disarmForceExitAfterInterrupt = (): void => {
		if (forceExitAfterInterruptTimer != null) {
			clearTimeout(forceExitAfterInterruptTimer);
			forceExitAfterInterruptTimer = undefined;
		}
	};
	const requestStop = (code: number): void => {
		runtime.setShutdownExitCode(code);
		void runtime.stop();
		if (forceExitAfterInterruptTimer == null) {
			forceExitAfterInterruptTimer = armForceExitAfterInterrupt(code);
		}
	};
	const onSigint = (): void => {
		sigintCount += 1;
		if (sigintCount >= 2) {
			console.error("\n[pie/feishu] Second interrupt: forcing exit.");
			process.exit(130);
		}
		requestStop(130);
	};
	const onSigterm = (): void => requestStop(143);
	process.on("SIGINT", onSigint);
	process.on("SIGTERM", onSigterm);
	try {
		return await runtime.start();
	} finally {
		process.off("SIGINT", onSigint);
		process.off("SIGTERM", onSigterm);
		disarmForceExitAfterInterrupt();
	}
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
	try {
		const code = await runFeishuBot();
		process.exit(code);
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}
}
