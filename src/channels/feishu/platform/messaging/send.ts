/**
 * Adapted from larksuite/openclaw-lark.
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import type * as Lark from "@larksuiteoapi/node-sdk";
import { LarkClient } from "../core/lark-client.js";
import { larkLogger } from "../core/logger.js";
import { normalizeLarkTarget, normalizeMessageId, resolveReceiveIdType } from "../core/targets.js";
import type { LarkConfig } from "../core/types.js";
import type { LarkSendResult } from "./types.js";

const log = larkLogger("messaging/send");

function buildPostContent(text: string, locale = "zh_cn"): string {
	return JSON.stringify({
		[locale]: {
			content: [[{ tag: "md", text }]],
		},
	});
}

function normalizeAtMentions(text: string): string {
	return text.replace(/<at\s+(?:id|open_id|user_id)\s*=\s*"?([^">\s]+)"?\s*>/gi, '<at user_id="$1">');
}

function detectCardJson(text: string): Record<string, unknown> | undefined {
	const trimmed = text.trim();
	if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
		return undefined;
	}

	try {
		const parsed: unknown = JSON.parse(trimmed);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			return undefined;
		}

		const card = parsed as Record<string, unknown>;
		if (card.schema === "2.0") {
			return card;
		}
		if (Array.isArray(card.elements) && (card.config !== undefined || card.header !== undefined)) {
			return card;
		}
		if (
			card.type === "template" &&
			typeof card.data === "object" &&
			card.data !== null &&
			typeof (card.data as Record<string, unknown>).template_id === "string"
		) {
			return card;
		}
		if (
			(card.msg_type === "interactive" || card.type === "interactive") &&
			typeof card.card === "object" &&
			card.card
		) {
			return card.card as Record<string, unknown>;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

async function sendImMessage(params: {
	client: Lark.Client;
	to: string;
	content: string;
	msgType: "post" | "interactive";
	replyToMessageId?: string;
	replyInThread?: boolean;
}): Promise<LarkSendResult> {
	const { client, to, content, msgType, replyToMessageId, replyInThread } = params;

	if (replyToMessageId) {
		const normalizedMessageId = normalizeMessageId(replyToMessageId);
		if (!normalizedMessageId) {
			throw new Error("Invalid replyToMessageId");
		}
		const response = await client.im.message.reply({
			path: { message_id: normalizedMessageId },
			data: {
				content,
				msg_type: msgType,
				reply_in_thread: replyInThread,
			},
		});

		return {
			messageId: response?.data?.message_id ?? "",
			chatId: response?.data?.chat_id ?? "",
		};
	}

	const target = normalizeLarkTarget(to);
	if (!target) {
		throw new Error(`Invalid Lark target: "${to}"`);
	}
	const receiveIdType = resolveReceiveIdType(target);
	const response = await client.im.message.create({
		params: {
			receive_id_type: receiveIdType as never,
		},
		data: {
			receive_id: target,
			msg_type: msgType,
			content,
		},
	});

	return {
		messageId: response?.data?.message_id ?? "",
		chatId: response?.data?.chat_id ?? "",
	};
}

export interface SendTextLarkParams {
	config: LarkConfig;
	to: string;
	text: string;
	replyToMessageId?: string;
	replyInThread?: boolean;
	accountId?: string;
	locale?: string;
}

export interface SendCardLarkParams {
	config: LarkConfig;
	to: string;
	card: Record<string, unknown>;
	replyToMessageId?: string;
	replyInThread?: boolean;
	accountId?: string;
}

export interface UpdateTextLarkParams {
	config: LarkConfig;
	messageId: string;
	text: string;
	accountId?: string;
	locale?: string;
}

export interface AddReactionLarkParams {
	config: LarkConfig;
	messageId: string;
	emojiType: string;
	accountId?: string;
}

export interface RemoveReactionLarkParams {
	config: LarkConfig;
	messageId: string;
	reactionId: string;
	accountId?: string;
}

export async function sendTextLark(params: SendTextLarkParams): Promise<LarkSendResult> {
	const { config, to, text, replyToMessageId, replyInThread, accountId, locale } = params;
	const card = detectCardJson(text);
	if (card) {
		log.info("detected card JSON in text payload, routing to sendCardLark", { target: to });
		return sendCardLark({
			config,
			to,
			card,
			replyToMessageId,
			replyInThread,
			accountId,
		});
	}

	const client = LarkClient.fromConfig(config, accountId).sdk;
	const processedText = normalizeAtMentions(text);
	const content = buildPostContent(processedText, locale);
	return sendImMessage({
		client,
		to,
		content,
		msgType: "post",
		replyToMessageId,
		replyInThread,
	});
}

export async function sendCardLark(params: SendCardLarkParams): Promise<LarkSendResult> {
	const { config, to, card, replyToMessageId, replyInThread, accountId } = params;
	const client = LarkClient.fromConfig(config, accountId).sdk;
	const content = JSON.stringify(card);
	return sendImMessage({
		client,
		to,
		content,
		msgType: "interactive",
		replyToMessageId,
		replyInThread,
	});
}

export async function updateTextLark(params: UpdateTextLarkParams): Promise<LarkSendResult> {
	const { config, messageId, text, accountId, locale } = params;
	const client = LarkClient.fromConfig(config, accountId).sdk;
	const normalizedMessageId = normalizeMessageId(messageId);
	if (!normalizedMessageId) {
		throw new Error("Invalid messageId");
	}
	const processedText = normalizeAtMentions(text);
	const content = buildPostContent(processedText, locale);
	const response = await client.im.message.update({
		path: { message_id: normalizedMessageId },
		data: {
			msg_type: "post",
			content,
		},
	});

	return {
		messageId: response?.data?.message_id ?? normalizedMessageId,
		chatId: response?.data?.chat_id ?? "",
	};
}

export async function addReactionLark(params: AddReactionLarkParams): Promise<{ reactionId: string }> {
	const { config, messageId, emojiType, accountId } = params;
	const client = LarkClient.fromConfig(config, accountId).sdk;
	const normalizedMessageId = normalizeMessageId(messageId);
	if (!normalizedMessageId) {
		throw new Error("Invalid messageId");
	}
	const response = await client.im.messageReaction.create({
		path: { message_id: normalizedMessageId },
		data: {
			reaction_type: {
				emoji_type: emojiType,
			},
		},
	});

	return {
		reactionId: response?.data?.reaction_id ?? "",
	};
}

export async function removeReactionLark(params: RemoveReactionLarkParams): Promise<void> {
	const { config, messageId, reactionId, accountId } = params;
	const client = LarkClient.fromConfig(config, accountId).sdk;
	const normalizedMessageId = normalizeMessageId(messageId);
	if (!normalizedMessageId) {
		throw new Error("Invalid messageId");
	}
	if (!reactionId) {
		throw new Error("Invalid reactionId");
	}
	await client.im.messageReaction.delete({
		path: {
			message_id: normalizedMessageId,
			reaction_id: reactionId,
		},
	});
}
