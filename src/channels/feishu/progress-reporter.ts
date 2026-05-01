import { basename } from "node:path";
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import chalk from "chalk";
import { LarkClient, sendTextLark, type LarkConfig, type LarkMessageEvent } from "./platform/index.js";

export type SessionEvent = Parameters<AgentSession["subscribe"]>[0] extends (event: infer TEvent) => void
	? TEvent
	: never;

const WORKING_REACTION = "Get";
const MAX_MESSAGE_EDITS = 20;
const STREAM_UPDATE_DEBOUNCE_MS = 400;
const TOOL_CALL_IM_MAX = 100;
const DEFAULT_TOOL_IM_EMOJI = "🖥️";

interface AssistantSegment {
	kind: "assistant" | "thinking";
	content: string;
	messageId?: string;
	messagePrefix: string;
	messageEditCount: number;
	lastRendered: string;
}

interface ToolRunImBlock {
	content: string;
	messageId?: string;
	messagePrefix: string;
	messageEditCount: number;
	lastRendered: string;
}

function truncate(text: string, max = 600): string {
	return text.length > max ? `${text.slice(0, max)}...` : text;
}

function capToolImLine(line: string): string {
	return truncate(line, TOOL_CALL_IM_MAX);
}

export function isSyntheticTaskEvent(event: LarkMessageEvent): boolean {
	return event.sender.sender_type === "system" && event.message.user_agent === "pie-task-engine";
}

function toolCallImEmoji(toolLabel: string): string {
	const base = toolLabel.replace(/\s+error$/i, "").trim().toLowerCase();
	switch (base) {
		case "read":
			return "📖";
		case "write":
			return "📝";
		case "edit":
			return "✏️";
		case "bash":
			return DEFAULT_TOOL_IM_EMOJI;
		default:
			return DEFAULT_TOOL_IM_EMOJI;
	}
}

function imBasename(pathStr: string): string {
	const t = pathStr.trim();
	const b = basename(t);
	return b || t || "(unknown)";
}

function firstStringFieldForIm(rec: Record<string, unknown>): string {
	for (const v of Object.values(rec)) {
		if (typeof v === "string" && v.trim()) {
			return v.trim().replace(/\s+/g, " ");
		}
	}
	return "";
}

function formatToolImLine(toolName: string, args: unknown): string {
	const emoji = toolCallImEmoji(toolName);
	const base = toolName.replace(/\s+error$/i, "").trim().toLowerCase();
	const rec = args !== null && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};

	if (base === "bash") {
		const cmd = typeof rec.command === "string" ? rec.command.trim().replace(/\s+/g, " ") : "";
		return capToolImLine(`${emoji} bash ${cmd || "(no command)"}`);
	}
	if (base === "read" || base === "write" || base === "edit") {
		const pathStr = typeof rec.path === "string" ? rec.path : "";
		return capToolImLine(`${emoji} ${base} ${imBasename(pathStr || "(no path)")}`);
	}
	if (base === "grep") {
		const pat = typeof rec.pattern === "string" ? rec.pattern.trim().replace(/\s+/g, " ") : "";
		const pathStr = typeof rec.path === "string" ? rec.path.trim() : "";
		const tail = pathStr ? ` ${imBasename(pathStr)}` : "";
		return capToolImLine(`${emoji} grep ${pat || "?"}${tail}`);
	}
	if (base === "find") {
		const pathStr = typeof rec.path === "string" ? rec.path.trim() : "";
		const pat = typeof rec.pattern === "string" ? rec.pattern.trim() : "";
		const head = pathStr ? imBasename(pathStr) : ".";
		return capToolImLine(`${emoji} find ${pat ? `${head} ${pat.replace(/\s+/g, " ")}` : head}`);
	}
	if (base === "ls") {
		const pathStr = typeof rec.path === "string" ? rec.path.trim() : "";
		return capToolImLine(`${emoji} ls ${pathStr ? imBasename(pathStr) : "."}`);
	}

	const hint = firstStringFieldForIm(rec);
	return capToolImLine(hint ? `${emoji} ${base} ${hint}` : `${emoji} ${toolName.replace(/\s+error$/i, "").trim()}`);
}

function formatToolImErrorSummary(result: unknown): string {
	if (result == null) {
		return "";
	}
	if (typeof result === "string") {
		return result.trim().replace(/\s+/g, " ");
	}
	if (typeof result === "object") {
		const r = result as Record<string, unknown>;
		const content = r.content;
		if (Array.isArray(content)) {
			const parts: string[] = [];
			for (const c of content) {
				if (c && typeof c === "object" && (c as { type?: string; text?: string }).type === "text") {
					const t = (c as { text?: string }).text;
					if (typeof t === "string" && t.trim()) {
						parts.push(t.trim());
					}
				}
			}
			if (parts.length) {
				return parts.join(" ").replace(/\s+/g, " ");
			}
		}
		if (typeof r.message === "string" && r.message.trim()) {
			return r.message.trim().replace(/\s+/g, " ");
		}
	}
	return String(result).replace(/\s+/g, " ");
}

function formatToolImErrorLine(toolName: string, result: unknown): string {
	const emoji = toolCallImEmoji(`${toolName} error`);
	const msg = formatToolImErrorSummary(result);
	return capToolImLine(msg ? `${emoji} ${toolName} error ${msg}` : `${emoji} ${toolName} error`);
}

function toQuotedMarkdown(label: string, body: string): string {
	const lines = body.trim() ? body.split("\n").map((line) => `> ${line}`) : [];
	return [`> ${label}`, ...lines].join("\n");
}

function getContinuationText(fullText: string, shownPrefix: string): string {
	if (!shownPrefix) {
		return fullText;
	}
	return fullText.startsWith(shownPrefix) ? fullText.slice(shownPrefix.length) : fullText;
}

function extractLarkErrorInfo(error: unknown): { status?: number; code?: number; msg?: string; message: string } {
	if (error instanceof Error) {
		const response = (error as Error & { response?: { status?: number; data?: { code?: number; msg?: string } } }).response;
		const status = response?.status;
		const code = response?.data?.code;
		const msg = response?.data?.msg;
		return { status, code, msg, message: msg ?? error.message };
	}

	if (typeof error === "object" && error !== null) {
		const typedError = error as { response?: { status?: number; data?: { code?: number; msg?: string } }; message?: unknown };
		const status = typedError.response?.status;
		const code = typedError.response?.data?.code;
		const msg = typedError.response?.data?.msg;
		return {
			status,
			code,
			msg,
			message: msg ?? (typeof typedError.message === "string" ? typedError.message : String(error)),
		};
	}

	return { message: String(error) };
}

export function formatLarkError(error: unknown): string {
	const info = extractLarkErrorInfo(error);
	const parts = [info.message];
	if (info.code !== undefined) {
		parts.push(`code=${info.code}`);
	}
	if (info.status !== undefined) {
		parts.push(`status=${info.status}`);
	}
	return parts.join(" | ");
}

export function isAbortLikeError(error: unknown): boolean {
	return extractLarkErrorInfo(error).message.toLowerCase().includes("abort");
}

function isMessageEditLimitError(error: unknown): boolean {
	const info = extractLarkErrorInfo(error);
	return info.code === 230072 || info.message.includes("reached the number of times it can be edited");
}

export async function sendPlainReply(config: LarkConfig, event: LarkMessageEvent, text: string) {
	return sendTextLark({
		config,
		to: event.message.chat_id,
		text,
	});
}

async function updateReplyText(config: LarkConfig, messageId: string, text: string): Promise<void> {
	await LarkClient.fromConfig(config).sdk.im.message.update({
		path: { message_id: messageId },
		data: {
			msg_type: "post",
			content: JSON.stringify({
				zh_cn: {
					content: [[{ tag: "md", text }]],
				},
			}),
		},
	});
}

async function addWorkingReaction(config: LarkConfig, messageId: string): Promise<string | undefined> {
	const response = await LarkClient.fromConfig(config).sdk.im.messageReaction.create({
		path: { message_id: messageId },
		data: {
			reaction_type: {
				emoji_type: WORKING_REACTION,
			},
		},
	});
	return response?.data?.reaction_id;
}

async function removeWorkingReaction(config: LarkConfig, messageId: string, reactionId: string): Promise<void> {
	await LarkClient.fromConfig(config).sdk.im.messageReaction.delete({
		path: {
			message_id: messageId,
			reaction_id: reactionId,
		},
	});
}

export class LarkProgressReporter {
	private reactionId?: string;
	private activeSegment?: AssistantSegment;
	private toolRunImBlock?: ToolRunImBlock;
	private flushTimer?: ReturnType<typeof setTimeout>;
	private pending: Promise<void> = Promise.resolve();
	private visibleResponseStarted = false;

	constructor(
		private readonly event: LarkMessageEvent,
		private readonly config: LarkConfig,
		private readonly outputToolCallsToIm: boolean,
	) {}

	async markReceived(): Promise<void> {
		if (isSyntheticTaskEvent(this.event)) {
			return;
		}
		try {
			const reactionId = await addWorkingReaction(this.config, this.event.message.message_id);
			if (reactionId) {
				this.reactionId = reactionId;
			}
		} catch (error) {
			console.warn(chalk.gray(`Reaction skipped: ${formatLarkError(error)}`));
		}
	}

	onSessionEvent = (event: SessionEvent): void => {
		switch (event.type) {
			case "message_start": {
				const message = event.message as { role?: string };
				if (message.role === "assistant") {
					this.finalizeActiveSegment();
				}
				break;
			}
			case "message_update": {
				const assistantEvent = event.assistantMessageEvent as { type?: string; delta?: string; content?: string } | undefined;
				switch (assistantEvent?.type) {
					case "thinking_start":
						this.startSegment("thinking");
						break;
					case "thinking_delta":
						if (assistantEvent.delta) {
							this.appendToSegment("thinking", assistantEvent.delta);
						}
						break;
					case "thinking_end":
						if (assistantEvent.content) {
							this.finishSegment("thinking", assistantEvent.content);
						}
						break;
					case "text_start":
						this.startSegment("assistant");
						break;
					case "text_delta":
						if (assistantEvent.delta) {
							this.appendToSegment("assistant", assistantEvent.delta);
						}
						break;
					case "text_end":
						if (assistantEvent.content) {
							this.finishSegment("assistant", assistantEvent.content);
						}
						break;
				}
				break;
			}
			case "message_end":
				this.finalizeActiveSegment();
				break;
			case "tool_execution_start":
				if (this.outputToolCallsToIm) {
					this.finalizeActiveSegment();
					this.appendToolRunLine(formatToolImLine(event.toolName, event.args));
				}
				break;
			case "tool_execution_end":
				if (this.outputToolCallsToIm && event.isError) {
					this.appendToolRunLine(formatToolImErrorLine(event.toolName, event.result));
				}
				break;
		}
	};

	async finish(finalText: string): Promise<void> {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = undefined;
		}
		if (this.activeSegment?.kind === "assistant") {
			const normalizedFinalText = finalText.trim();
			if (normalizedFinalText) {
				this.activeSegment.content = normalizedFinalText;
			}
		}
		this.finalizeActiveSegment();
		await this.pending;
		await this.clearReaction();
	}

	async fail(errorMessage: string): Promise<void> {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = undefined;
		}
		await this.clearReaction();
		await sendPlainReply(this.config, this.event, `Failed: ${errorMessage}`);
	}

	async dispose(): Promise<void> {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = undefined;
		}
		await this.pending;
		await this.clearReaction();
	}

	private startSegment(kind: AssistantSegment["kind"]): void {
		if (this.activeSegment?.kind === kind) {
			return;
		}
		this.finalizeActiveSegment();
		if (kind === "assistant") {
			const orphanedToolBlock = this.toolRunImBlock;
			this.toolRunImBlock = undefined;
			if (orphanedToolBlock?.content.trim()) {
				this.enqueue(() => this.pushToolRunBlock(orphanedToolBlock));
			}
		}
		this.activeSegment = {
			kind,
			content: "",
			messagePrefix: "",
			messageEditCount: 0,
			lastRendered: "",
		};
	}

	private appendToSegment(kind: AssistantSegment["kind"], delta: string): void {
		if (!this.activeSegment || this.activeSegment.kind !== kind) {
			this.startSegment(kind);
		}
		if (!this.activeSegment) {
			return;
		}
		this.activeSegment.content += delta;
		this.scheduleFlush();
	}

	private finishSegment(kind: AssistantSegment["kind"], content: string): void {
		if (!this.activeSegment || this.activeSegment.kind !== kind) {
			this.startSegment(kind);
		}
		if (!this.activeSegment) {
			return;
		}
		this.activeSegment.content = content;
		this.finalizeActiveSegment();
	}

	private scheduleFlush(): void {
		if (this.flushTimer) {
			return;
		}
		this.flushTimer = setTimeout(() => {
			this.flushTimer = undefined;
			this.flushActiveSegment();
		}, STREAM_UPDATE_DEBOUNCE_MS);
	}

	private renderSegment(segment: AssistantSegment): string {
		if (segment.kind === "thinking") {
			return toQuotedMarkdown("Thinking", truncate(segment.content.trim(), 3000));
		}
		return segment.content.trim();
	}

	private flushActiveSegment(): void {
		const segment = this.activeSegment;
		if (!segment) {
			return;
		}
		this.enqueue(() => this.pushSegment(segment));
	}

	private finalizeActiveSegment(): void {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = undefined;
		}
		const segment = this.activeSegment;
		this.activeSegment = undefined;
		if (!segment || !segment.content.trim()) {
			return;
		}
		this.enqueue(async () => {
			await this.pushSegment(segment);
		});
	}

	private async pushSegment(segment: AssistantSegment): Promise<void> {
		const rendered = this.renderSegment(segment).trim();
		if (!rendered || rendered === segment.lastRendered) {
			return;
		}

		await this.beginVisibleResponse();
		let currentChunk = getContinuationText(rendered, segment.messagePrefix);
		if (segment.messageId && segment.messageEditCount >= MAX_MESSAGE_EDITS) {
			segment.messageId = undefined;
			segment.messagePrefix = segment.lastRendered;
			segment.messageEditCount = 0;
			currentChunk = getContinuationText(rendered, segment.messagePrefix);
		}
		if (segment.messageId) {
			try {
				await updateReplyText(this.config, segment.messageId, currentChunk);
				segment.messageEditCount += 1;
			} catch (error) {
				if (!isMessageEditLimitError(error)) {
					throw error;
				}
				console.warn(chalk.gray("Assistant segment edit limit reached, continuing in a new message."));
				segment.messageId = undefined;
				segment.messagePrefix = segment.lastRendered;
				segment.messageEditCount = 0;
				currentChunk = getContinuationText(rendered, segment.messagePrefix);
			}
		}
		if (!segment.messageId && currentChunk) {
			const result = await sendPlainReply(this.config, this.event, currentChunk);
			if (result.messageId) {
				segment.messageId = result.messageId;
				segment.messagePrefix = rendered.slice(0, rendered.length - currentChunk.length);
				segment.messageEditCount = 0;
			}
		}
		segment.lastRendered = rendered;
	}

	private appendToolRunLine(line: string): void {
		if (!this.toolRunImBlock) {
			this.toolRunImBlock = {
				content: "",
				messagePrefix: "",
				messageEditCount: 0,
				lastRendered: "",
			};
		}
		this.toolRunImBlock.content += (this.toolRunImBlock.content ? "\n\n" : "") + line;
		const block = this.toolRunImBlock;
		this.enqueue(() => this.pushToolRunBlock(block));
	}

	private async pushToolRunBlock(block: ToolRunImBlock): Promise<void> {
		const rendered = block.content.trim();
		if (!rendered || rendered === block.lastRendered) {
			return;
		}

		await this.beginVisibleResponse();
		let currentChunk = getContinuationText(rendered, block.messagePrefix);
		if (block.messageId && block.messageEditCount >= MAX_MESSAGE_EDITS) {
			block.messageId = undefined;
			block.messagePrefix = block.lastRendered;
			block.messageEditCount = 0;
			currentChunk = getContinuationText(rendered, block.messagePrefix);
		}
		if (block.messageId) {
			try {
				await updateReplyText(this.config, block.messageId, currentChunk);
				block.messageEditCount += 1;
			} catch (error) {
				if (!isMessageEditLimitError(error)) {
					throw error;
				}
				console.warn(chalk.gray("Tool run IM edit limit reached, continuing in a new message."));
				block.messageId = undefined;
				block.messagePrefix = block.lastRendered;
				block.messageEditCount = 0;
				currentChunk = getContinuationText(rendered, block.messagePrefix);
			}
		}
		if (!block.messageId && currentChunk) {
			const result = await sendPlainReply(this.config, this.event, currentChunk);
			if (result.messageId) {
				block.messageId = result.messageId;
				block.messagePrefix = rendered.slice(0, rendered.length - currentChunk.length);
				block.messageEditCount = 0;
			}
		}
		block.lastRendered = rendered;
	}

	private enqueue(task: () => Promise<void>): void {
		this.pending = this.pending
			.then(task, task)
			.catch((error) => console.warn(chalk.gray(`Lark progress update skipped: ${formatLarkError(error)}`)));
	}

	private async beginVisibleResponse(): Promise<void> {
		if (this.visibleResponseStarted) {
			return;
		}
		this.visibleResponseStarted = true;
		await this.clearReaction();
	}

	private async clearReaction(): Promise<void> {
		if (!this.reactionId) {
			return;
		}

		const reactionId = this.reactionId;
		this.reactionId = undefined;
		try {
			await removeWorkingReaction(this.config, this.event.message.message_id, reactionId);
		} catch (error) {
			console.warn(chalk.gray(`Reaction cleanup skipped: ${formatLarkError(error)}`));
		}
	}
}
