#!/usr/bin/env node

import { join } from "node:path";
import process from "node:process";
import chalk from "chalk";
import { AGENT_HOME_SUBDIRS } from "../../core/agent-home-layout.js";
import {
	getOwnerSessionBinding,
	loadConfigStore,
	saveConfigStore,
	setOwnerSessionBinding,
	type OwnerSessionBinding,
} from "../../core/config-store.js";
import type { AgentTurnInput, AgentTurnPort, ManagedRuntime } from "../../runtime/types.js";
import { formatToolImErrorLine, formatToolImLine } from "../common/tool-call-im.js";
import { extractAssistantText, extractLastAssistantError, SessionPool } from "../feishu/session.js";
import { loadConfig, type WechatBotConfig } from "./config.js";
import { loginWechatWithQr } from "./login.js";
import {
	buildTextMessageReq,
	extractPromptText,
	getConversationKey,
	getWechatMessageId,
	isRecentMessage,
	MessageDedup,
	splitWechatText,
} from "./messages.js";
import { getUpdates, sendMessage, WechatApiError } from "./platform/api.js";
import type { WechatMessage } from "./platform/types.js";
import { ContextTokenStore, loadSyncBuf, saveSyncBuf } from "./state.js";

const MAX_CONSECUTIVE_FAILURES = 3;
const RETRY_DELAY_MS = 2000;
const BACKOFF_DELAY_MS = 30_000;
const WECHAT_SEND_INTERVAL_MS = 800;
const WECHAT_SEND_RET_MINUS_TWO_RETRY_DELAYS_MS = [1_000, 2_000, 5_000];
const SESSION_EXPIRED_ERRCODE = -14;
const SESSION_EXPIRED_RETRY_DELAYS_MS = [
	60 * 1000,
	2 * 60 * 1000,
	3 * 60 * 1000,
	60 * 60 * 1000,
];

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				reject(new Error("aborted"));
			},
			{ once: true },
		);
	});
}

function truncate(text: string, max = 600): string {
	return text.length > max ? `${text.slice(0, max)}...` : text;
}

function formatTaskPrompt(prompt: string): string {
	const trimmed = prompt.trim();
	if (!trimmed) {
		throw new Error("Task prompt is empty.");
	}
	return trimmed.startsWith("Task:") ? trimmed : `Task: ${trimmed}`;
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function formatWechatSendError(error: WechatApiError, text: string): string {
	return [
		`ret=${error.ret}`,
		`errcode=${error.errcode}`,
		`errmsg=${error.errmsg ?? ""}`,
		`chars=${text.length}`,
		`bytes=${Buffer.byteLength(text, "utf8")}`,
		`body=${error.responseBody ?? ""}`,
	].join(" ");
}

function formatDelay(ms: number): string {
	const minutes = Math.round(ms / 60_000);
	return `${minutes} 分钟`;
}

interface QueuedWechatTurn {
	message: WechatMessage;
	promptText: string;
	resolve: (result: { assistantText: string; interrupted: boolean }) => void;
	reject: (error: unknown) => void;
}

class WechatConversationController {
	private processing = false;
	private pendingRequest?: QueuedWechatTurn;

	constructor(
		private readonly conversationKey: string,
		private readonly runtime: WechatBotRuntime,
	) {}

	async submit(message: WechatMessage, promptText: string): Promise<{ assistantText: string; interrupted: boolean }> {
		let resolvePromise: (result: { assistantText: string; interrupted: boolean }) => void = () => undefined;
		let rejectPromise: (error: unknown) => void = () => undefined;
		const completion = new Promise<{ assistantText: string; interrupted: boolean }>((resolve, reject) => {
			resolvePromise = resolve;
			rejectPromise = reject;
		});
		if (this.pendingRequest) {
			this.pendingRequest.resolve({ assistantText: "", interrupted: true });
		}
		this.pendingRequest = {
			message,
			promptText,
			resolve: resolvePromise,
			reject: rejectPromise,
		};
		if (!this.processing) {
			void this.processPending();
		}
		return completion;
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

	private async executeRequest(request: QueuedWechatTurn): Promise<void> {
		let unsubscribe: (() => void) | undefined;
		let pendingToolLines: string[] = [];
		let toolSendQueue = Promise.resolve();
		let assistantSendQueue = Promise.resolve();
		let activeAssistantText = "";
		let sentAssistantText = false;
		const flushToolLines = (): Promise<void> => {
			if (!pendingToolLines.length) {
				return toolSendQueue;
			}
			const text = pendingToolLines.join("\n\n");
			pendingToolLines = [];
			toolSendQueue = toolSendQueue
				.then(() => this.runtime.sendPlainReply(request.message, text))
				.catch((error) => console.warn(chalk.gray(`Wechat tool update skipped: ${formatError(error)}`)));
			return toolSendQueue;
		};
		const appendToolLine = (line: string): void => {
			pendingToolLines.push(line);
			if (pendingToolLines.length >= 10) {
				void flushToolLines();
			}
		};
		const queueAssistantText = (text: string): Promise<void> => {
			const trimmed = text.trim();
			if (!trimmed) {
				return assistantSendQueue;
			}
			sentAssistantText = true;
			assistantSendQueue = assistantSendQueue
				.then(async () => {
					await flushToolLines();
					await this.runtime.sendPlainReply(request.message, trimmed);
				})
				.catch((error) => console.warn(chalk.gray(`Wechat assistant update skipped: ${formatError(error)}`)));
			return assistantSendQueue;
		};
		const flushActiveAssistantText = (): Promise<void> => {
			const text = activeAssistantText;
			activeAssistantText = "";
			return queueAssistantText(text);
		};
		try {
			const session = await this.runtime.getSession(this.conversationKey);
			unsubscribe = session.subscribe((event) => {
				if (event.type === "message_update") {
					const assistantEvent = event.assistantMessageEvent as { type?: string; delta?: string; content?: string } | undefined;
					if (assistantEvent?.type === "text_start") {
						activeAssistantText = "";
					}
					if (assistantEvent?.type === "text_delta" && assistantEvent.delta) {
						activeAssistantText += assistantEvent.delta;
					}
					if (assistantEvent?.type === "text_end") {
						if (assistantEvent.content?.trim()) {
							activeAssistantText = assistantEvent.content;
						}
						void flushActiveAssistantText();
					}
				}
				if (event.type === "message_end") {
					void flushActiveAssistantText();
				}
				if (this.runtime.shouldOutputToolCallsToIm()) {
					if (event.type === "tool_execution_start") {
						void flushActiveAssistantText();
						appendToolLine(formatToolImLine(event.toolName, event.args));
					}
					if (event.type === "tool_execution_end" && event.isError) {
						appendToolLine(formatToolImErrorLine(event.toolName, event.result));
					}
				}
			});
			await session.prompt(request.promptText);
			const providerError = extractLastAssistantError(session);
			if (providerError) {
				throw new Error(providerError);
			}
			const assistantText = extractAssistantText(session);
			await flushActiveAssistantText();
			await assistantSendQueue;
			await flushToolLines();
			if (!sentAssistantText) {
				await this.runtime.sendPlainReply(request.message, assistantText || "(empty response)");
			}
			request.resolve({ assistantText, interrupted: false });
		} catch (error) {
			const message = formatError(error);
			console.error(chalk.red(`Wechat turn failed: ${message}`));
			await flushActiveAssistantText();
			await assistantSendQueue.catch(() => undefined);
			await flushToolLines();
			await this.runtime.sendPlainReply(request.message, `消息处理失败：${message}`).catch(() => undefined);
			request.reject(error);
		} finally {
			unsubscribe?.();
			await assistantSendQueue.catch(() => undefined);
			await toolSendQueue.catch(() => undefined);
		}
	}
}

export class WechatBotRuntime implements ManagedRuntime, AgentTurnPort {
	readonly identity;
	private readonly abortController = new AbortController();
	private readonly dedup = new MessageDedup();
	private readonly conversations = new Map<string, WechatConversationController>();
	private readonly scheduledTurnQueues = new Map<string, Promise<void>>();
	private readonly sessionPool: SessionPool;
	private readonly contextTokens: ContextTokenStore;
	private sendQueue = Promise.resolve();
	private shutdownExitCode = 0;

	constructor(private config: WechatBotConfig) {
		this.identity = {
			backend: config.backendKind,
			channel: "wechat" as const,
			homeDir: config.homeDir,
		};
		this.sessionPool = new SessionPool({
			homeDir: config.homeDir,
			model: config.model,
			assistantSystemPrompt: config.assistantSystemPrompt,
			thinkingLevel: config.thinkingLevel,
			tools: config.tools,
			debug: config.debug,
			verboseLogs: config.verboseLogs,
			resumeSessions: config.resumeSessions,
		});
		this.contextTokens = new ContextTokenStore(config.homeDir, config.wechat.accountId);
	}

	async start(): Promise<number> {
		await this.ensureLoggedIn();
		this.printStartupSummary();
		await this.monitorWechatProvider();
		return this.shutdownExitCode;
	}

	async stop(): Promise<void> {
		this.abortController.abort();
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

	async sendPlainReply(message: WechatMessage, text: string): Promise<void> {
		const to = message.from_user_id?.trim();
		if (!to) {
			throw new Error("Cannot reply to Wechat message without from_user_id.");
		}
		const contextToken = message.context_token ?? this.contextTokens.get(to);
		const task = this.sendQueue
			.catch(() => undefined)
			.then(async () => {
				for (const chunk of splitWechatText(text)) {
					await this.sendReplyChunk({ to, text: chunk, contextToken });
					await sleep(WECHAT_SEND_INTERVAL_MS, this.abortController.signal);
				}
			});
		this.sendQueue = task.then(() => undefined, () => undefined);
		await task;
	}

	private async sendReplyChunk(params: {
		to: string;
		text: string;
		contextToken?: string;
	}): Promise<void> {
		for (let attempt = 0; ; attempt += 1) {
			try {
				await sendMessage({
					baseUrl: this.config.wechat.baseUrl,
					token: this.config.wechat.token,
					routeTag: this.config.wechat.routeTag,
					body: buildTextMessageReq({
						to: params.to,
						text: params.text,
						contextToken: params.contextToken,
					}),
				});
				return;
			} catch (error) {
				if (error instanceof WechatApiError && error.ret === -2) {
					const retryDelay = WECHAT_SEND_RET_MINUS_TWO_RETRY_DELAYS_MS[attempt];
					if (retryDelay !== undefined) {
						console.warn(
							chalk.yellow(
								`Wechat sendMessage failed; retrying after ${Math.round(retryDelay / 1000)}s. ${formatWechatSendError(error, params.text)}`,
							),
						);
						await sleep(retryDelay, this.abortController.signal);
						continue;
					}
				}
				if (error instanceof WechatApiError) {
					console.error(chalk.red(`Wechat sendMessage failed permanently. ${formatWechatSendError(error, params.text)}`));
				}
				throw error;
			}
		}
	}

	async deliverTurn(request: AgentTurnInput): Promise<{ sessionKey: string; assistantText: string }> {
		return this.enqueueScheduledAgentTurn(request);
	}

	private async ensureLoggedIn(): Promise<void> {
		if (this.config.wechat.token) {
			return;
		}
		const login = await loginWechatWithQr({
			homeDir: this.config.homeDir,
			baseUrl: this.config.wechat.baseUrl,
			botType: this.config.wechat.botType,
			routeTag: this.config.wechat.routeTag,
		});
		this.config = {
			...this.config,
			wechat: {
				...this.config.wechat,
				accountId: login.accountId,
				baseUrl: login.baseUrl,
				token: login.token,
			},
		};
	}

	private printStartupSummary(): void {
		const sessionMode = this.config.resumeSessions ? "persistent" : "ephemeral";
		const promptPreview = this.config.assistantSystemPrompt
			? truncate(this.config.assistantSystemPrompt.replace(/\s+/g, " "), 120)
			: "Pi Coding Agent default";
		const layoutRoots = AGENT_HOME_SUBDIRS.map((name) => join(this.config.homeDir, name)).join(", ");
		const lines = [
			chalk.bold("Pi Wechat channel ready"),
			chalk.gray(`framework  ${this.config.backendKind === "ousia" ? "Ousia" : "Pi Coding Agent"}`),
			chalk.gray(`mode       ${this.config.runMode}`),
			chalk.gray(`home       ${this.config.homeDir}`),
			chalk.gray(`layout     ${layoutRoots}`),
			chalk.gray(`sessions   ${sessionMode} (${join(this.config.homeDir, "sessions")})`),
			chalk.gray(`account    ${this.config.wechat.accountId}`),
			chalk.gray(`baseUrl    ${this.config.wechat.baseUrl}`),
			chalk.gray(`model      ${this.config.modelLabel}`),
			chalk.gray(`tools      ${this.config.toolLabel}`),
			chalk.gray(`thinking   ${this.config.thinkingLevel}`),
			chalk.gray(`prompt     ${this.config.assistantSystemPromptPath ?? "pi-coding-agent default"}`),
			chalk.gray(`preview    ${promptPreview}`),
			chalk.gray("status     waiting for Wechat events..."),
		];
		console.log(lines.join("\n"));
	}

	private rememberOwnerSessionBinding(message: WechatMessage): void {
		const userId = message.from_user_id?.trim();
		if (!userId) {
			return;
		}
		const ownerSession: OwnerSessionBinding = {
			chatId: userId,
			sessionKey: getConversationKey(message),
			openId: userId,
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

	private getConversationController(conversationKey: string): WechatConversationController {
		let controller = this.conversations.get(conversationKey);
		if (!controller) {
			controller = new WechatConversationController(conversationKey, this);
			this.conversations.set(conversationKey, controller);
		}
		return controller;
	}

	private async handleMessage(message: WechatMessage): Promise<void> {
		const messageId = getWechatMessageId(message);
		if (!this.dedup.record(messageId)) {
			return;
		}
		if (!isRecentMessage(message, this.config.startedAtMs)) {
			return;
		}
		const fromUserId = message.from_user_id?.trim();
		if (fromUserId && message.context_token) {
			this.contextTokens.set(fromUserId, message.context_token);
		}
		this.rememberOwnerSessionBinding(message);
		const promptText = extractPromptText(message);
		if (!promptText) {
			await this.sendPlainReply(message, "Only text messages are supported.");
			return;
		}
		const conversationKey = getConversationKey(message);
		console.log(chalk.cyan(`Wechat message received: ${conversationKey} ${promptText.slice(0, 120)}`));
		await this.getConversationController(conversationKey).submit(message, promptText);
	}

	private async monitorWechatProvider(): Promise<void> {
		let getUpdatesBuf = loadSyncBuf(this.config.homeDir, this.config.wechat.accountId);
		let nextTimeoutMs = 35_000;
		let consecutiveFailures = 0;
		let sessionExpiredRetryIndex = 0;
		while (!this.abortController.signal.aborted) {
			try {
				const response = await getUpdates({
					baseUrl: this.config.wechat.baseUrl,
					token: this.config.wechat.token,
					routeTag: this.config.wechat.routeTag,
					getUpdatesBuf,
					timeoutMs: nextTimeoutMs,
				});
				if (response.longpolling_timeout_ms && response.longpolling_timeout_ms > 0) {
					nextTimeoutMs = response.longpolling_timeout_ms;
				}
				const isApiError =
					(response.ret !== undefined && response.ret !== 0) ||
					(response.errcode !== undefined && response.errcode !== 0);
				if (isApiError) {
					const isSessionExpired =
						response.errcode === SESSION_EXPIRED_ERRCODE || response.ret === SESSION_EXPIRED_ERRCODE;
					if (isSessionExpired) {
						consecutiveFailures = 0;
						const retryDelayMs = SESSION_EXPIRED_RETRY_DELAYS_MS[sessionExpiredRetryIndex];
						if (retryDelayMs === undefined) {
							console.error(
								chalk.red(
									`微信会话仍然失效（errcode ${SESSION_EXPIRED_ERRCODE}）。同一个微信账号通常只能授权一个 bot；如果你刚扫码连接了另一个微信 Agent，当前 Agent 的微信 Bot Token 会失效。已永久暂停当前进程的微信轮询，请在该 Agent 的渠道设置中重新扫码/更新 WECHAT_BOT_TOKEN 后重启 Agent，或只保留一个微信 Agent 在线。`,
								),
							);
							return;
						}
						sessionExpiredRetryIndex += 1;
						console.error(
							chalk.red(
								`微信会话已失效（errcode ${SESSION_EXPIRED_ERRCODE}）。同一个微信账号通常只能授权一个 bot；如果你刚扫码连接了另一个微信 Agent，当前 Agent 的微信 Bot Token 会失效。将在 ${formatDelay(retryDelayMs)} 后第 ${sessionExpiredRetryIndex}/${SESSION_EXPIRED_RETRY_DELAYS_MS.length} 次重试；如果仍失败，最后会永久暂停轮询。`,
							),
						);
						await sleep(retryDelayMs, this.abortController.signal);
						continue;
					}
					throw new Error(`getUpdates failed: ret=${response.ret} errcode=${response.errcode} ${response.errmsg ?? ""}`);
				}
				sessionExpiredRetryIndex = 0;
				consecutiveFailures = 0;
				if (response.get_updates_buf != null && response.get_updates_buf !== "") {
					getUpdatesBuf = response.get_updates_buf;
					saveSyncBuf(this.config.homeDir, this.config.wechat.accountId, getUpdatesBuf);
				}
				for (const message of response.msgs ?? []) {
					try {
						await this.handleMessage(message);
					} catch (error) {
						console.error(chalk.red(`Wechat message handling failed: ${formatError(error)}`));
					}
				}
			} catch (error) {
				if (this.abortController.signal.aborted) {
					return;
				}
				consecutiveFailures += 1;
				console.error(
					chalk.red(`Wechat getUpdates error (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${formatError(error)}`),
				);
				if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
					consecutiveFailures = 0;
					await sleep(BACKOFF_DELAY_MS, this.abortController.signal);
				} else {
					await sleep(RETRY_DELAY_MS, this.abortController.signal);
				}
			}
		}
	}

	private createSyntheticTaskMessage(ownerSession: OwnerSessionBinding, request: AgentTurnInput): WechatMessage {
		return {
			message_id: Date.now(),
			from_user_id: ownerSession.chatId,
			to_user_id: this.config.wechat.accountId,
			create_time_ms: Date.now(),
			message_type: 1,
			item_list: [{ type: 1, text_item: { text: formatTaskPrompt(request.prompt) } }],
			context_token: this.contextTokens.get(ownerSession.chatId),
		};
	}

	private async handleScheduledAgentTurn(request: AgentTurnInput): Promise<{
		sessionKey: string;
		assistantText: string;
	}> {
		if (request.kind === "agent_task") {
			const ownerSession = getOwnerSessionBinding(loadConfigStore());
			if (!ownerSession) {
				throw new Error("No owner session is bound yet. Send the Wechat channel a private message first.");
			}
			const message = this.createSyntheticTaskMessage(ownerSession, request);
			const result = await this.getConversationController(ownerSession.sessionKey).submit(
				message,
				formatTaskPrompt(request.prompt),
			);
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
}

export function createWechatBotRuntime(config: WechatBotConfig): WechatBotRuntime {
	return new WechatBotRuntime(config);
}

export async function runWechatBot(nextConfig: WechatBotConfig = loadConfig()): Promise<number> {
	const runtime = createWechatBotRuntime(nextConfig);
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
		const code = await runWechatBot();
		process.exit(code);
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}
}
