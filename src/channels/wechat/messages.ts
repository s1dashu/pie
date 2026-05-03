import crypto from "node:crypto";
import { MessageItemType, MessageState, MessageType, type MessageItem, type SendMessageReq, type WechatMessage } from "./platform/types.js";

const MAX_PROCESSED_MESSAGE_IDS = 1000;
const DEFAULT_MAX_WECHAT_TEXT_BYTES = 1500;
const SENTENCE_SPLIT_WINDOW_MIN_BYTES = 60;
const SENTENCE_SPLIT_WINDOW_MAX_BYTES = 600;

export class MessageDedup {
	private readonly ids = new Set<string>();
	private readonly queue: string[] = [];

	record(messageId: string): boolean {
		if (this.ids.has(messageId)) {
			return false;
		}
		this.ids.add(messageId);
		this.queue.push(messageId);
		if (this.queue.length > MAX_PROCESSED_MESSAGE_IDS) {
			const removed = this.queue.shift();
			if (removed) {
				this.ids.delete(removed);
			}
		}
		return true;
	}
}

function bodyFromItemList(itemList?: MessageItem[]): string {
	if (!itemList?.length) {
		return "";
	}
	for (const item of itemList) {
		if (item.type === MessageItemType.TEXT && item.text_item?.text != null) {
			const text = String(item.text_item.text);
			const ref = item.ref_msg;
			if (!ref) {
				return text;
			}
			const parts = [ref.title, ref.message_item ? bodyFromItemList([ref.message_item]) : undefined]
				.filter((part): part is string => Boolean(part?.trim()));
			return parts.length ? `[引用: ${parts.join(" | ")}]\n${text}` : text;
		}
		if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
			return item.voice_item.text;
		}
	}
	return "";
}

export function getWechatMessageId(message: WechatMessage): string {
	return message.message_id != null ? String(message.message_id) : `${message.from_user_id ?? "unknown"}:${message.seq ?? crypto.randomUUID()}`;
}

export function getConversationKey(message: WechatMessage): string {
	return message.from_user_id?.trim() || message.session_id?.trim() || getWechatMessageId(message);
}

export function extractPromptText(message: WechatMessage): string | null {
	const text = bodyFromItemList(message.item_list).trim();
	return text || null;
}

export function isRecentMessage(message: WechatMessage, startedAtMs: number): boolean {
	const createdAt = message.create_time_ms;
	if (!Number.isFinite(createdAt)) {
		return true;
	}
	return createdAt! >= startedAtMs - 5000;
}

export function buildTextMessageReq(params: {
	to: string;
	text: string;
	contextToken?: string;
	clientId?: string;
}): SendMessageReq {
	return {
		msg: {
			from_user_id: "",
			to_user_id: params.to,
			client_id: params.clientId ?? `pie-wechat-${crypto.randomUUID()}`,
			message_type: MessageType.BOT,
			message_state: MessageState.FINISH,
			item_list: params.text ? [{ type: MessageItemType.TEXT, text_item: { text: params.text } }] : undefined,
			context_token: params.contextToken,
		},
	};
}

function utf8Bytes(text: string): number {
	return Buffer.byteLength(text, "utf8");
}

function isSentenceEnd(char: string): boolean {
	return char === "。" || char === "." || char === "！" || char === "!" || char === "？" || char === "?";
}

function splitOversizedText(text: string, maxBytes: number): string[] {
	const chunks: string[] = [];
	let current = "";
	for (const char of text) {
		if (current && utf8Bytes(current + char) > maxBytes) {
			chunks.push(current.trim());
			current = "";
		}
		current += char;
		const remainingBytes = maxBytes - utf8Bytes(current);
		if (
			isSentenceEnd(char) &&
			remainingBytes >= SENTENCE_SPLIT_WINDOW_MIN_BYTES &&
			remainingBytes <= SENTENCE_SPLIT_WINDOW_MAX_BYTES
		) {
			chunks.push(current.trim());
			current = "";
		}
	}
	if (current.trim()) {
		chunks.push(current.trim());
	}
	return chunks;
}

function isFenceStart(line: string): string | undefined {
	const match = /^(\s*)(```+|~~~+)/.exec(line);
	return match?.[2];
}

function isFenceEnd(line: string, fence: string): boolean {
	return line.trimStart().startsWith(fence);
}

function isTableLine(line: string): boolean {
	return line.includes("|") && line.trim().length > 0;
}

function splitMarkdownBlocks(text: string): string[] {
	const lines = text.split("\n");
	const blocks: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i]!;
		const fence = isFenceStart(line);
		if (fence) {
			const start = i;
			i += 1;
			while (i < lines.length && !isFenceEnd(lines[i]!, fence)) {
				i += 1;
			}
			if (i < lines.length) {
				i += 1;
			}
			blocks.push(lines.slice(start, i).join("\n"));
			continue;
		}
		if (isTableLine(line)) {
			const start = i;
			while (i < lines.length && isTableLine(lines[i]!)) {
				i += 1;
			}
			blocks.push(lines.slice(start, i).join("\n"));
			continue;
		}
		const start = i;
		i += 1;
		while (i < lines.length && lines[i]!.trim() !== "" && !isFenceStart(lines[i]!) && !isTableLine(lines[i]!)) {
			i += 1;
		}
		while (i < lines.length && lines[i]!.trim() === "") {
			i += 1;
		}
		blocks.push(lines.slice(start, i).join("\n"));
	}
	return blocks.map((block) => block.trim()).filter(Boolean);
}

function isMarkdownTableBlock(block: string): boolean {
	const lines = block.split("\n").filter((line) => line.trim());
	return lines.length >= 2 && lines.every(isTableLine);
}

function splitOversizedTable(block: string, maxBytes: number): string[] {
	const lines = block.split("\n").filter((line) => line.trim());
	if (lines.length <= 2) {
		return splitOversizedText(block, maxBytes);
	}
	const header = lines.slice(0, 2).join("\n");
	const rows = lines.slice(2);
	const chunks: string[] = [];
	let current = header;
	for (const row of rows) {
		const next = `${current}\n${row}`;
		if (utf8Bytes(next) > maxBytes) {
			if (current !== header) {
				chunks.push(current);
				current = `${header}\n${row}`;
			} else {
				chunks.push(...splitOversizedText(row, maxBytes));
			}
		} else {
			current = next;
		}
	}
	if (current.trim() && current !== header) {
		chunks.push(current);
	}
	return chunks.length ? chunks : splitOversizedText(block, maxBytes);
}

export function splitWechatText(text: string, maxBytes: number = DEFAULT_MAX_WECHAT_TEXT_BYTES): string[] {
	const normalized = text.trim();
	if (!normalized) {
		return [""];
	}
	if (utf8Bytes(normalized) <= maxBytes) {
		return [normalized];
	}
	const chunks: string[] = [];
	let current = "";
	for (const part of splitMarkdownBlocks(normalized)) {
		if (!part) {
			continue;
		}
		if (utf8Bytes(part) > maxBytes) {
			if (current.trim()) {
				chunks.push(current.trim());
				current = "";
			}
			const oversizedChunks = isMarkdownTableBlock(part)
				? splitOversizedTable(part, maxBytes)
				: splitOversizedText(part, maxBytes);
			chunks.push(...oversizedChunks.map((chunk) => chunk.trim()).filter(Boolean));
			continue;
		}
		const next = current ? `${current}\n\n${part}` : part;
		if (current && utf8Bytes(next) > maxBytes) {
			chunks.push(current.trim());
			current = part;
		} else {
			current = next;
		}
	}
	if (current.trim()) {
		chunks.push(current.trim());
	}
	return chunks.length ? chunks : [normalized];
}
