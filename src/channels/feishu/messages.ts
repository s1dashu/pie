import type { LarkMessageEvent } from "./platform/index.js";
import type { ChannelMessagePart } from "../common/channel-model.js";
import { shouldRespondToImMessage, type ImGroupResponseMode } from "../../core/im-behavior.js";

const MAX_PROCESSED_MESSAGE_IDS = 1000;

export class MessageDedup {
	private ids = new Set<string>();
	private queue: string[] = [];

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

export function sanitizePathSegment(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function getConversationKey(event: LarkMessageEvent): string {
	const threadId = event.message.thread_id?.trim();
	const chatId = event.message.chat_id?.trim();
	if (threadId) {
		return chatId ? `${chatId}:${threadId}` : threadId;
	}
	return chatId || event.message.message_id;
}

export function wasSentByBot(event: LarkMessageEvent, botOpenId: string | undefined): boolean {
	const senderOpenId = event.sender.sender_id.open_id;
	return Boolean(botOpenId && senderOpenId && senderOpenId === botOpenId);
}

export function isBotMentioned(event: LarkMessageEvent, botOpenId: string | undefined): boolean {
	if (!botOpenId) {
		return false;
	}
	return (event.message.mentions ?? []).some(
		(mention: NonNullable<LarkMessageEvent["message"]["mentions"]>[number]) => mention.id.open_id === botOpenId,
	);
}

export function shouldHandleMessage(
	event: LarkMessageEvent,
	botOpenId: string | undefined,
	options?: { ownerOpenId?: string; groupResponseMode?: ImGroupResponseMode },
): boolean {
	if (wasSentByBot(event, botOpenId)) {
		return false;
	}
	return shouldRespondToImMessage({
		isDirectMessage: event.message.chat_type === "p2p",
		isBotMentioned: isBotMentioned(event, botOpenId),
		senderId: event.sender.sender_id.open_id,
		ownerId: options?.ownerOpenId,
		groupResponseMode: options?.groupResponseMode ?? "owner_mention",
	});
}

export function isRecentMessage(event: LarkMessageEvent, startedAtMs: number): boolean {
	const createdAt = Number(event.message.create_time);
	if (!Number.isFinite(createdAt)) {
		return true;
	}
	return createdAt >= startedAtMs - 5000;
}

function textFromPostCell(cell: unknown): string {
	if (!cell || typeof cell !== "object") {
		return "";
	}
	const value = cell as Record<string, unknown>;
	if (typeof value.text === "string") {
		return value.text;
	}
	if (typeof value.user_name === "string") {
		return `@${value.user_name}`;
	}
	if (typeof value.emoji_type === "string") {
		return `[${value.emoji_type}]`;
	}
	return "";
}

function flattenPostRows(rows: unknown): string {
	if (!Array.isArray(rows)) {
		return "";
	}
	const lines: string[] = [];
	for (const row of rows) {
		if (!Array.isArray(row)) {
			continue;
		}
		const line = row.map(textFromPostCell).join("").trim();
		if (line) {
			lines.push(line);
		}
	}
	return lines.join("\n").trim();
}

function collectNestedText(value: unknown, parts: string[]): void {
	if (typeof value === "string") {
		parts.push(value);
		return;
	}
	if (!value || typeof value !== "object") {
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) {
			collectNestedText(item, parts);
		}
		return;
	}
	const record = value as Record<string, unknown>;
	for (const key of ["text", "content", "title", "user_name", "emoji_type"]) {
		collectNestedText(record[key], parts);
	}
}

function flattenPostContent(content: unknown): string {
	if (!content || typeof content !== "object") {
		return "";
	}

	const record = content as Record<string, unknown>;
	const directContent = flattenPostRows(record.content);
	if (directContent) {
		return directContent;
	}

	const localeValues = Object.values(record);
	for (const locale of localeValues) {
		if (!locale || typeof locale !== "object" || !("content" in locale)) {
			continue;
		}
		const localeContent = flattenPostRows((locale as { content?: unknown }).content);
		if (localeContent) {
			return localeContent;
		}
	}

	const nestedTextParts: string[] = [];
	collectNestedText(content, nestedTextParts);
	return nestedTextParts.join("\n").trim();
}

function stripBotMentions(text: string, botOpenId: string | undefined): string {
	if (!botOpenId) {
		return text.trim();
	}
	return text
		.replace(new RegExp(`<at\\s+user_id="${botOpenId}"[^>]*>.*?<\\/at>`, "gi"), "")
		.replace(/\u200b/g, "")
		.trim();
}

export function extractPromptText(event: LarkMessageEvent, botOpenId: string | undefined): string | null {
	const rawContent = event.message.content;
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawContent);
	} catch {
		const text = stripBotMentions(rawContent, botOpenId);
		return text || null;
	}

	switch (event.message.message_type) {
		case "text": {
			const text =
				typeof (parsed as { text?: unknown }).text === "string" ? (parsed as { text: string }).text : rawContent;
			const cleaned = stripBotMentions(text, botOpenId);
			return cleaned || null;
		}
		case "post": {
			const text = flattenPostContent(parsed);
			const cleaned = stripBotMentions(text, botOpenId);
			return cleaned || null;
		}
		default:
			return null;
	}
}

function readStringField(record: Record<string, unknown>, names: string[]): string | undefined {
	for (const name of names) {
		const value = record[name];
		if (typeof value === "string" && value.trim()) {
			return value.trim();
		}
	}
	return undefined;
}

function collectResourceParts(value: unknown, parts: ChannelMessagePart[]): void {
	if (!value || typeof value !== "object") {
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) {
			collectResourceParts(item, parts);
		}
		return;
	}
	const record = value as Record<string, unknown>;
	const imageKey = readStringField(record, ["image_key", "imageKey", "img_key", "imgKey"]);
	const fileKey = readStringField(record, ["file_key", "fileKey"]);
	const url = readStringField(record, ["url", "image_url", "imageUrl", "download_url", "downloadUrl"]);
	const mimeType = readStringField(record, ["mime_type", "mimeType", "content_type", "contentType"]);
	const name = readStringField(record, ["file_name", "fileName", "name"]);
	if (imageKey || url) {
		parts.push({
			type: "image",
			url: url ?? (imageKey ? `feishu://image/${imageKey}` : undefined),
			mimeType,
			altText: imageKey ? `image_key=${imageKey}` : undefined,
		});
	}
	if (fileKey) {
		parts.push({
			type: "file",
			url: `feishu://file/${fileKey}`,
			name: name ?? fileKey,
			mimeType,
		});
	}
	for (const child of Object.values(record)) {
		if (child && typeof child === "object") {
			collectResourceParts(child, parts);
		}
	}
}

export function extractMessageParts(event: LarkMessageEvent, botOpenId: string | undefined): ChannelMessagePart[] {
	const parts: ChannelMessagePart[] = [];
	const text = extractPromptText(event, botOpenId);
	if (text) {
		parts.push({ type: "text", text });
	}
	try {
		collectResourceParts(JSON.parse(event.message.content), parts);
	} catch {
		// Plain text message content has no structured resources.
	}
	return parts;
}
