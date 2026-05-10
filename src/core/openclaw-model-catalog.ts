export interface OpenClawBuiltInModelOption {
	provider: string;
	id: string;
	name: string;
	modelRef: string;
	reasoning?: boolean;
	contextWindow?: number;
	maxTokens?: number;
	input?: string[];
}

export const OPENCLAW_BUILT_IN_MODEL_OPTIONS: OpenClawBuiltInModelOption[] = [
	{ provider: "kimi-coding", id: "k2p6", name: "Kimi K2.6", modelRef: "kimi-coding/k2p6", reasoning: true, contextWindow: 262144, maxTokens: 32768, input: ["text", "image"] },
	{ provider: "kimi-coding", id: "kimi-for-coding", name: "Kimi For Coding", modelRef: "kimi-coding/kimi-for-coding", reasoning: true, contextWindow: 262144, maxTokens: 32768, input: ["text", "image"] },
	{ provider: "kimi-coding", id: "kimi-k2-thinking", name: "Kimi K2 Thinking", modelRef: "kimi-coding/kimi-k2-thinking", reasoning: true, contextWindow: 262144, maxTokens: 32768, input: ["text", "image"] },
	{ provider: "google", id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview", modelRef: "google/gemini-3.1-pro-preview" },
	{ provider: "google", id: "gemini-3.1-flash-lite-preview", name: "Gemini 3.1 Flash Lite Preview", modelRef: "google/gemini-3.1-flash-lite-preview" },
	{ provider: "google", id: "gemini-3-pro-preview", name: "Gemini 3 Pro Preview", modelRef: "google/gemini-3-pro-preview" },
	{ provider: "google", id: "gemini-3-flash-preview", name: "Gemini 3 Flash Preview", modelRef: "google/gemini-3-flash-preview" },
	{ provider: "google", id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", modelRef: "google/gemini-2.5-pro" },
	{ provider: "google", id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", modelRef: "google/gemini-2.5-flash" },
	{ provider: "google", id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite", modelRef: "google/gemini-2.5-flash-lite" },
	{ provider: "openai", id: "gpt-5.5", name: "GPT-5.5", modelRef: "openai/gpt-5.5" },
	{ provider: "openai", id: "gpt-5.5-pro", name: "GPT-5.5 Pro", modelRef: "openai/gpt-5.5-pro" },
	{ provider: "openai", id: "gpt-5.4", name: "GPT-5.4", modelRef: "openai/gpt-5.4" },
	{ provider: "openai", id: "gpt-5.4-mini", name: "GPT-5.4 mini", modelRef: "openai/gpt-5.4-mini" },
	{ provider: "openai", id: "gpt-5.4-nano", name: "GPT-5.4 nano", modelRef: "openai/gpt-5.4-nano" },
	{ provider: "openai", id: "gpt-5.4-pro", name: "GPT-5.4 Pro", modelRef: "openai/gpt-5.4-pro" },
	{ provider: "openai", id: "gpt-5.3-codex", name: "GPT-5.3 Codex", modelRef: "openai/gpt-5.3-codex" },
	{ provider: "openai", id: "gpt-5.3-chat-latest", name: "GPT-5.3 Chat (latest)", modelRef: "openai/gpt-5.3-chat-latest" },
	{ provider: "openai", id: "gpt-5.2", name: "GPT-5.2", modelRef: "openai/gpt-5.2" },
	{ provider: "openai", id: "gpt-5.2-chat-latest", name: "GPT-5.2 Chat", modelRef: "openai/gpt-5.2-chat-latest" },
	{ provider: "openai", id: "gpt-5.2-codex", name: "GPT-5.2 Codex", modelRef: "openai/gpt-5.2-codex" },
	{ provider: "openai", id: "gpt-5.2-pro", name: "GPT-5.2 Pro", modelRef: "openai/gpt-5.2-pro" },
	{ provider: "openai", id: "gpt-5.1", name: "GPT-5.1", modelRef: "openai/gpt-5.1" },
	{ provider: "openai", id: "gpt-5.1-chat-latest", name: "GPT-5.1 Chat", modelRef: "openai/gpt-5.1-chat-latest" },
	{ provider: "openai", id: "gpt-5.1-codex", name: "GPT-5.1 Codex", modelRef: "openai/gpt-5.1-codex" },
	{ provider: "openai", id: "gpt-5.1-codex-max", name: "GPT-5.1 Codex Max", modelRef: "openai/gpt-5.1-codex-max" },
	{ provider: "openai", id: "gpt-5.1-codex-mini", name: "GPT-5.1 Codex mini", modelRef: "openai/gpt-5.1-codex-mini" },
	{ provider: "openai", id: "gpt-5", name: "GPT-5", modelRef: "openai/gpt-5" },
	{ provider: "openai", id: "gpt-5-chat-latest", name: "GPT-5 Chat Latest", modelRef: "openai/gpt-5-chat-latest" },
	{ provider: "openai", id: "gpt-5-mini", name: "GPT-5 Mini", modelRef: "openai/gpt-5-mini" },
	{ provider: "openai", id: "gpt-5-nano", name: "GPT-5 Nano", modelRef: "openai/gpt-5-nano" },
	{ provider: "openai", id: "gpt-5-pro", name: "GPT-5 Pro", modelRef: "openai/gpt-5-pro" },
	{ provider: "openai", id: "gpt-5-codex", name: "GPT-5-Codex", modelRef: "openai/gpt-5-codex" },
	{ provider: "anthropic", id: "claude-opus-4-7", name: "Claude Opus 4.7", modelRef: "anthropic/claude-opus-4-7" },
	{ provider: "anthropic", id: "claude-opus-4-6", name: "Claude Opus 4.6", modelRef: "anthropic/claude-opus-4-6" },
	{ provider: "anthropic", id: "claude-opus-4-5", name: "Claude Opus 4.5 (latest)", modelRef: "anthropic/claude-opus-4-5" },
	{ provider: "anthropic", id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", modelRef: "anthropic/claude-sonnet-4-6" },
	{ provider: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5 (latest)", modelRef: "anthropic/claude-sonnet-4-5" },
	{ provider: "anthropic", id: "claude-haiku-4-5", name: "Claude Haiku 4.5 (latest)", modelRef: "anthropic/claude-haiku-4-5" },
	{ provider: "zai", id: "glm-5.1", name: "GLM-5.1", modelRef: "zai/glm-5.1" },
	{ provider: "zai", id: "glm-5-turbo", name: "GLM-5-Turbo", modelRef: "zai/glm-5-turbo" },
	{ provider: "zai", id: "glm-5v-turbo", name: "glm-5v-turbo", modelRef: "zai/glm-5v-turbo" },
	{ provider: "zai", id: "glm-4.7", name: "GLM-4.7", modelRef: "zai/glm-4.7" },
	{ provider: "zai", id: "glm-4.5-air", name: "GLM-4.5-Air", modelRef: "zai/glm-4.5-air" },
	{ provider: "deepseek", id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", modelRef: "deepseek/deepseek-v4-pro" },
	{ provider: "deepseek", id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", modelRef: "deepseek/deepseek-v4-flash" },
	{ provider: "minimax", id: "MiniMax-M2.7", name: "MiniMax-M2.7", modelRef: "minimax/MiniMax-M2.7" },
	{ provider: "minimax", id: "MiniMax-M2.7-highspeed", name: "MiniMax-M2.7-highspeed", modelRef: "minimax/MiniMax-M2.7-highspeed" },
];

export const OPENCLAW_LEGACY_MODEL_REF_ALIASES: Record<string, string> = {
	"kimi/k2p6": "kimi-coding/k2p6",
	"kimi/kimi-for-coding": "kimi-coding/kimi-for-coding",
	"kimi/kimi-k2-thinking": "kimi-coding/kimi-k2-thinking",
};

export function findOpenClawBuiltInModel(provider: string | undefined, model: string | undefined): OpenClawBuiltInModelOption | undefined {
	const cleanProvider = provider?.trim();
	const cleanModel = model?.trim();
	if (!cleanProvider || !cleanModel) {
		return undefined;
	}
	return OPENCLAW_BUILT_IN_MODEL_OPTIONS.find((item) => item.provider === cleanProvider && item.id === cleanModel);
}

export function findOpenClawBuiltInModelByRef(modelRef: string | undefined): OpenClawBuiltInModelOption | undefined {
	const cleanRef = modelRef?.trim();
	if (!cleanRef) {
		return undefined;
	}
	return OPENCLAW_BUILT_IN_MODEL_OPTIONS.find((item) => item.modelRef === cleanRef);
}

export function findOpenClawBuiltInModelByBareId(modelId: string | undefined): OpenClawBuiltInModelOption | undefined {
	const cleanId = modelId?.trim();
	if (!cleanId) {
		return undefined;
	}
	const matches = OPENCLAW_BUILT_IN_MODEL_OPTIONS.filter((item) => item.id === cleanId);
	return matches.length === 1 ? matches[0] : undefined;
}
