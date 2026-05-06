import { basename } from "node:path";
import chalk from "chalk";
import type { AgentSessionEvent } from "../../agents/session-runtime.js";
import type { FeishuMessageOutputMode } from "../../core/message-style.js";
import type { ToolCallImMaxLength } from "../common/tool-call-im.js";
import {
	LarkClient,
	sendCardLark,
	sendTextLark,
	type LarkConfig,
	type LarkMessageEvent,
	type LarkSendResult,
} from "./platform/index.js";

export type SessionEvent = AgentSessionEvent;

const WORKING_REACTION = "Get";
const MAX_MESSAGE_EDITS = 20;
const STREAM_UPDATE_DEBOUNCE_MS = 400;
const DEFAULT_TOOL_IM_EMOJI = "💻";

interface AssistantSegment {
	kind: "assistant" | "thinking";
	content: string;
	thinkingPrefix?: string;
	messageId?: string;
	messagePrefix: string;
	messageEditCount: number;
	lastRendered: string;
}

interface ToolRunImBlock {
	content: string;
	thinkingPrefix?: string;
	messageId?: string;
	messagePrefix: string;
	messageEditCount: number;
	lastRendered: string;
}

function truncate(text: string, max = 600): string {
	return text.length > max ? `${text.slice(0, max)}...` : text;
}

function capToolImLine(line: string, maxLength: ToolCallImMaxLength): string {
	return maxLength === "none" ? line : truncate(line, maxLength);
}

function stripInlineCodeForIm(text: string): string {
	const trimmed = text.trim();
	if (trimmed.startsWith("`") && trimmed.endsWith("`") && trimmed.length > 1) {
		return trimmed.slice(1, -1).trim();
	}
	return trimmed;
}

export function isSyntheticTaskEvent(event: LarkMessageEvent): boolean {
	return event.sender.sender_type === "system" && event.message.user_agent === "ousia-task-engine";
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
	for (const key of ["command", "preview", "label", "path", "pattern"]) {
		const v = rec[key];
		if (typeof v === "string" && v.trim()) {
			return stripInlineCodeForIm(v).replace(/\s+/g, " ");
		}
	}
	for (const v of Object.values(rec)) {
		if (typeof v === "string" && v.trim()) {
			return stripInlineCodeForIm(v).replace(/\s+/g, " ");
		}
	}
	return "";
}

function formatToolImLine(toolName: string, args: unknown, maxLength: ToolCallImMaxLength): string {
	const emoji = toolCallImEmoji(toolName);
	const base = toolName.replace(/\s+error$/i, "").trim().toLowerCase();
	const rec = args !== null && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};

	if (base === "bash" || base === "shell" || base === "exec") {
		const cmd = firstStringFieldForIm(rec);
		return capToolImLine(`${emoji} ${cmd || "(no command)"}`, maxLength);
	}
	if (base === "read" || base === "write" || base === "edit") {
		const pathStr = typeof rec.path === "string" ? rec.path : "";
		return capToolImLine(`${emoji} ${base} ${imBasename(pathStr || "(no path)")}`, maxLength);
	}
	if (base === "grep") {
		const pat = typeof rec.pattern === "string" ? rec.pattern.trim().replace(/\s+/g, " ") : "";
		const pathStr = typeof rec.path === "string" ? rec.path.trim() : "";
		const tail = pathStr ? ` ${imBasename(pathStr)}` : "";
		return capToolImLine(`${emoji} grep ${pat || "?"}${tail}`, maxLength);
	}
	if (base === "find") {
		const pathStr = typeof rec.path === "string" ? rec.path.trim() : "";
		const pat = typeof rec.pattern === "string" ? rec.pattern.trim() : "";
		const head = pathStr ? imBasename(pathStr) : ".";
		return capToolImLine(`${emoji} find ${pat ? `${head} ${pat.replace(/\s+/g, " ")}` : head}`, maxLength);
	}
	if (base === "ls") {
		const pathStr = typeof rec.path === "string" ? rec.path.trim() : "";
		return capToolImLine(`${emoji} ls ${pathStr ? imBasename(pathStr) : "."}`, maxLength);
	}

	const hint = firstStringFieldForIm(rec);
	return capToolImLine(hint ? `${emoji} ${hint}` : `${emoji} ${toolName.replace(/\s+error$/i, "").trim()}`, maxLength);
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

function formatToolImErrorLine(toolName: string, result: unknown, maxLength: ToolCallImMaxLength): string {
	const emoji = toolCallImEmoji(`${toolName} error`);
	const msg = formatToolImErrorSummary(result);
	return capToolImLine(msg ? `${emoji} ${toolName} error ${msg}` : `${emoji} ${toolName} error`, maxLength);
}

function toQuotedMarkdown(body: string): string {
	const lines = body.trim() ? body.split("\n").map((line) => `> ${line}`) : [];
	return lines.join("\n");
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

function buildMarkdownCard(text: string): Record<string, unknown> {
	return {
		config: {
			update_multi: true,
			wide_screen_mode: true,
		},
		elements: [
			{
				tag: "div",
				text: {
					tag: "lark_md",
					content: text,
				},
			},
		],
	};
}

async function sendStyledReply(
	config: LarkConfig,
	event: LarkMessageEvent,
	text: string,
	mode: FeishuMessageOutputMode,
): Promise<LarkSendResult> {
	if (mode === "card") {
		return sendCardLark({
			config,
			to: event.message.chat_id,
			card: buildMarkdownCard(text),
		});
	}
	return sendPlainReply(config, event, text);
}

export interface LarkProgressDeliveryDeps {
	sendPlainReply(config: LarkConfig, event: LarkMessageEvent, text: string): Promise<LarkSendResult>;
	sendStyledReply(
		config: LarkConfig,
		event: LarkMessageEvent,
		text: string,
		mode: FeishuMessageOutputMode,
	): Promise<LarkSendResult>;
	updateStyledReply(config: LarkConfig, messageId: string, text: string, mode: FeishuMessageOutputMode): Promise<void>;
}

const DEFAULT_DELIVERY_DEPS: LarkProgressDeliveryDeps = {
	sendPlainReply,
	sendStyledReply,
	updateStyledReply,
};

async function updateStyledReply(
	config: LarkConfig,
	messageId: string,
	text: string,
	mode: FeishuMessageOutputMode,
): Promise<void> {
	if (mode === "card") {
		await LarkClient.fromConfig(config).sdk.im.v1.message.patch({
			path: { message_id: messageId },
			data: {
				content: JSON.stringify(buildMarkdownCard(text)),
			},
		});
		return;
	}
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
	private pendingThinkingContent = "";
	private flushTimer?: ReturnType<typeof setTimeout>;
	private pending: Promise<void> = Promise.resolve();
	private visibleResponseStarted = false;
	private assistantDeliverySucceeded = false;
	private lastDeliveryError?: unknown;

	constructor(
		private readonly event: LarkMessageEvent,
		private readonly config: LarkConfig,
		private readonly outputToolCallsToIm: boolean,
		private readonly outputToolCallImMaxLength: ToolCallImMaxLength,
		private readonly outputThinkingToIm: boolean,
		private readonly messageOutputMode: FeishuMessageOutputMode,
		private readonly delivery: LarkProgressDeliveryDeps = DEFAULT_DELIVERY_DEPS,
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
			case "turn_started": {
				this.finalizeActiveSegment();
				break;
			}
			case "thinking_delta":
				if (this.outputThinkingToIm && event.delta) {
					this.appendThinking(event.delta);
				}
				break;
			case "thinking_finished":
				if (this.outputThinkingToIm && event.thinking) {
					this.finishThinking(event.thinking);
				}
				break;
			case "text_start":
				this.startSegment("assistant");
				break;
			case "text_delta":
				if (event.delta) {
					this.appendToSegment("assistant", event.delta);
				}
				break;
			case "text_finished":
				if (event.text) {
					this.finishSegment("assistant", event.text);
				}
				break;
			case "turn_finished":
				this.finalizeActiveSegment();
				this.finalizePendingThinking();
				break;
			case "tool_call_started":
				if (this.outputToolCallsToIm) {
					this.finalizeActiveSegment();
					this.appendToolRunLine(formatToolImLine(event.name, event.args, this.outputToolCallImMaxLength));
				}
				break;
			case "tool_call_finished":
				if (this.outputToolCallsToIm && event.isError) {
					this.appendToolRunLine(formatToolImErrorLine(event.name, event.result, this.outputToolCallImMaxLength));
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
		await this.ensureFinalDelivered(finalText);
		await this.clearReaction();
	}

	async fail(errorMessage: string): Promise<void> {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = undefined;
		}
		await this.clearReaction();
		await this.delivery.sendPlainReply(this.config, this.event, `Failed: ${errorMessage}`);
	}

	async dispose(): Promise<void> {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = undefined;
		}
		await this.pending;
		await this.clearReaction();
	}

	private async ensureFinalDelivered(finalText: string): Promise<void> {
		const normalizedFinalText = finalText.trim();
		if (!normalizedFinalText || this.assistantDeliverySucceeded) {
			return;
		}

		const cause = this.lastDeliveryError ? ` after delivery failure: ${formatLarkError(this.lastDeliveryError)}` : "";
		console.warn(chalk.gray(`Lark final reply fallback triggered${cause}`));
		const result = await this.delivery.sendPlainReply(this.config, this.event, normalizedFinalText);
		this.recordSendSuccess(result, "final_fallback");
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
				thinkingPrefix: kind === "assistant" && this.outputThinkingToIm ? this.consumePendingThinking() : undefined,
				messagePrefix: "",
				messageEditCount: 0,
				lastRendered: "",
			};
		}

		private appendThinking(delta: string): void {
			this.pendingThinkingContent += delta;
		}

		private finishThinking(content: string): void {
			this.pendingThinkingContent = content;
		}

		private consumePendingThinking(): string | undefined {
			const thinking = this.pendingThinkingContent.trim();
			this.pendingThinkingContent = "";
			return thinking || undefined;
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
			const parts = [
				segment.thinkingPrefix ? toQuotedMarkdown(truncate(segment.thinkingPrefix, 3000)) : "",
				segment.kind === "thinking" ? toQuotedMarkdown(truncate(segment.content.trim(), 3000)) : segment.content.trim(),
			].filter(Boolean);
			return parts.join("\n");
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

		private finalizePendingThinking(): void {
			if (!this.outputThinkingToIm) {
				this.pendingThinkingContent = "";
				return;
			}
			const thinking = this.consumePendingThinking();
			if (!thinking) {
				return;
			}
			const segment: AssistantSegment = {
				kind: "thinking",
				content: thinking,
				messagePrefix: "",
				messageEditCount: 0,
				lastRendered: "",
			};
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
				await this.delivery.updateStyledReply(this.config, segment.messageId, currentChunk, this.messageOutputMode);
				segment.messageEditCount += 1;
				this.recordUpdateSuccess(segment.kind);
			} catch (error) {
				if (segment.kind === "assistant") {
					this.assistantDeliverySucceeded = false;
				}
				if (isMessageEditLimitError(error)) {
					console.warn(chalk.gray("Assistant segment edit limit reached, continuing in a new message."));
					segment.messagePrefix = segment.lastRendered;
					currentChunk = getContinuationText(rendered, segment.messagePrefix);
				} else {
					this.recordDeliveryFailure(error, "assistant_segment_update");
					segment.messagePrefix = "";
					currentChunk = rendered;
				}
				segment.messageId = undefined;
				segment.messageEditCount = 0;
			}
		}
		if (!segment.messageId && currentChunk) {
			try {
				const result = await this.delivery.sendStyledReply(this.config, this.event, currentChunk, this.messageOutputMode);
				this.recordSendSuccess(result, "assistant_segment", segment.kind);
				segment.messageId = result.messageId;
				segment.messagePrefix = rendered.slice(0, rendered.length - currentChunk.length);
				segment.messageEditCount = 0;
			} catch (error) {
				if (segment.kind === "assistant") {
					this.assistantDeliverySucceeded = false;
				}
				throw error;
			}
		}
		segment.lastRendered = rendered;
	}

	private appendToolRunLine(line: string): void {
			if (!this.toolRunImBlock) {
				this.toolRunImBlock = {
					content: "",
					thinkingPrefix: this.outputThinkingToIm ? this.consumePendingThinking() : undefined,
					messagePrefix: "",
					messageEditCount: 0,
					lastRendered: "",
			};
		}
		this.toolRunImBlock.content += (this.toolRunImBlock.content ? "\n" : "") + line;
		const block = this.toolRunImBlock;
		this.enqueue(() => this.pushToolRunBlock(block));
	}

	private async pushToolRunBlock(block: ToolRunImBlock): Promise<void> {
		const rendered = [
			block.thinkingPrefix ? toQuotedMarkdown(truncate(block.thinkingPrefix, 3000)) : "",
			block.content.trim(),
		].filter(Boolean).join("\n");
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
				await this.delivery.updateStyledReply(this.config, block.messageId, currentChunk, this.messageOutputMode);
				block.messageEditCount += 1;
				this.recordUpdateSuccess("tool");
			} catch (error) {
				if (isMessageEditLimitError(error)) {
					console.warn(chalk.gray("Tool run IM edit limit reached, continuing in a new message."));
					block.messagePrefix = block.lastRendered;
					currentChunk = getContinuationText(rendered, block.messagePrefix);
				} else {
					this.recordDeliveryFailure(error, "tool_run_update");
					block.messagePrefix = "";
					currentChunk = rendered;
				}
				block.messageId = undefined;
				block.messageEditCount = 0;
			}
		}
		if (!block.messageId && currentChunk) {
			const result = await this.delivery.sendStyledReply(this.config, this.event, currentChunk, this.messageOutputMode);
			this.recordSendSuccess(result, "tool_run", "tool");
			block.messageId = result.messageId;
			block.messagePrefix = rendered.slice(0, rendered.length - currentChunk.length);
			block.messageEditCount = 0;
		}
		block.lastRendered = rendered;
	}

	private enqueue(task: () => Promise<void>): void {
		this.pending = this.pending
			.then(task)
			.catch((error) => this.recordDeliveryFailure(error, "queued_delivery"));
	}

	private recordSendSuccess(
		result: LarkSendResult,
		source: string,
		kind: AssistantSegment["kind"] | "tool" = "assistant",
	): void {
		if (!result.messageId) {
			throw new Error(`Lark ${source} send returned empty message_id.`);
		}
		if (kind === "assistant") {
			this.assistantDeliverySucceeded = true;
		}
	}

	private recordUpdateSuccess(kind: AssistantSegment["kind"] | "tool"): void {
		if (kind === "assistant") {
			this.assistantDeliverySucceeded = true;
		}
	}

	private recordDeliveryFailure(error: unknown, source: string): void {
		this.lastDeliveryError = error;
		console.warn(chalk.gray(`Lark progress delivery failed source=${source}: ${formatLarkError(error)}`));
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
