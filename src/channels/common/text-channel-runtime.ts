#!/usr/bin/env node

import chalk from "chalk";
import {
	canSteerSession,
	createAgentSessionPool,
	extractAssistantText,
	extractLastAssistantError,
	type AgentConversationSessionPool,
} from "../../agents/session-runtime.js";
import {
	getOwnerSessionBinding,
	loadConfigStore,
	saveConfigStore,
	setOwnerSessionBinding,
	type OwnerSessionBinding,
} from "../../core/config-store.js";
import type { AgentTurnInput, AgentTurnPort, ManagedRuntime, PieChannelKind } from "../../runtime/types.js";
import type { CommonChannelRuntimeConfig } from "./config.js";
import { extractTextPart, type IncomingChannelMessage, type TextChannelAdapter } from "./channel-model.js";
import { formatToolImErrorLine, formatToolImLine } from "./tool-call-im.js";

function formatBackendLabel(kind: CommonChannelRuntimeConfig["backendKind"]): string {
	if (kind === "ousia") {
		return "Ousia";
	}
	if (kind === "codex") {
		return "Codex";
	}
	if (kind === "hermes") {
		return "Hermes";
	}
	return "Pi Coding Agent";
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function formatTaskPrompt(prompt: string): string {
	const trimmed = prompt.trim();
	if (!trimmed) {
		throw new Error("Task prompt is empty.");
	}
	return trimmed.startsWith("Task:") ? trimmed : `Task: ${trimmed}`;
}

function formatThinkingForIm(text: string): string {
	return text
		.trim()
		.split(/\r?\n/)
		.map((line) => `> ${line}`)
		.join("\n");
}

interface QueuedTextTurn {
	message: IncomingChannelMessage;
	promptText: string;
	resolve: (result: { assistantText: string; interrupted: boolean }) => void;
	reject: (error: unknown) => void;
}

class TextConversationController {
	private processing = false;
	private pendingRequest?: QueuedTextTurn;

	constructor(
		private readonly conversationKey: string,
		private readonly runtime: TextChannelRuntime,
	) {}

	async submit(message: IncomingChannelMessage, promptText: string): Promise<{ assistantText: string; interrupted: boolean }> {
		let resolvePromise: (result: { assistantText: string; interrupted: boolean }) => void = () => undefined;
		let rejectPromise: (error: unknown) => void = () => undefined;
		const completion = new Promise<{ assistantText: string; interrupted: boolean }>((resolve, reject) => {
			resolvePromise = resolve;
			rejectPromise = reject;
		});
		if (this.pendingRequest) {
			this.pendingRequest.resolve({ assistantText: "", interrupted: true });
		}
		this.pendingRequest = { message, promptText, resolve: resolvePromise, reject: rejectPromise };
		if (this.processing && await this.trySteerCurrentRun(this.pendingRequest)) {
			this.pendingRequest = undefined;
			return completion;
		}
		if (!this.processing) {
			void this.processPending();
		}
		return completion;
	}

	private async trySteerCurrentRun(request: QueuedTextTurn): Promise<boolean> {
		try {
			const session = await this.runtime.getSession(this.conversationKey);
			if (!session.isStreaming || !canSteerSession(session)) {
				return false;
			}
			await session.steer?.(request.promptText);
			await this.runtime.sendPlainReply(request.message, "已补充到当前正在处理的任务。");
			request.resolve({ assistantText: "", interrupted: false });
			return true;
		} catch (error) {
			console.warn(chalk.gray(`${this.runtime.channelLabel} steer skipped: ${formatError(error)}`));
			return false;
		}
	}

	private async processPending(): Promise<void> {
		this.processing = true;
		try {
			for (;;) {
				const request = this.pendingRequest;
				this.pendingRequest = undefined;
				if (!request) {
					return;
				}
				await this.executeRequest(request);
			}
		} finally {
			this.processing = false;
		}
	}

	private async executeRequest(request: QueuedTextTurn): Promise<void> {
		let unsubscribe: (() => void) | undefined;
		let thinkingText = "";
		let flushedThinkingLength = 0;
		const flushThinking = async (): Promise<void> => {
			const nextText = thinkingText.slice(flushedThinkingLength);
			if (!nextText.trim()) {
				return;
			}
			flushedThinkingLength = thinkingText.length;
			await this.runtime.sendPlainReply(request.message, formatThinkingForIm(nextText));
		};
		try {
			const session = await this.runtime.getSession(this.conversationKey);
			if (this.runtime.shouldOutputToolCallsToIm() || this.runtime.shouldOutputThinkingToIm()) {
				unsubscribe = session.subscribe((event) => {
					if (this.runtime.shouldOutputThinkingToIm() && event.type === "thinking_delta" && event.delta) {
						thinkingText += event.delta;
					}
					if (this.runtime.shouldOutputThinkingToIm() && event.type === "thinking_finished" && event.thinking) {
						thinkingText = event.thinking;
					}
					if (this.runtime.shouldOutputToolCallsToIm()) {
						if (event.type === "tool_call_started") {
							void flushThinking().catch(() => undefined);
							void this.runtime
								.sendPlainReply(request.message, formatToolImLine(event.name, event.args, this.runtime.getToolCallImMaxLength()))
								.catch(() => undefined);
						}
						if (event.type === "tool_call_finished" && event.isError) {
							void this.runtime
								.sendPlainReply(request.message, formatToolImErrorLine(event.name, event.result, this.runtime.getToolCallImMaxLength()))
								.catch(() => undefined);
						}
					}
				});
			}
			await session.prompt(request.promptText);
			const providerError = extractLastAssistantError(session);
			if (providerError) {
				throw new Error(providerError);
			}
			const assistantText = extractAssistantText(session);
			if (this.runtime.shouldOutputThinkingToIm()) {
				await flushThinking();
			}
			await this.runtime.sendPlainReply(request.message, assistantText || "(empty response)");
			request.resolve({ assistantText, interrupted: false });
		} catch (error) {
			const message = formatError(error);
			console.error(chalk.red(`${this.runtime.channelLabel} turn failed: ${message}`));
			await this.runtime.sendPlainReply(request.message, `消息处理失败：${message}`).catch(() => undefined);
			request.reject(error);
		} finally {
			unsubscribe?.();
		}
	}
}

export class TextChannelRuntime implements ManagedRuntime, AgentTurnPort {
	readonly identity;
	readonly channelLabel: string;
	private readonly sessionPool: AgentConversationSessionPool;
	private readonly conversations = new Map<string, TextConversationController>();
	private readonly seenMessageIds = new Set<string>();
	private readonly scheduledTurnQueues = new Map<string, Promise<void>>();
	private shutdownExitCode = 0;

	constructor(
		private readonly config: CommonChannelRuntimeConfig,
		private readonly adapter: TextChannelAdapter,
	) {
		this.channelLabel = titleCase(config.channelKind);
		this.identity = {
			backend: config.backendKind,
			channel: config.channelKind,
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
		this.printStartupSummary();
		await this.adapter.start({ onMessage: (message) => this.handleMessage(message) });
		return this.shutdownExitCode;
	}

	async stop(): Promise<void> {
		await this.adapter.stop();
	}

	setShutdownExitCode(code: number): void {
		this.shutdownExitCode = code;
	}

	getSession(conversationKey: string) {
		return this.sessionPool.getSession(conversationKey);
	}

	shouldOutputToolCallsToIm(): boolean {
		return this.config.outputToolCallsToIm;
	}

	shouldOutputThinkingToIm(): boolean {
		return this.config.outputThinkingToIm;
	}

	getToolCallImMaxLength() {
		return this.config.outputToolCallImMaxLength;
	}

	async sendPlainReply(message: IncomingChannelMessage, text: string): Promise<void> {
		await this.adapter.sendText(message.target, text);
	}

	async deliverTurn(request: AgentTurnInput): Promise<{ sessionKey: string; assistantText: string }> {
		return this.enqueueScheduledAgentTurn(request);
	}

	private printStartupSummary(): void {
		const sessionMode = this.config.resumeSessions ? "persistent" : "ephemeral";
		const lines = [
			chalk.bold(`${formatBackendLabel(this.config.backendKind)} ${this.channelLabel} channel ready`),
			chalk.gray(`model      ${this.config.modelLabel}`),
			chalk.gray(`tools      ${this.config.toolLabel}`),
			chalk.gray(`thinking   ${this.config.thinkingLevel}`),
			chalk.gray(`sessions   ${sessionMode}`),
			chalk.gray(`status     waiting for ${this.channelLabel} events...`),
		];
		console.log(lines.join("\n"));
	}

	private rememberOwnerSessionBinding(message: IncomingChannelMessage): void {
		if (!message.isDirectMessage) {
			return;
		}
		const ownerSession: OwnerSessionBinding = {
			chatId: message.target.channelId,
			sessionKey: message.conversationKey,
			openId: message.senderId,
			updatedAt: new Date().toISOString(),
		};
		const store = loadConfigStore();
		const existing = getOwnerSessionBinding(store);
		if (
			existing &&
			existing.chatId === ownerSession.chatId &&
			existing.sessionKey === ownerSession.sessionKey &&
			existing.openId === ownerSession.openId
		) {
			return;
		}
		saveConfigStore(setOwnerSessionBinding(store, ownerSession));
	}

	private getConversationController(conversationKey: string): TextConversationController {
		let controller = this.conversations.get(conversationKey);
		if (!controller) {
			controller = new TextConversationController(conversationKey, this);
			this.conversations.set(conversationKey, controller);
		}
		return controller;
	}

	private async handleMessage(message: IncomingChannelMessage): Promise<void> {
		if (this.seenMessageIds.has(message.id)) {
			return;
		}
		this.seenMessageIds.add(message.id);
		if (this.seenMessageIds.size > 2000) {
			this.seenMessageIds.clear();
		}
		if (message.createdAtMs < this.config.startedAtMs - 5000) {
			return;
		}
		this.rememberOwnerSessionBinding(message);
		const promptText = extractTextPart(message.parts);
		if (!promptText) {
			await this.sendPlainReply(message, "Only text messages are supported.");
			return;
		}
		console.log(chalk.cyan(`${this.channelLabel} message received: ${message.conversationKey} ${promptText.slice(0, 120)}`));
		await this.getConversationController(message.conversationKey).submit(message, promptText);
	}

	private createSyntheticTaskMessage(ownerSession: OwnerSessionBinding, request: AgentTurnInput): IncomingChannelMessage {
		return {
			id: `task:${request.sessionKey}:${Date.now()}`,
			channel: this.config.channelKind,
			conversationKey: ownerSession.sessionKey,
			target: { channelId: ownerSession.chatId, userId: ownerSession.openId },
			parts: [{ type: "text", text: formatTaskPrompt(request.prompt) }],
			createdAtMs: Date.now(),
			isDirectMessage: true,
			senderId: ownerSession.openId,
		};
	}

	private async handleScheduledAgentTurn(request: AgentTurnInput): Promise<{ sessionKey: string; assistantText: string }> {
		if (request.kind === "agent_task") {
			const ownerSession = getOwnerSessionBinding(loadConfigStore());
			if (!ownerSession) {
				throw new Error(`No owner session is bound yet. Send the ${this.channelLabel} channel a private message first.`);
			}
			const message = this.createSyntheticTaskMessage(ownerSession, request);
			const result = await this.getConversationController(ownerSession.sessionKey).submit(message, formatTaskPrompt(request.prompt));
			return { sessionKey: ownerSession.sessionKey, assistantText: result.assistantText };
		}
		const session = await this.sessionPool.getSession(request.sessionKey);
		await session.prompt(request.prompt);
		return { sessionKey: request.sessionKey, assistantText: extractAssistantText(session) };
	}

	private resolveScheduledTurnQueueKey(request: AgentTurnInput): string {
		if (request.kind !== "agent_task") {
			return request.sessionKey;
		}
		return getOwnerSessionBinding(loadConfigStore())?.sessionKey ?? request.sessionKey;
	}

	private async enqueueScheduledAgentTurn(request: AgentTurnInput): Promise<{ sessionKey: string; assistantText: string }> {
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
}

export function titleCase(kind: PieChannelKind): string {
	return kind.slice(0, 1).toUpperCase() + kind.slice(1);
}
