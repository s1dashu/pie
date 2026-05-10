import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import type { FeishuBotConfig } from "./config.js";
import {
	extractAssistantText,
	extractLastAssistantError,
	isFirstResponseSignal,
	type AgentConversationSessionPool,
	wasLastAssistantMessageAborted,
} from "../../agents/session-runtime.js";
import { getAgentPromptInputText, type AgentPromptInputLike } from "../../agents/types.js";
import type { LarkMessageEvent } from "./platform/index.js";
import {
	formatLarkError,
	isAbortLikeError,
	LarkProgressReporter,
	type SessionEvent,
} from "./progress-reporter.js";

export interface ConversationResult {
	assistantText: string;
	interrupted: boolean;
}

interface ConversationRequest {
	id: number;
	event: LarkMessageEvent;
	promptText: string;
	promptInput: AgentPromptInputLike;
	reporter: ConversationReporter;
	receivedAtMs: number;
	interrupted: boolean;
	resolve: (result: ConversationResult) => void;
	reject: (error: unknown) => void;
}

interface ConversationReporter {
	markReceived(): Promise<void>;
	onSessionEvent(event: SessionEvent): void;
	finish(finalText: string): Promise<void>;
	fail(errorMessage: string): Promise<void>;
	dispose(): Promise<void>;
}

export interface ConversationControllerOptions {
	conversationKey: string;
	config: FeishuBotConfig;
	sessionPool: AgentConversationSessionPool;
	createReporter?: (event: LarkMessageEvent) => ConversationReporter;
}

export class ConversationController {
	private processing = false;
	private nextRequestId = 1;
	private readonly pendingRequests: ConversationRequest[] = [];
	private readonly conversationKey: string;
	private readonly config: FeishuBotConfig;
	private readonly sessionPool: AgentConversationSessionPool;
	private readonly createReporter: (event: LarkMessageEvent) => ConversationReporter;

	constructor(options: ConversationControllerOptions) {
		this.conversationKey = options.conversationKey;
		this.config = options.config;
		this.sessionPool = options.sessionPool;
		this.createReporter = options.createReporter ?? ((event) => new LarkProgressReporter(
			event,
			this.config.feishu,
			this.config.outputToolCallsToIm,
			this.config.outputToolCallImMaxLength,
			this.config.outputThinkingToIm,
			this.config.messageOutputMode,
		));
	}

	async submit(event: LarkMessageEvent, promptInput: AgentPromptInputLike): Promise<ConversationResult> {
		const promptText = getAgentPromptInputText(promptInput);
		const requestId = this.nextRequestId++;
		this.logQueue("submit_received", requestId, event, `processing=${this.processing} pending=${this.pendingRequests.length} text=${formatLogValue(promptText)}`);
		const reporter = this.createReporter(event);
		await reporter.markReceived();
		this.logQueue("mark_received_done", requestId, event, `processing=${this.processing} pending=${this.pendingRequests.length}`);
		let resolvePromise: (result: ConversationResult) => void = () => undefined;
		let rejectPromise: (error: unknown) => void = () => undefined;
		const completion = new Promise<ConversationResult>((resolve, reject) => {
			resolvePromise = resolve;
			rejectPromise = reject;
		});
		const request: ConversationRequest = {
			id: requestId,
			event,
			promptText,
			promptInput,
			reporter,
			receivedAtMs: Date.now(),
			interrupted: false,
			resolve: resolvePromise,
			reject: rejectPromise,
		};

		this.pendingRequests.push(request);
		this.logQueue("queued", request.id, request.event, `processing=${this.processing} pending=${this.pendingRequests.length} text=${formatLogValue(promptText)}`);

		if (this.processing) {
			return completion;
		}

		void this.processPending();
		return completion;
	}

	private logRunTiming(stage: string, elapsedMs: number, details?: string): void {
		if (!this.config.verboseLogs) {
			return;
		}
		const suffix = details ? ` ${details}` : "";
		console.log(chalk.gray(`> run_timing ${this.conversationKey} stage=${stage} elapsed=${elapsedMs}ms${suffix}`));
	}

	private logQueue(stage: string, requestId: number | undefined, event: LarkMessageEvent | undefined, details?: string): void {
		const requestPart = requestId === undefined ? "" : ` request=${requestId}`;
		const messageId = event?.message.message_id;
		const messagePart = messageId ? ` message_id=${formatLogValue(messageId)}` : "";
		const suffix = details ? ` ${details}` : "";
		if (this.shouldPrintQueueStage(stage)) {
			console.log(chalk.gray(`> feishu_run ${this.conversationKey} stage=${stage}${requestPart}${messagePart}${suffix}`));
		}
		appendFeishuRunLog(this.config.homeDir, {
			ts: new Date().toISOString(),
			conversationKey: this.conversationKey,
			stage,
			requestId,
			messageId,
			pending: this.pendingRequests.length,
			processing: this.processing,
			details,
		});
	}

	private shouldPrintQueueStage(stage: string): boolean {
		if (this.config.verboseLogs) {
			return true;
		}
		return [
			"queued",
			"prompt_start",
			"prompt_done",
			"reporter_fail_done",
			"request_done",
		].includes(stage);
	}

	private async processPending(): Promise<void> {
		if (this.processing) {
			this.logQueue("process_skip_already_processing", undefined, undefined, `pending=${this.pendingRequests.length}`);
			return;
		}
		this.processing = true;
		this.logQueue("process_start", undefined, undefined, `pending=${this.pendingRequests.length}`);
		try {
			for (;;) {
				const request = this.pendingRequests.shift();
				if (!request) {
					this.logQueue("process_empty", undefined, undefined, "pending=0");
					return;
				}
				this.logQueue("dequeued", request.id, request.event, `pending=${this.pendingRequests.length}`);
				await this.executeRequest(request);
				this.logQueue("request_done", request.id, request.event, `pending=${this.pendingRequests.length}`);
			}
		} finally {
			this.processing = false;
			this.logQueue("process_stop", undefined, undefined, `pending=${this.pendingRequests.length}`);
		}
	}

	private async executeRequest(request: ConversationRequest): Promise<void> {
		this.logQueue("session_get_start", request.id, request.event, `elapsed=${Date.now() - request.receivedAtMs}ms`);
		const session = await this.sessionPool.getSession(this.conversationKey);
		this.logQueue("session_get_done", request.id, request.event, `elapsed=${Date.now() - request.receivedAtMs}ms streaming=${session.isStreaming}`);
		this.logRunTiming("session_ready", Date.now() - request.receivedAtMs);
		if (request.interrupted) {
			this.logQueue("request_interrupted_before_prompt", request.id, request.event);
			await request.reporter.dispose();
			request.resolve({ assistantText: "", interrupted: true });
			this.logQueue("resolved_interrupted", request.id, request.event);
			return;
		}

		const promptStartedAt = Date.now();
		let sawFirstResponse = false;
		const onSessionEvent = (event: SessionEvent): void => {
			request.reporter.onSessionEvent(event);
			if (!sawFirstResponse && isFirstResponseSignal(event)) {
				sawFirstResponse = true;
				this.logRunTiming(
					"first_response",
					Date.now() - request.receivedAtMs,
					`since_prompt=${Date.now() - promptStartedAt}ms signal=${event.type}`,
				);
			}
		};
		const unsubscribe = session.subscribe(onSessionEvent);
		let result: ConversationResult = { assistantText: "", interrupted: true };
		let failure: unknown;
		try {
			this.logRunTiming("prompt_start", promptStartedAt - request.receivedAtMs);
			this.logQueue("prompt_start", request.id, request.event, `elapsed=${promptStartedAt - request.receivedAtMs}ms`);
			await session.prompt(request.promptInput);
			this.logQueue("prompt_done", request.id, request.event, `elapsed=${Date.now() - request.receivedAtMs}ms interrupted=${request.interrupted}`);
			if (!request.interrupted && !wasLastAssistantMessageAborted(session)) {
				const providerError = extractLastAssistantError(session);
				if (providerError) {
					throw new Error(providerError);
				}
				const responseText = extractAssistantText(session);
				this.logQueue("reporter_finish_start", request.id, request.event, `assistant_chars=${responseText.length}`);
				await request.reporter.finish(responseText);
				this.logQueue("reporter_finish_done", request.id, request.event, `assistant_chars=${responseText.length}`);
				this.logRunTiming(
					"prompt_complete",
					Date.now() - request.receivedAtMs,
					`since_prompt=${Date.now() - promptStartedAt}ms`,
				);
				result = { assistantText: responseText, interrupted: false };
			} else {
				this.logQueue("prompt_aborted_or_interrupted", request.id, request.event, `interrupted=${request.interrupted}`);
			}
		} catch (error) {
			if (!request.interrupted && !isAbortLikeError(error)) {
				const errorMessage = formatLarkError(error);
				this.logRunTiming(
					"prompt_error",
					Date.now() - request.receivedAtMs,
					`since_prompt=${Date.now() - promptStartedAt}ms`,
				);
				console.error(chalk.red(`Error: ${errorMessage}`));
				this.logQueue("reporter_fail_start", request.id, request.event, `error=${formatLogValue(errorMessage)}`);
				await request.reporter.fail(errorMessage);
				this.logQueue("reporter_fail_done", request.id, request.event);
				failure = error;
			} else {
				this.logQueue("prompt_error_ignored", request.id, request.event, `interrupted=${request.interrupted} error=${formatLogValue(formatLarkError(error))}`);
			}
		} finally {
			unsubscribe();
			this.logQueue("unsubscribed", request.id, request.event);
			await request.reporter.dispose();
			this.logQueue("reporter_disposed", request.id, request.event);
			if (failure !== undefined) {
				this.logQueue("reject", request.id, request.event, `error=${formatLogValue(formatLarkError(failure))}`);
				request.reject(failure);
				return;
			}
			this.logQueue("resolve", request.id, request.event, `assistant_chars=${result.assistantText.length} interrupted=${result.interrupted}`);
			request.resolve(result);
		}
	}
}

function formatLogValue(value: string): string {
	return JSON.stringify(value.length > 160 ? `${value.slice(0, 160)}...` : value);
}

function appendFeishuRunLog(homeDir: string | undefined, entry: Record<string, unknown>): void {
	if (!homeDir) {
		return;
	}
	try {
		const runtimeDir = join(homeDir, "runtime");
		mkdirSync(runtimeDir, { recursive: true });
		appendFileSync(join(runtimeDir, "feishu-runs.jsonl"), `${JSON.stringify(entry)}\n`);
	} catch {
		// Console output remains the primary live signal; file logging should never break a run.
	}
}
