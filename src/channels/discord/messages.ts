import type { IncomingChannelMessage } from "../common/channel-model.js";

export function stripDiscordMention(text: string, botId: string | undefined, botRoleIds: string[] = []): string {
	if (!botId) {
		return text.trim();
	}
	let stripped = text.replace(new RegExp(`<@!?${botId}>`, "g"), "");
	for (const roleId of botRoleIds) {
		stripped = stripped.replace(new RegExp(`<@&${roleId}>`, "g"), "");
	}
	return stripped.trim();
}

function isImageAttachment(name: string | null | undefined, contentType: string | null | undefined): boolean {
	if (contentType?.toLowerCase().startsWith("image/")) {
		return true;
	}
	return /\.(?:png|jpe?g|webp|gif)$/i.test(name ?? "");
}

export function buildDiscordMessageParts(params: {
	content: string;
	botId?: string;
	botRoleIds?: string[];
	attachments: Array<{
		name: string;
		url: string;
		contentType?: string | null;
	}>;
}): IncomingChannelMessage["parts"] {
	const text = stripDiscordMention(params.content, params.botId, params.botRoleIds ?? []);
	const parts: IncomingChannelMessage["parts"] = text ? [{ type: "text", text }] : [];
	for (const attachment of params.attachments) {
		if (isImageAttachment(attachment.name, attachment.contentType ?? null)) {
			parts.push({ type: "image", url: attachment.url, mimeType: attachment.contentType ?? undefined, altText: attachment.name });
		} else {
			parts.push({
				type: "file",
				url: attachment.url,
				name: attachment.name,
				mimeType: attachment.contentType ?? undefined,
			});
		}
	}
	return parts;
}
