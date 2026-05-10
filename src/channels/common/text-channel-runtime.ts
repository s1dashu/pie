#!/usr/bin/env node

import chalk from "chalk";
import { getAgentHarnessLabel } from "../../agents/harness-registry.js";
import {
	createAgentSessionPool,
	extractAssistantText,
	extractLastAssistantError,
	type AgentConversationSessionPool,
} from "../../agents/session-runtime.js";
import {
	getOwnerSessionBinding,
	loadConfigStore,
	type OwnerSessionBinding,
} from "../../core/config-store.js";
import { shouldRespondToImMessage } from "../../core/im-behavior.js";
import type { AgentRunInput, AgentRunOutput, AgentRunPort, AgentSessionStatus, ManagedRuntime, PieChannelKind } from "../../runtime/types.js";
import type { AgentPromptInputLike } from "../../agents/types.js";
import type { CommonChannelRuntimeConfig } from "./config.js";
import {
	buildAgentPromptInputFromMessageParts,
	type IncomingChannelMessage,
	type TextChannelAdapter,
} from "./channel-model.js";
import { ThinkingPresentationBuffer } from "./im-event-rendering.js";
import { handleImCommand, parseImCommand } from "./im-commands.js";
import { splitTextNaturally } from "./message-splitting.js";
import { getPresentationRules, type PresentationRules } from "./presentation-rules.js";
import { formatToolImErrorLine, formatToolImLine } from "./tool-call-im.js";
import {
	formatAgentTaskPrompt,
	isSilentAgentTask,
	rememberOwnerSessionBinding,
	ScheduledRunQueue,
} from "./run-orchestration.js";

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

interface QueuedTextRun {
	message: IncomingChannelMessage;
	promptText: string;
	promptInput: AgentPromptInputLike;
	resolve: (result: { assistantText: string; interrupted: boolean }) => void;
	reject: (error: unknown) => void;
}

class TextConversationController {
	private processing = false;
	private readonly pendingRequests: QueuedTextRun[] = [];

	constructor(
		private readonly conversationKey: string,
		private readonly runtime: TextChannelRuntime,
	) {}

	async submit(
		message: IncomingChannelMessage,
		promptText: string,
		promptInput: AgentPromptInputLike,
	): Promise<{ assistantText: string; interrupted: boolean }> {
		let resolvePromise: (result: { assistantText: string; interrupted: boolean }) => void = () => undefined;
		let rejectPromise: (error: unknown) => void = () => undefined;
		const completion = new Promise<{ assistantText: string; interrupted: boolean }>((resolve, reject) => {
			resolvePromise = resolve;
			rejectPromise = reject;
		});
		this.pendingRequests.push({ message, promptText, promptInput, resolve: resolvePromise, reject: rejectPromise });
		if (!this.processing) {
			void this.processPending();
		}
		return completion;
	}

	private async processPending(): Promise<void> {
		this.processing = true;
		try {
			for (;;) {
				const request = this.pendingRequests.shift();
				if (!request) {
					return;
				}
				await this.executeRequest(request);
			}
		} finally {
			this.processing = false;
		}
	}

	private async executeRequest(request: QueuedTextRun): Promise<void> {
		let unsubscribe: (() => void) | undefined;
		let pendingToolLines: string[] = [];
		let toolSendQueue = Promise.resolve();
		const thinkingBuffer = new ThinkingPresentationBuffer();
		const flushToolLines = (): Promise<void> => {
			if (!pendingToolLines.length) {
				return toolSendQueue;
			}
			const text = pendingToolLines.join("\n\n");
			pendingToolLines = [];
			toolSendQueue = toolSendQueue
				.then(() => this.runtime.sendPlainReply(request.message, text))
				.catch((error) => console.warn(chalk.gray(`${this.runtime.channelLabel} tool update skipped: ${formatError(error)}`)));
			return toolSendQueue;
		};
		const appendToolLine = (line: string): void => {
			if (this.runtime.getToolLinesPerMessage() <= 1) {
				void this.runtime.sendPlainReply(request.message, line).catch(() => undefined);
				return;
			}
			pendingToolLines.push(line);
			if (pendingToolLines.length >= this.runtime.getToolLinesPerMessage()) {
				void flushToolLines();
			}
		};
		const flushThinking = async (): Promise<void> => {
			const formattedThinking = thinkingBuffer.takeNextFormatted();
			if (!formattedThinking) {
				return;
			}
			await this.runtime.sendPlainReply(request.message, formattedThinking);
		};
		try {
			const session = await this.runtime.getSession(this.conversationKey);
			if (this.runtime.shouldOutputToolCallsToIm() || this.runtime.shouldOutputThinkingToIm()) {
				unsubscribe = session.subscribe((event) => {
					if (this.runtime.shouldOutputThinkingToIm()) {
						thinkingBuffer.ingest(event);
					}
					if (this.runtime.shouldOutputToolCallsToIm()) {
						if (event.type === "tool_call_started") {
							void flushThinking().catch(() => undefined);
							appendToolLine(formatToolImLine(event.name, event.args, this.runtime.getToolCallImMaxLength()));
						}
						if (event.type === "tool_call_finished" && event.isError) {
							appendToolLine(formatToolImErrorLine(event.name, event.result, this.runtime.getToolCallImMaxLength()));
						}
					}
				});
			}
			await session.prompt(request.promptInput);
			const providerError = extractLastAssistantError(session);
			if (providerError) {
				throw new Error(providerError);
			}
			const assistantText = extractAssistantText(session);
			if (this.runtime.shouldOutputThinkingToIm()) {
				await flushThinking();
			}
			await flushToolLines();
			await this.runtime.sendPlainReply(request.message, assistantText || "(empty response)");
			request.resolve({ assistantText, interrupted: false });
		} catch (error) {
			const message = formatError(error);
			console.error(chalk.red(`${this.runtime.channelLabel} run failed: ${message}`));
			await flushToolLines();
			await this.runtime.sendPlainReply(request.message, `消息处理失败：${message}`).catch(() => undefined);
			request.reject(error);
		} finally {
			unsubscribe?.();
			await toolSendQueue.catch(() => undefined);
		}
	}
}

export class TextChannelRuntime implements ManagedRuntime, AgentRunPort {
	readonly identity;
	readonly channelLabel: string;
	private readonly presentationRules: PresentationRules;
	private readonly sessionPool: AgentConversationSessionPool;
	private readonly conversations = new Map<string, TextConversationController>();
	private readonly seenMessageIds = new Set<string>();
	private readonly scheduledRuns = new ScheduledRunQueue();
	private shutdownExitCode = 0;

	constructor(
		private readonly config: CommonChannelRuntimeConfig,
		private readonly adapter: TextChannelAdapter,
		dependencies?: {
			sessionPool?: AgentConversationSessionPool;
		},
	) {
		this.channelLabel = titleCase(config.channelKind);
		this.presentationRules = getPresentationRules({ channel: config.channelKind });
		this.identity = {
			harness: config.harnessKind,
			channel: config.channelKind,
			homeDir: config.homeDir,
		};
		this.sessionPool = dependencies?.sessionPool ?? createAgentSessionPool({
			harnessKind: config.harnessKind,
			harnessConfig: config.harnessConfig,
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

	getToolLinesPerMessage(): number {
		return this.presentationRules.toolCalls.linesPerMessage;
	}

	async sendPlainReply(message: IncomingChannelMessage, text: string): Promise<void> {
		for (const chunk of this.splitOutgoingText(text)) {
			await this.adapter.sendText(message.target, chunk);
		}
	}

	private splitOutgoingText(text: string): string[] {
		const splitAfter = this.presentationRules.text.naturalSplitAfterChars;
		const maxChars = this.presentationRules.text.maxChars;
		if (!splitAfter || !maxChars) {
			return [text];
		}
		return splitTextNaturally(text, {
			naturalSplitAfterChars: splitAfter,
			maxChars,
			sentenceEndChars: this.presentationRules.text.sentenceEndChars,
		});
	}

	async deliverRun(request: AgentRunInput): Promise<{ sessionKey: string; assistantText: string }> {
		return this.enqueueScheduledAgentRun(request);
	}

	async createSession(sessionKey: string): Promise<void> {
		await this.sessionPool.getSession(sessionKey);
	}

	async getSessionStatus(sessionKey: string): Promise<AgentSessionStatus> {
		if (this.sessionPool.getSessionStatus) {
			return this.sessionPool.getSessionStatus(sessionKey);
		}
		const session = await this.sessionPool.getSession(sessionKey);
		return { totalMessages: session.state?.messages.length ?? 0 };
	}

	async compactSession(sessionKey: string): Promise<{ summary?: string }> {
		if (!this.sessionPool.compactSession) {
			throw new Error("This agent harness does not support /compact yet. Use /new to start a fresh session.");
		}
		return this.sessionPool.compactSession(sessionKey);
	}

	async clearSession(sessionKey: string): Promise<void> {
		if (!this.sessionPool.resetSession) {
			throw new Error("This agent harness does not support /clear yet.");
		}
		await this.sessionPool.resetSession(sessionKey);
		this.conversations.delete(sessionKey);
	}

	private printStartupSummary(): void {
		const sessionMode = this.config.resumeSessions ? "persistent" : "ephemeral";
		const lines = [
			chalk.bold(`${getAgentHarnessLabel(this.config.harnessKind)} ${this.channelLabel} channel ready`),
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
		rememberOwnerSessionBinding(ownerSession);
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
		const ownerSession = getOwnerSessionBinding(loadConfigStore());
		const shouldRespond = shouldRespondToImMessage({
			isDirectMessage: message.isDirectMessage,
			isBotMentioned: message.isBotMentioned,
			senderId: message.senderId,
			ownerId: ownerSession?.openId,
			groupResponseMode: this.config.groupResponseMode,
		});
		if (!shouldRespond) {
			console.log(chalk.gray(`${this.channelLabel} message ignored: group_policy ${message.conversationKey}`));
			return;
		}
		this.rememberOwnerSessionBinding(message);
		const promptInput = await buildAgentPromptInputFromMessageParts(message.parts);
		const promptText = promptInput.text;
		if (!promptText && !promptInput.images?.length) {
			console.log(chalk.gray(`${this.channelLabel} message ignored: empty_text ${message.conversationKey}`));
			await this.sendPlainReply(message, "Only text messages are supported.");
			return;
		}
		const command = parseImCommand(promptText);
		if (command) {
			await handleImCommand(command, {
				conversationKey: message.conversationKey,
				sessionPool: this.sessionPool,
				reply: (text) => this.sendPlainReply(message, text),
			});
			return;
		}
		console.log(chalk.cyan(`${this.channelLabel} message received: ${message.conversationKey} ${promptText.slice(0, 120)}`));
		await this.getConversationController(message.conversationKey).submit(message, promptText, promptInput);
	}

	private createSyntheticTaskMessage(ownerSession: OwnerSessionBinding, request: AgentRunInput): IncomingChannelMessage {
		return {
			id: `task:${request.sessionKey}:${Date.now()}`,
			channel: this.config.channelKind,
			conversationKey: ownerSession.sessionKey,
			target: { channelId: ownerSession.chatId, userId: ownerSession.openId },
			parts: [{ type: "text", text: formatAgentTaskPrompt(request.prompt) }],
			createdAtMs: Date.now(),
			isDirectMessage: true,
			senderId: ownerSession.openId,
		};
	}

	private async handleScheduledAgentRun(request: AgentRunInput): Promise<AgentRunOutput> {
		if (isSilentAgentTask(request)) {
			const session = await this.sessionPool.getSession(request.sessionKey);
			await session.prompt(request.prompt);
			return { sessionKey: request.sessionKey, assistantText: extractAssistantText(session) };
		}
		if (request.kind === "agent_task") {
			const ownerSession = getOwnerSessionBinding(loadConfigStore());
			if (!ownerSession) {
				throw new Error(`No owner session is bound yet. Send the ${this.channelLabel} channel a private message first.`);
			}
			const message = this.createSyntheticTaskMessage(ownerSession, request);
			const promptText = formatAgentTaskPrompt(request.prompt);
			const result = await this.getConversationController(ownerSession.sessionKey).submit(message, promptText, promptText);
			return { sessionKey: ownerSession.sessionKey, assistantText: result.assistantText };
		}
		const session = await this.sessionPool.getSession(request.sessionKey);
		await session.prompt(request.prompt);
		return { sessionKey: request.sessionKey, assistantText: extractAssistantText(session) };
	}

	private async enqueueScheduledAgentRun(request: AgentRunInput): Promise<AgentRunOutput> {
		return this.scheduledRuns.enqueue(request, (run) => this.handleScheduledAgentRun(run));
	}
}

export function titleCase(kind: PieChannelKind): string {
	return kind.slice(0, 1).toUpperCase() + kind.slice(1);
}
