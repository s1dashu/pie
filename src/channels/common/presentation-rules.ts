import type { PieChannelKind } from "../../runtime/types.js";

export type PresentationSurface = "bubble" | "card";
export type MarkdownMode = "plain" | "chat-markdown" | "no-tables" | "card";

export interface PresentationRules {
	text: {
		naturalSplitAfterChars?: number;
		maxChars?: number;
		maxBytes?: number;
		sentenceEndChars: readonly string[];
	};
	toolCalls: {
		linesPerMessage: number;
	};
	markdown: {
		mode: MarkdownMode;
		allowTables: boolean;
	};
	thinking: {
		enabled: boolean;
		format: "quote" | "hidden";
	};
	promptHints: readonly string[];
}

const SENTENCE_END_CHARS = ["。", ".", "！", "!", "？", "?"] as const;

const defaultRules: PresentationRules = {
	text: {
		sentenceEndChars: SENTENCE_END_CHARS,
	},
	toolCalls: {
		linesPerMessage: 1,
	},
	markdown: {
		mode: "chat-markdown",
		allowTables: true,
	},
	thinking: {
		enabled: true,
		format: "quote",
	},
	promptHints: [],
};

const FEISHU_PROMPT_HINTS = [
	"Never use Markdown tables in Feishu replies; use bullet lists, numbered lists, or plain text instead.",
] as const;

export function formatPresentationPromptHints(rules: Pick<PresentationRules, "promptHints">): string | undefined {
	if (!rules.promptHints.length) {
		return undefined;
	}
	return [
		"## Channel response rules",
		...rules.promptHints.map((hint) => `- ${hint}`),
	].join("\n");
}

export function getPresentationRules(input: {
	channel: PieChannelKind;
	surface?: PresentationSurface;
}): PresentationRules {
	if (input.channel === "discord") {
		return {
			...defaultRules,
			text: {
				naturalSplitAfterChars: 1500,
				maxChars: 1900,
				sentenceEndChars: SENTENCE_END_CHARS,
			},
			toolCalls: {
				linesPerMessage: 5,
			},
			markdown: {
				mode: "chat-markdown",
				allowTables: false,
			},
		};
	}
	if (input.channel === "wechat") {
		return {
			...defaultRules,
			text: {
				naturalSplitAfterChars: 3000,
				maxBytes: 6000,
				sentenceEndChars: SENTENCE_END_CHARS,
			},
			toolCalls: {
				linesPerMessage: 10,
			},
			markdown: {
				mode: "plain",
				allowTables: false,
			},
		};
	}
	if (input.channel === "feishu" && input.surface === "card") {
		return {
			...defaultRules,
			markdown: {
				mode: "card",
				allowTables: false,
			},
			thinking: {
				enabled: false,
				format: "hidden",
			},
			promptHints: FEISHU_PROMPT_HINTS,
		};
	}
	if (input.channel === "feishu") {
		return {
			...defaultRules,
			markdown: {
				mode: "no-tables",
				allowTables: false,
			},
			promptHints: FEISHU_PROMPT_HINTS,
		};
	}
	return defaultRules;
}
