import { createDecipheriv } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import type { ChannelMessagePart } from "../common/channel-model.js";
import type { WechatBotConfig } from "./config.js";
import { sanitizePathSegment } from "../feishu/messages.js";
import { getWechatMessageId } from "./messages.js";
import { MessageItemType, type CdnMedia, type WechatMessage } from "./platform/types.js";

const DEFAULT_WECHAT_CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";

function parseAesKey(value: string): Buffer {
	const trimmed = value.trim();
	if (/^[0-9a-fA-F]{32}$/.test(trimmed)) {
		return Buffer.from(trimmed, "hex");
	}
	const decoded = Buffer.from(trimmed, "base64");
	if (decoded.length === 16) {
		return decoded;
	}
	const decodedText = decoded.toString("ascii");
	if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decodedText)) {
		return Buffer.from(decodedText, "hex");
	}
	throw new Error(`invalid Wechat media aes key length=${decoded.length}`);
}

function decryptAes128Ecb(ciphertext: Buffer, key: Buffer): Buffer {
	const decipher = createDecipheriv("aes-128-ecb", key, null);
	return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function buildCdnDownloadUrl(media: CdnMedia): string | undefined {
	const param = media.encrypt_query_param?.trim();
	if (!param) {
		return undefined;
	}
	const url = new URL("download", `${DEFAULT_WECHAT_CDN_BASE_URL.replace(/\/+$/, "")}/`);
	url.searchParams.set("encrypted_query_param", param);
	return url.toString();
}

async function downloadWechatCdnMedia(media: CdnMedia, aesKey: string | undefined): Promise<Buffer | undefined> {
	const url = buildCdnDownloadUrl(media);
	if (!url) {
		return undefined;
	}
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Wechat CDN download failed status=${response.status}`);
	}
	const data = Buffer.from(await response.arrayBuffer());
	return aesKey ? decryptAes128Ecb(data, parseAesKey(aesKey)) : data;
}

function imageExtension(mimeType: string | undefined): string {
	const normalized = mimeType?.toLowerCase().split(";")[0]?.trim();
	if (normalized === "image/jpeg" || normalized === "image/jpg") {
		return ".jpg";
	}
	if (normalized === "image/webp") {
		return ".webp";
	}
	if (normalized === "image/gif") {
		return ".gif";
	}
	return ".png";
}

function getWechatImageDownloads(message: WechatMessage): Array<{ index: number; media: CdnMedia; aesKey?: string }> {
	const downloads: Array<{ index: number; media: CdnMedia; aesKey?: string }> = [];
	for (let index = 0; index < (message.item_list ?? []).length; index += 1) {
		const item = message.item_list![index]!;
		if (item.type !== MessageItemType.IMAGE || !item.image_item?.media?.encrypt_query_param) {
			continue;
		}
		downloads.push({
			index,
			media: item.image_item.media,
			aesKey: item.image_item.aeskey || item.image_item.media.aes_key,
		});
	}
	return downloads;
}

export async function resolveWechatMessageAttachments(
	config: WechatBotConfig,
	message: WechatMessage,
	parts: ChannelMessagePart[],
): Promise<ChannelMessagePart[]> {
	const downloads = getWechatImageDownloads(message);
	if (!downloads.length) {
		return parts;
	}
	const messageDir = join(
		config.homeDir,
		"runtime",
		"attachments",
		"wechat",
		sanitizePathSegment(getWechatMessageId(message)),
	);
	const resolved = [...parts];
	for (const download of downloads) {
		const partIndex = resolved.findIndex(
			(part, index) => index >= download.index && part.type === "image" && !part.filePath,
		);
		if (partIndex < 0) {
			continue;
		}
		const part = resolved[partIndex] as Extract<ChannelMessagePart, { type: "image" }>;
		if (part.url && /^https?:\/\//i.test(part.url)) {
			continue;
		}
		const filePath = join(messageDir, `image-${download.index + 1}${imageExtension(part.mimeType)}`);
		try {
			mkdirSync(messageDir, { recursive: true });
			if (!existsSync(filePath)) {
				const data = await downloadWechatCdnMedia(download.media, download.aesKey);
				if (!data?.length) {
					continue;
				}
				writeFileSync(filePath, data);
			}
			resolved[partIndex] = { ...part, filePath };
		} catch (error) {
			console.warn(chalk.gray(`Wechat image download skipped: ${error instanceof Error ? error.message : String(error)}`));
		}
	}
	return resolved;
}
