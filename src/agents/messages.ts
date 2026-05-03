import type { AgentConversationSession } from "./types.js";

function formatUserText(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	return content
		.flatMap((part) => {
			if (!part || typeof part !== "object") {
				return [];
			}
			const typedPart = part as { type?: unknown; text?: unknown };
			return typedPart.type === "text" && typeof typedPart.text === "string" ? [typedPart.text] : [];
		})
		.join("");
}

function readLastAssistantMessage(session: AgentConversationSession): unknown | undefined {
	const messages = session.state?.messages;
	if (!messages) {
		return undefined;
	}
	return [...messages].reverse().find((message) => (message as { role?: string }).role === "assistant");
}

export function extractAssistantText(session: AgentConversationSession): string {
	const message = readLastAssistantMessage(session);
	if (!message || typeof message !== "object") {
		return "";
	}
	return formatUserText((message as { content?: unknown }).content).trim();
}

export function extractLastAssistantError(session: AgentConversationSession): string | undefined {
	const message = readLastAssistantMessage(session);
	if (!message || typeof message !== "object") {
		return undefined;
	}
	const typedMessage = message as { stopReason?: string; errorMessage?: unknown };
	if (typedMessage.stopReason !== "error") {
		return undefined;
	}
	return typeof typedMessage.errorMessage === "string" && typedMessage.errorMessage.trim()
		? typedMessage.errorMessage.trim()
		: "Model provider returned an error without details.";
}

export function wasLastAssistantMessageAborted(session: AgentConversationSession): boolean {
	const message = readLastAssistantMessage(session);
	return Boolean(message && typeof message === "object" && (message as { stopReason?: string }).stopReason === "aborted");
}

export function formatTranscriptPrompt(previousMessages: unknown[], currentPrompt: string): string {
	if (!previousMessages.length) {
		return currentPrompt;
	}
	const transcript = previousMessages
		.flatMap((message) => {
			if (!message || typeof message !== "object") {
				return [];
			}
			const role = (message as { role?: unknown }).role;
			if (role !== "user" && role !== "assistant") {
				return [];
			}
			const content = formatUserText((message as { content?: unknown }).content).trim();
			return content ? [`${role === "user" ? "User" : "Assistant"}: ${content}`] : [];
		})
		.join("\n\n");
	if (!transcript) {
		return currentPrompt;
	}
	return [
		"You are continuing an IM conversation. Use the transcript for context, then answer the latest user message.",
		"",
		"Transcript:",
		transcript,
		"",
		"Latest user message:",
		currentPrompt,
	].join("\n");
}
