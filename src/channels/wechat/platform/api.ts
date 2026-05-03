import crypto from "node:crypto";
import type { GetUpdatesResp, SendMessageReq, SendMessageResp } from "./types.js";

export const DEFAULT_WECHAT_BASE_URL = "https://ilinkai.weixin.qq.com";
const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const DEFAULT_API_TIMEOUT_MS = 15_000;
const ILINK_APP_ID = "bot";
const ILINK_APP_CLIENT_VERSION = "65536";

export interface WechatApiOptions {
	baseUrl: string;
	token?: string;
	timeoutMs?: number;
	routeTag?: string;
}

export class WechatApiError extends Error {
	constructor(
		message: string,
		readonly ret?: number,
		readonly errcode?: number,
		readonly errmsg?: string,
		readonly responseBody?: string,
	) {
		super(message);
		this.name = "WechatApiError";
	}
}

function ensureTrailingSlash(url: string): string {
	return url.endsWith("/") ? url : `${url}/`;
}

function randomWechatUin(): string {
	const uint32 = crypto.randomBytes(4).readUInt32BE(0);
	return Buffer.from(String(uint32), "utf8").toString("base64");
}

function commonHeaders(routeTag?: string): Record<string, string> {
	return {
		"iLink-App-Id": ILINK_APP_ID,
		"iLink-App-ClientVersion": ILINK_APP_CLIENT_VERSION,
		...(routeTag ? { SKRouteTag: routeTag } : {}),
	};
}

function postHeaders(opts: { body: string; token?: string; routeTag?: string }): Record<string, string> {
	return {
		"Content-Type": "application/json",
		AuthorizationType: "ilink_bot_token",
		"Content-Length": String(Buffer.byteLength(opts.body, "utf8")),
		"X-WECHAT-UIN": randomWechatUin(),
		...commonHeaders(opts.routeTag),
		...(opts.token?.trim() ? { Authorization: `Bearer ${opts.token.trim()}` } : {}),
	};
}

async function apiGet(params: {
	baseUrl: string;
	endpoint: string;
	timeoutMs?: number;
	routeTag?: string;
	label: string;
}): Promise<string> {
	const url = new URL(params.endpoint, ensureTrailingSlash(params.baseUrl));
	const controller = params.timeoutMs ? new AbortController() : undefined;
	const timer =
		controller && params.timeoutMs ? setTimeout(() => controller.abort(), params.timeoutMs) : undefined;
	try {
		const response = await fetch(url, {
			method: "GET",
			headers: commonHeaders(params.routeTag),
			...(controller ? { signal: controller.signal } : {}),
		});
		const text = await response.text();
		if (!response.ok) {
			throw new Error(`${params.label} ${response.status}: ${text}`);
		}
		return text;
	} finally {
		if (timer) {
			clearTimeout(timer);
		}
	}
}

async function apiPost(params: WechatApiOptions & { endpoint: string; body: string; label: string }): Promise<string> {
	const url = new URL(params.endpoint, ensureTrailingSlash(params.baseUrl));
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? DEFAULT_API_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			method: "POST",
			headers: postHeaders({
				body: params.body,
				token: params.token,
				routeTag: params.routeTag,
			}),
			body: params.body,
			signal: controller.signal,
		});
		const text = await response.text();
		if (!response.ok) {
			throw new Error(`${params.label} ${response.status}: ${text}`);
		}
		return text;
	} finally {
		clearTimeout(timer);
	}
}

export async function getUpdates(
	params: WechatApiOptions & { getUpdatesBuf?: string },
): Promise<GetUpdatesResp> {
	const timeoutMs = params.timeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS;
	try {
		const text = await apiPost({
			...params,
			timeoutMs,
			endpoint: "ilink/bot/getupdates",
			label: "getUpdates",
			body: JSON.stringify({
				get_updates_buf: params.getUpdatesBuf ?? "",
				base_info: { channel_version: "pie" },
			}),
		});
		return JSON.parse(text) as GetUpdatesResp;
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			return { ret: 0, msgs: [], get_updates_buf: params.getUpdatesBuf };
		}
		throw error;
	}
}

export async function sendMessage(params: WechatApiOptions & { body: SendMessageReq }): Promise<void> {
	const text = await apiPost({
		...params,
		endpoint: "ilink/bot/sendmessage",
		label: "sendMessage",
		body: JSON.stringify({ ...params.body, base_info: { channel_version: "pie" } }),
	});
	const response = text.trim() ? (JSON.parse(text) as SendMessageResp) : {};
	const isApiError =
		(response.ret !== undefined && response.ret !== 0) ||
		(response.errcode !== undefined && response.errcode !== 0);
	if (isApiError) {
		throw new WechatApiError(
			`sendMessage failed: ret=${response.ret} errcode=${response.errcode} errmsg=${response.errmsg ?? ""} body=${text}`,
			response.ret,
			response.errcode,
			response.errmsg,
			text,
		);
	}
}

export async function fetchLoginQr(params: {
	baseUrl?: string;
	botType: string;
	routeTag?: string;
}): Promise<{ qrcode: string; qrcode_img_content: string }> {
	const text = await apiGet({
		baseUrl: params.baseUrl ?? DEFAULT_WECHAT_BASE_URL,
		endpoint: `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(params.botType)}`,
		routeTag: params.routeTag,
		label: "fetchLoginQr",
	});
	return JSON.parse(text) as { qrcode: string; qrcode_img_content: string };
}

export async function pollLoginQrStatus(params: {
	baseUrl?: string;
	qrcode: string;
	timeoutMs?: number;
	routeTag?: string;
}): Promise<{
	status: "wait" | "scaned" | "confirmed" | "expired" | "scaned_but_redirect";
	bot_token?: string;
	ilink_bot_id?: string;
	baseurl?: string;
	ilink_user_id?: string;
	redirect_host?: string;
}> {
	try {
		const text = await apiGet({
			baseUrl: params.baseUrl ?? DEFAULT_WECHAT_BASE_URL,
			endpoint: `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(params.qrcode)}`,
			timeoutMs: params.timeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS,
			routeTag: params.routeTag,
			label: "pollLoginQrStatus",
		});
		return JSON.parse(text) as Awaited<ReturnType<typeof pollLoginQrStatus>>;
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			return { status: "wait" };
		}
		return { status: "wait" };
	}
}
