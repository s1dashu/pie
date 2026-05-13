import { readFile } from "node:fs/promises";
import type { PieChannelKind } from "../../runtime/types.js";
import type { AgentPromptInput } from "../../agents/types.js";

const IMAGE_ONLY_PROMPT = "Please respond to the attached image.";

export type ChannelMessagePart =
	| { type: "text"; text: string }
	| { type: "image"; url?: string; filePath?: string; mimeType?: string; altText?: string }
	| { type: "file"; url?: string; filePath?: string; name: string; mimeType?: string };

export interface ChannelTarget {
	channelId: string;
	threadId?: string;
	userId?: string;
	dingtalkSessionWebhook?: string;
	dingtalkSessionWebhookExpiredTime?: number;
}

export interface IncomingChannelMessage {
	id: string;
	channel: PieChannelKind;
	conversationKey: string;
	target: ChannelTarget;
	parts: ChannelMessagePart[];
	createdAtMs: number;
	isDirectMessage: boolean;
	isBotMentioned?: boolean;
	senderId?: string;
}

export interface TextChannelAdapter {
	readonly kind: PieChannelKind;
	start(handlers: { onMessage: (message: IncomingChannelMessage) => Promise<void> }): Promise<void>;
	stop(): Promise<void>;
	sendText(target: ChannelTarget, text: string): Promise<void>;
}

export function extractTextPart(parts: ChannelMessagePart[]): string | undefined {
	const text = parts
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text.trim())
		.filter(Boolean)
		.join("\n\n")
		.trim();
	return text || undefined;
}

function detectSupportedImageMimeType(buffer: Buffer, fallback: string | undefined): string | undefined {
	const normalizedFallback = fallback?.toLowerCase().split(";")[0]?.trim();
	if (normalizedFallback && ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(normalizedFallback)) {
		return normalizedFallback;
	}
	if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
		return "image/jpeg";
	}
	if (
		buffer.length >= 8 &&
		buffer[0] === 0x89 &&
		buffer[1] === 0x50 &&
		buffer[2] === 0x4e &&
		buffer[3] === 0x47 &&
		buffer[4] === 0x0d &&
		buffer[5] === 0x0a &&
		buffer[6] === 0x1a &&
		buffer[7] === 0x0a
	) {
		return "image/png";
	}
	if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
		return "image/webp";
	}
	if (buffer.length >= 6) {
		const signature = buffer.toString("ascii", 0, 6);
		if (signature === "GIF87a" || signature === "GIF89a") {
			return "image/gif";
		}
	}
	return undefined;
}

async function readImagePart(part: Extract<ChannelMessagePart, { type: "image" }>): Promise<Buffer | undefined> {
	if (part.filePath) {
		return readFile(part.filePath);
	}
	if (!part.url || !/^https?:\/\//i.test(part.url)) {
		return undefined;
	}
	const response = await fetch(part.url);
	if (!response.ok) {
		throw new Error(`image fetch failed status=${response.status}`);
	}
	return Buffer.from(await response.arrayBuffer());
}

export async function buildAgentPromptInputFromMessageParts(parts: ChannelMessagePart[]): Promise<AgentPromptInput> {
	const text = extractTextPart(parts) ?? "";
	const images: AgentPromptInput["images"] = [];
	for (const part of parts) {
		if (part.type !== "image") {
			continue;
		}
		try {
			const data = await readImagePart(part);
			if (!data?.length) {
				continue;
			}
			const mimeType = detectSupportedImageMimeType(data, part.mimeType);
			if (!mimeType) {
				continue;
			}
			images.push({ type: "image", data: data.toString("base64"), mimeType });
		} catch (error) {
			console.warn(`Image attachment skipped: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return images.length ? { text: text || IMAGE_ONLY_PROMPT, images } : { text };
}
