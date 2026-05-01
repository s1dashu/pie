import type { AgentSession } from "@mariozechner/pi-coding-agent";
import chalk from "chalk";
import type { FeishuBotConfig } from "./config.js";
import { extractAssistantText, extractLastAssistantError, SessionPool } from "./session.js";
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
	event: LarkMessageEvent;
	promptText: string;
	reporter: LarkProgressReporter;
	receivedAtMs: number;
	interrupted: boolean;
	resolve: (result: ConversationResult) => void;
	reject: (error: unknown) => void;
}

export interface ConversationControllerOptions {
	conversationKey: string;
	config: FeishuBotConfig;
	sessionPool: SessionPool;
}

function wasLastAssistantMessageAborted(session: AgentSession): boolean {
	const messages = [...session.state.messages].reverse();
	for (const message of messages) {
		const typedMessage = message as { role?: string; stopReason?: string };
		if (typedMessage.role === "assistant") {
			return typedMessage.stopReason === "aborted";
		}
	}
	return false;
}

export class ConversationController {
	private processing = false;
	private currentRequest?: ConversationRequest;
	private pendingRequest?: ConversationRequest;
	private abortPromise?: Promise<void>;
	private readonly conversationKey: string;
	private readonly config: FeishuBotConfig;
	private readonly sessionPool: SessionPool;

	constructor(options: ConversationControllerOptions) {
		this.conversationKey = options.conversationKey;
		this.config = options.config;
		this.sessionPool = options.sessionPool;
	}

	async submit(event: LarkMessageEvent, promptText: string): Promise<ConversationResult> {
		const reporter = new LarkProgressReporter(event, this.config.feishu, this.config.outputToolCallsToIm);
		await reporter.markReceived();
		let resolvePromise: (result: ConversationResult) => void = () => undefined;
		let rejectPromise: (error: unknown) => void = () => undefined;
		const completion = new Promise<ConversationResult>((resolve, reject) => {
			resolvePromise = resolve;
			rejectPromise = reject;
		});
		const request: ConversationRequest = {
			event,
			promptText,
			reporter,
			receivedAtMs: Date.now(),
			interrupted: false,
			resolve: resolvePromise,
			reject: rejectPromise,
		};

		if (this.pendingRequest) {
			await this.pendingRequest.reporter.dispose();
			this.pendingRequest.resolve({ assistantText: "", interrupted: true });
		}
		this.pendingRequest = request;

		if (this.processing) {
			if (this.currentRequest) {
				this.currentRequest.interrupted = true;
			}
			await this.interruptCurrentRun();
			return completion;
		}

		void this.processPending();
		return completion;
	}

	private logTurnTiming(stage: string, elapsedMs: number, details?: string): void {
		if (!this.config.verboseLogs) {
			return;
		}
		const suffix = details ? ` ${details}` : "";
		console.log(chalk.gray(`> turn_timing ${this.conversationKey} stage=${stage} elapsed=${elapsedMs}ms${suffix}`));
	}

	private async interruptCurrentRun(): Promise<void> {
		if (this.abortPromise) {
			await this.abortPromise;
			return;
		}
		this.abortPromise = (async () => {
			try {
				const session = await this.sessionPool.getSession(this.conversationKey);
				if (session.isStreaming) {
					await session.abort();
				}
			} catch (error) {
				console.warn(chalk.gray(`Abort skipped: ${formatLarkError(error)}`));
			}
		})();

		try {
			await this.abortPromise;
		} finally {
			this.abortPromise = undefined;
		}
	}

	private async processPending(): Promise<void> {
		if (this.processing) {
			return;
		}
		this.processing = true;
		try {
			for (;;) {
				const request = this.pendingRequest;
				this.pendingRequest = undefined;
				if (!request) {
					return;
				}
				this.currentRequest = request;
				await this.executeRequest(request);
				this.currentRequest = undefined;
			}
		} finally {
			this.processing = false;
			this.currentRequest = undefined;
		}
	}

	private async executeRequest(request: ConversationRequest): Promise<void> {
		const session = await this.sessionPool.getSession(this.conversationKey);
		this.logTurnTiming("session_ready", Date.now() - request.receivedAtMs);
		if (request.interrupted) {
			await request.reporter.dispose();
			request.resolve({ assistantText: "", interrupted: true });
			return;
		}

		const promptStartedAt = Date.now();
		let sawFirstThinkingDelta = false;
		let sawFirstTextDelta = false;
		const onSessionEvent = (event: SessionEvent): void => {
			request.reporter.onSessionEvent(event);
			if (event.type !== "message_update") {
				return;
			}
			const assistantEvent = event.assistantMessageEvent as { type?: string; delta?: string; content?: string } | undefined;
			if (!sawFirstThinkingDelta && assistantEvent?.type === "thinking_delta" && assistantEvent.delta) {
				sawFirstThinkingDelta = true;
				this.logTurnTiming(
					"first_thinking_delta",
					Date.now() - request.receivedAtMs,
					`since_prompt=${Date.now() - promptStartedAt}ms`,
				);
			}
			if (!sawFirstTextDelta && assistantEvent?.type === "text_delta" && assistantEvent.delta) {
				sawFirstTextDelta = true;
				this.logTurnTiming(
					"first_text_delta",
					Date.now() - request.receivedAtMs,
					`since_prompt=${Date.now() - promptStartedAt}ms`,
				);
			}
		};
		const unsubscribe = session.subscribe(onSessionEvent);
		let result: ConversationResult = { assistantText: "", interrupted: true };
		let failure: unknown;
		try {
			this.logTurnTiming("prompt_start", promptStartedAt - request.receivedAtMs);
			await session.prompt(request.promptText);
			if (!request.interrupted && !wasLastAssistantMessageAborted(session)) {
				const providerError = extractLastAssistantError(session);
				if (providerError) {
					throw new Error(providerError);
				}
				const responseText = extractAssistantText(session);
				await request.reporter.finish(responseText);
				this.logTurnTiming(
					"prompt_complete",
					Date.now() - request.receivedAtMs,
					`since_prompt=${Date.now() - promptStartedAt}ms`,
				);
				result = { assistantText: responseText, interrupted: false };
			}
		} catch (error) {
			if (!request.interrupted && !isAbortLikeError(error)) {
				const errorMessage = formatLarkError(error);
				this.logTurnTiming(
					"prompt_error",
					Date.now() - request.receivedAtMs,
					`since_prompt=${Date.now() - promptStartedAt}ms`,
				);
				console.error(chalk.red(`Error: ${errorMessage}`));
				await request.reporter.fail(errorMessage);
				failure = error;
			}
		} finally {
			unsubscribe();
			await request.reporter.dispose();
			if (failure !== undefined) {
				request.reject(failure);
				return;
			}
			request.resolve(result);
		}
	}
}
