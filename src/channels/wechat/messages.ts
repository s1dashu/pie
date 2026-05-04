import crypto from "node:crypto";
import { MessageItemType, MessageState, MessageType, type MessageItem, type SendMessageReq, type WechatMessage } from "./platform/types.js";

const MAX_PROCESSED_MESSAGE_IDS = 1000;
const DEFAULT_MAX_WECHAT_TEXT_BYTES = 6000;
const WECHAT_TEXT_NATURAL_SPLIT_AFTER_CHARS = 3000;

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
		if (current.length >= WECHAT_TEXT_NATURAL_SPLIT_AFTER_CHARS && isSentenceEnd(char)) {
			chunks.push(current.trim());
			current = "";
		}
	}
	if (current.trim()) {
		chunks.push(current.trim());
	}
	return chunks;
}

export function splitWechatText(text: string, maxBytes: number = DEFAULT_MAX_WECHAT_TEXT_BYTES): string[] {
	const normalized = text.trim();
	if (!normalized) {
		return [""];
	}
	return splitOversizedText(normalized, maxBytes);
}
