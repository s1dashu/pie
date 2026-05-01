/**
 * Adapted from larksuite/openclaw-lark.
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import type { LarkIdType } from "./types.js";

const CHAT_PREFIX = "oc_";
const OPEN_ID_PREFIX = "ou_";
const TAG_CHAT = "chat:";
const TAG_USER = "user:";
const TAG_OPEN_ID = "open_id:";
const TAG_LARK = "lark:";
const TAG_FEISHU_ALIAS = "feishu:";
const ROUTE_META_FRAGMENT_REPLY_TO = "__lark_reply_to";
const ROUTE_META_FRAGMENT_THREAD_ID = "__lark_thread_id";

export function detectIdType(id: string): LarkIdType | null {
	if (!id) {
		return null;
	}
	if (id.startsWith(CHAT_PREFIX)) {
		return "chat_id";
	}
	if (id.startsWith(OPEN_ID_PREFIX)) {
		return "open_id";
	}
	if (/^[a-zA-Z0-9]+$/.test(id)) {
		return "user_id";
	}
	return null;
}

export interface LarkRouteTarget {
	target: string;
	replyToMessageId?: string;
	threadId?: string;
}

export function normalizeLarkTarget(raw: string): string | null {
	if (!raw) {
		return null;
	}

	const trimmed = parseLarkRouteTarget(raw).target.trim();
	if (!trimmed) {
		return null;
	}
	if (trimmed.startsWith(TAG_LARK)) {
		const inner = trimmed.slice(TAG_LARK.length).trim();
		return inner || null;
	}
	if (trimmed.startsWith(TAG_FEISHU_ALIAS)) {
		const inner = trimmed.slice(TAG_FEISHU_ALIAS.length).trim();
		return inner || null;
	}
	if (trimmed.startsWith(TAG_CHAT)) {
		return trimmed.slice(TAG_CHAT.length);
	}
	if (trimmed.startsWith(TAG_USER)) {
		return trimmed.slice(TAG_USER.length);
	}
	if (trimmed.startsWith(TAG_OPEN_ID)) {
		return trimmed.slice(TAG_OPEN_ID.length);
	}
	return trimmed;
}

export function parseLarkRouteTarget(raw: string): LarkRouteTarget {
	const trimmed = raw.trim();
	if (!trimmed) {
		return { target: "" };
	}

	const hashIndex = trimmed.indexOf("#");
	if (hashIndex < 0) {
		return { target: trimmed };
	}

	const target = trimmed.slice(0, hashIndex).trim();
	const fragment = trimmed.slice(hashIndex + 1).trim();
	if (!fragment) {
		return { target };
	}

	const params = new URLSearchParams(fragment);
	const replyToMessageId = normalizeMessageId(params.get(ROUTE_META_FRAGMENT_REPLY_TO)?.trim() || undefined);
	const threadId = params.get(ROUTE_META_FRAGMENT_THREAD_ID)?.trim() || undefined;

	return {
		target,
		...(replyToMessageId ? { replyToMessageId } : {}),
		...(threadId ? { threadId } : {}),
	};
}

export function encodeLarkRouteTarget(params: {
	target: string;
	replyToMessageId?: string;
	threadId?: string | number | null;
}): string {
	const target = params.target.trim();
	if (!target) {
		return target;
	}

	const replyToMessageId = normalizeMessageId(params.replyToMessageId?.trim() || undefined);
	const threadId =
		params.threadId != null && String(params.threadId).trim() !== "" ? String(params.threadId).trim() : undefined;
	if (!replyToMessageId && !threadId) {
		return target;
	}

	const fragment = new URLSearchParams();
	if (replyToMessageId) {
		fragment.set(ROUTE_META_FRAGMENT_REPLY_TO, replyToMessageId);
	}
	if (threadId) {
		fragment.set(ROUTE_META_FRAGMENT_THREAD_ID, threadId);
	}
	return `${target}#${fragment.toString()}`;
}

export function formatLarkTarget(id: string, type?: LarkIdType): string {
	const resolved = type ?? detectIdType(id);
	if (resolved === "chat_id") {
		return `${TAG_CHAT}${id}`;
	}
	return `${TAG_USER}${id}`;
}

export function resolveReceiveIdType(id: string): "chat_id" | "open_id" | "user_id" {
	if (id.startsWith(CHAT_PREFIX)) {
		return "chat_id";
	}
	if (id.startsWith(OPEN_ID_PREFIX)) {
		return "open_id";
	}
	return "open_id";
}

export function normalizeMessageId(messageId: string): string;
export function normalizeMessageId(messageId: string | undefined): string | undefined;
export function normalizeMessageId(messageId: string | undefined): string | undefined {
	if (!messageId) {
		return undefined;
	}
	const colonIndex = messageId.indexOf(":");
	if (colonIndex >= 0) {
		return messageId.slice(0, colonIndex);
	}
	return messageId;
}

export function looksLikeLarkId(raw: string): boolean {
	if (!raw) {
		return false;
	}
	return (
		raw.startsWith(TAG_CHAT) ||
		raw.startsWith(TAG_USER) ||
		raw.startsWith(TAG_OPEN_ID) ||
		raw.startsWith(CHAT_PREFIX) ||
		raw.startsWith(OPEN_ID_PREFIX)
	);
}
