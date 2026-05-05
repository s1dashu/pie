import { existsSync, mkdirSync } from "node:fs";
import { extname, join } from "node:path";
import chalk from "chalk";
import type { ChannelMessagePart } from "../common/channel-model.js";
import type { FeishuBotConfig } from "./config.js";
import { sanitizePathSegment } from "./messages.js";
import { LarkClient, type LarkMessageEvent } from "./platform/index.js";

const FEISHU_IMAGE_URL_PREFIX = "feishu://image/";
const FEISHU_FILE_URL_PREFIX = "feishu://file/";

function parseFeishuResourceUrl(url: string | undefined, prefix: string): string | undefined {
	if (!url?.startsWith(prefix)) {
		return undefined;
	}
	const key = url.slice(prefix.length).trim();
	return key ? decodeURIComponent(key) : undefined;
}

function extensionFromMimeType(mimeType: string | undefined): string | undefined {
	if (!mimeType) {
		return undefined;
	}
	const normalized = mimeType.toLowerCase().split(";")[0]?.trim();
	if (normalized === "image/jpeg" || normalized === "image/jpg") {
		return ".jpg";
	}
	if (normalized === "image/png") {
		return ".png";
	}
	if (normalized === "image/webp") {
		return ".webp";
	}
	if (normalized === "image/gif") {
		return ".gif";
	}
	return undefined;
}

async function writeFeishuDownload(
	config: FeishuBotConfig,
	type: "image" | "file",
	messageId: string,
	resourceKey: string,
	filePath: string,
): Promise<void> {
	if (existsSync(filePath)) {
		return;
	}
	const client = LarkClient.fromConfig(config.feishu).sdk as any;
	const response = await client.im.v1.messageResource.get({
		path: { message_id: messageId, file_key: resourceKey },
		params: { type },
	});
	await response.writeFile(filePath);
}

export async function resolveFeishuMessageAttachments(
	config: FeishuBotConfig,
	event: LarkMessageEvent,
	parts: ChannelMessagePart[],
): Promise<ChannelMessagePart[]> {
	const messageDir = join(
		config.homeDir,
		"runtime",
		"attachments",
		"feishu",
		sanitizePathSegment(event.message.message_id),
	);
	let didCreateDir = false;

	const resolved: ChannelMessagePart[] = [];
	for (let index = 0; index < parts.length; index += 1) {
		const part = parts[index]!;
		if (part.type === "image") {
			const imageKey = parseFeishuResourceUrl(part.url, FEISHU_IMAGE_URL_PREFIX);
			if (!imageKey) {
				resolved.push(part);
				continue;
			}
			const extension = extensionFromMimeType(part.mimeType) ?? ".png";
			const filePath = join(messageDir, `image-${index + 1}-${sanitizePathSegment(imageKey)}${extension}`);
			try {
				if (!didCreateDir) {
					mkdirSync(messageDir, { recursive: true });
					didCreateDir = true;
				}
				await writeFeishuDownload(config, "image", event.message.message_id, imageKey, filePath);
				resolved.push({ ...part, filePath });
			} catch (error) {
				console.warn(chalk.gray(`Feishu image download skipped: ${error instanceof Error ? error.message : String(error)}`));
				resolved.push(part);
			}
			continue;
		}
		if (part.type === "file") {
			const fileKey = parseFeishuResourceUrl(part.url, FEISHU_FILE_URL_PREFIX);
			if (!fileKey) {
				resolved.push(part);
				continue;
			}
			const safeName = sanitizePathSegment(part.name || fileKey);
			const extension = extname(safeName) || ".bin";
			const baseName = extension === safeName ? sanitizePathSegment(fileKey) : safeName.slice(0, -extension.length);
			const filePath = join(messageDir, `file-${index + 1}-${baseName}${extension}`);
			try {
				if (!didCreateDir) {
					mkdirSync(messageDir, { recursive: true });
					didCreateDir = true;
				}
				await writeFeishuDownload(config, "file", event.message.message_id, fileKey, filePath);
				resolved.push({ ...part, filePath });
			} catch (error) {
				console.warn(chalk.gray(`Feishu file download skipped: ${error instanceof Error ? error.message : String(error)}`));
				resolved.push(part);
			}
			continue;
		}
		resolved.push(part);
	}
	return resolved;
}
