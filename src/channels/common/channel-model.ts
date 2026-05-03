import type { PieChannelKind } from "../../runtime/types.js";

export type ChannelMessagePart =
	| { type: "text"; text: string }
	| { type: "image"; url?: string; filePath?: string; mimeType?: string; altText?: string }
	| { type: "file"; url?: string; filePath?: string; name: string; mimeType?: string };

export interface ChannelTarget {
	channelId: string;
	threadId?: string;
	userId?: string;
}

export interface IncomingChannelMessage {
	id: string;
	channel: PieChannelKind;
	conversationKey: string;
	target: ChannelTarget;
	parts: ChannelMessagePart[];
	createdAtMs: number;
	isDirectMessage: boolean;
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
