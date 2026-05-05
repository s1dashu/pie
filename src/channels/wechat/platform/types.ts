export interface BaseInfo {
	channel_version?: string;
}

export const MessageType = {
	USER: 1,
	BOT: 2,
} as const;

export const MessageItemType = {
	TEXT: 1,
	IMAGE: 2,
	VOICE: 3,
	FILE: 4,
	VIDEO: 5,
} as const;

export const MessageState = {
	FINISH: 2,
} as const;

export interface TextItem {
	text?: string;
}

export interface VoiceItem {
	text?: string;
}

export interface CdnMedia {
	encrypt_query_param?: string;
	aes_key?: string;
	encrypt_type?: number;
}

export interface ImageItem {
	media?: CdnMedia;
	thumb_media?: CdnMedia;
	aeskey?: string;
	url?: string;
	image_url?: string;
	file_url?: string;
	file_id?: string;
	file_key?: string;
	media_id?: string;
	mime_type?: string;
}

export interface FileItem {
	media?: CdnMedia;
	url?: string;
	file_url?: string;
	file_id?: string;
	file_key?: string;
	media_id?: string;
	file_name?: string;
	name?: string;
	mime_type?: string;
}

export interface RefMessage {
	message_item?: MessageItem;
	title?: string;
}

export interface MessageItem {
	type?: number;
	text_item?: TextItem;
	image_item?: ImageItem;
	file_item?: FileItem;
	voice_item?: VoiceItem;
	ref_msg?: RefMessage;
}

export interface WechatMessage {
	seq?: number;
	message_id?: number;
	from_user_id?: string;
	to_user_id?: string;
	client_id?: string;
	create_time_ms?: number;
	session_id?: string;
	message_type?: number;
	message_state?: number;
	item_list?: MessageItem[];
	context_token?: string;
}

export interface GetUpdatesResp {
	ret?: number;
	errcode?: number;
	errmsg?: string;
	msgs?: WechatMessage[];
	get_updates_buf?: string;
	longpolling_timeout_ms?: number;
}

export interface SendMessageReq {
	msg?: WechatMessage;
}

export interface SendMessageResp {
	ret?: number;
	errcode?: number;
	errmsg?: string;
}
