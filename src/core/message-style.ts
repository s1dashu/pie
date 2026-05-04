export type ToolCallImMaxLength = 60 | 100 | 200 | "none";
export type FeishuMessageOutputMode = "bubble" | "card";

export interface ImMessageStyleRules {
	outputToolCallsToIm: boolean;
	outputToolCallImMaxLength: ToolCallImMaxLength;
	outputThinkingToIm: boolean;
}

export interface FeishuMessageStyleRules extends ImMessageStyleRules {
	messageOutputMode: FeishuMessageOutputMode;
}

export const DEFAULT_IM_MESSAGE_STYLE: ImMessageStyleRules = {
	outputToolCallsToIm: true,
	outputToolCallImMaxLength: 60,
	outputThinkingToIm: false,
};

export const DEFAULT_FEISHU_MESSAGE_OUTPUT_MODE: FeishuMessageOutputMode = "bubble";

export function isToolCallImMaxLength(value: unknown): value is ToolCallImMaxLength {
	return value === 60 || value === 100 || value === 200 || value === "none";
}

export function isFeishuMessageOutputMode(value: unknown): value is FeishuMessageOutputMode {
	return value === "bubble" || value === "card";
}
