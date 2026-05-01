/**
 * Adapted from larksuite/openclaw-lark.
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

export interface LarkMessageEvent {
	sender: {
		sender_id: {
			open_id?: string;
			user_id?: string;
			union_id?: string;
		};
		sender_type?: string;
		tenant_key?: string;
	};
	message: {
		message_id: string;
		root_id?: string;
		parent_id?: string;
		create_time?: string;
		update_time?: string;
		chat_id: string;
		thread_id?: string;
		chat_type: "p2p" | "group";
		message_type: string;
		content: string;
		mentions?: Array<{
			key: string;
			id: {
				open_id?: string;
				user_id?: string;
				union_id?: string;
			};
			name: string;
			tenant_key?: string;
		}>;
		user_agent?: string;
	};
}

export interface LarkReactionCreatedEvent {
	message_id: string;
	chat_id?: string;
	chat_type?: "p2p" | "group" | "private";
	reaction_type?: { emoji_type?: string };
	operator_type?: string;
	user_id?: {
		open_id?: string;
		user_id?: string;
		union_id?: string;
	};
	action_time?: string;
}

export interface ResourceDescriptor {
	type: "image" | "file" | "audio" | "video" | "sticker";
	fileKey: string;
	fileName?: string;
	duration?: number;
	coverImageKey?: string;
}

export interface MentionInfo {
	key: string;
	openId: string;
	name: string;
	isBot: boolean;
}

export interface RawMessage {
	message_id: string;
	root_id?: string;
	parent_id?: string;
	create_time?: string;
	update_time?: string;
	chat_id: string;
	thread_id?: string;
	chat_type: "p2p" | "group";
	message_type: string;
	content: string;
	mentions?: Array<{
		key: string;
		id: { open_id?: string; user_id?: string; union_id?: string };
		name: string;
		tenant_key?: string;
	}>;
	user_agent?: string;
}

export interface RawSender {
	sender_id: { open_id?: string; user_id?: string; union_id?: string };
	sender_type?: string;
	tenant_key?: string;
}

export interface MessageContext {
	chatId: string;
	messageId: string;
	senderId: string;
	senderName?: string;
	chatType: "p2p" | "group";
	content: string;
	contentType: string;
	resources: ResourceDescriptor[];
	mentions: MentionInfo[];
	rootId?: string;
	parentId?: string;
	threadId?: string;
	createTime?: number;
	rawMessage: RawMessage;
	rawSender: RawSender;
}

export interface LarkSendResult {
	messageId: string;
	chatId: string;
	warning?: string;
}
