import type { LarkMessageEvent } from "./platform/index.js";

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
	if (threadId) {
		return `${event.message.chat_id}:${threadId}`;
	}
	return event.message.chat_id;
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

export function shouldHandleMessage(event: LarkMessageEvent, botOpenId: string | undefined): boolean {
	if (wasSentByBot(event, botOpenId)) {
		return false;
	}
	if (event.message.chat_type === "group" && !isBotMentioned(event, botOpenId)) {
		return false;
	}
	return true;
}

export function isRecentMessage(event: LarkMessageEvent, startedAtMs: number): boolean {
	const createdAt = Number(event.message.create_time);
	if (!Number.isFinite(createdAt)) {
		return true;
	}
	return createdAt >= startedAtMs - 5000;
}

function flattenPostContent(content: unknown): string {
	if (!content || typeof content !== "object") {
		return "";
	}

	const localeValues = Object.values(content as Record<string, unknown>);
	const textParts: string[] = [];
	for (const locale of localeValues) {
		if (!locale || typeof locale !== "object" || !("content" in locale)) {
			continue;
		}
		const rows = (locale as { content?: unknown }).content;
		if (!Array.isArray(rows)) {
			continue;
		}
		for (const row of rows) {
			if (!Array.isArray(row)) {
				continue;
			}
			for (const cell of row) {
				if (!cell || typeof cell !== "object") {
					continue;
				}
				const maybeText = (cell as { text?: unknown }).text;
				if (typeof maybeText === "string") {
					textParts.push(maybeText);
				}
			}
		}
	}
	return textParts.join("\n").trim();
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
