import type { DesktopModelOption } from "./types.js";

const PRIMARY_PROVIDER_IDS = [
	"openai",
	"anthropic",
	"google",
	"kimi-coding",
	"zai",
	"minimax",
	"deepseek",
];

export const HERMES_MODEL_OPTIONS: DesktopModelOption[] = [
	{
		id: "kimi-k2.6",
		name: "kimi-k2.6",
		provider: "kimi-coding",
	},
];

export const OPENCLAW_429_MODEL_OPTIONS: DesktopModelOption[] = [
	{ provider: "kimi-coding", id: "k2p6", name: "Kimi K2.6" },
	{ provider: "kimi-coding", id: "kimi-for-coding", name: "Kimi For Coding" },
	{ provider: "kimi-coding", id: "kimi-k2-thinking", name: "Kimi K2 Thinking" },
	{ provider: "google", id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" },
	{ provider: "google", id: "gemini-3.1-flash-lite-preview", name: "Gemini 3.1 Flash Lite Preview" },
	{ provider: "google", id: "gemini-3-pro-preview", name: "Gemini 3 Pro Preview" },
	{ provider: "google", id: "gemini-3-flash-preview", name: "Gemini 3 Flash Preview" },
	{ provider: "google", id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
	{ provider: "google", id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
	{ provider: "google", id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite" },
	{ provider: "openai", id: "gpt-5.5", name: "GPT-5.5" },
	{ provider: "openai", id: "gpt-5.5-pro", name: "GPT-5.5 Pro" },
	{ provider: "openai", id: "gpt-5.4", name: "GPT-5.4" },
	{ provider: "openai", id: "gpt-5.4-mini", name: "GPT-5.4 mini" },
	{ provider: "openai", id: "gpt-5.4-nano", name: "GPT-5.4 nano" },
	{ provider: "openai", id: "gpt-5.4-pro", name: "GPT-5.4 Pro" },
	{ provider: "openai", id: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
	{ provider: "openai", id: "gpt-5.3-chat-latest", name: "GPT-5.3 Chat (latest)" },
	{ provider: "openai", id: "gpt-5.2", name: "GPT-5.2" },
	{ provider: "openai", id: "gpt-5.2-chat-latest", name: "GPT-5.2 Chat" },
	{ provider: "openai", id: "gpt-5.2-codex", name: "GPT-5.2 Codex" },
	{ provider: "openai", id: "gpt-5.2-pro", name: "GPT-5.2 Pro" },
	{ provider: "openai", id: "gpt-5.1", name: "GPT-5.1" },
	{ provider: "openai", id: "gpt-5.1-chat-latest", name: "GPT-5.1 Chat" },
	{ provider: "openai", id: "gpt-5.1-codex", name: "GPT-5.1 Codex" },
	{ provider: "openai", id: "gpt-5.1-codex-max", name: "GPT-5.1 Codex Max" },
	{ provider: "openai", id: "gpt-5.1-codex-mini", name: "GPT-5.1 Codex mini" },
	{ provider: "openai", id: "gpt-5", name: "GPT-5" },
	{ provider: "openai", id: "gpt-5-chat-latest", name: "GPT-5 Chat Latest" },
	{ provider: "openai", id: "gpt-5-mini", name: "GPT-5 Mini" },
	{ provider: "openai", id: "gpt-5-nano", name: "GPT-5 Nano" },
	{ provider: "openai", id: "gpt-5-pro", name: "GPT-5 Pro" },
	{ provider: "openai", id: "gpt-5-codex", name: "GPT-5-Codex" },
	{ provider: "anthropic", id: "claude-opus-4-7", name: "Claude Opus 4.7" },
	{ provider: "anthropic", id: "claude-opus-4-6", name: "Claude Opus 4.6" },
	{ provider: "anthropic", id: "claude-opus-4-5", name: "Claude Opus 4.5 (latest)" },
	{ provider: "anthropic", id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
	{ provider: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5 (latest)" },
	{ provider: "anthropic", id: "claude-haiku-4-5", name: "Claude Haiku 4.5 (latest)" },
	{ provider: "zai", id: "glm-5.1", name: "GLM-5.1" },
	{ provider: "zai", id: "glm-5-turbo", name: "GLM-5-Turbo" },
	{ provider: "zai", id: "glm-5v-turbo", name: "glm-5v-turbo" },
	{ provider: "zai", id: "glm-4.7", name: "GLM-4.7" },
	{ provider: "zai", id: "glm-4.5-air", name: "GLM-4.5-Air" },
	{ provider: "minimax", id: "MiniMax-M2.7", name: "MiniMax-M2.7" },
	{ provider: "minimax", id: "MiniMax-M2.7-highspeed", name: "MiniMax-M2.7-highspeed" },
];

export function mergeModelOptions(base: DesktopModelOption[], extra: DesktopModelOption[]): DesktopModelOption[] {
	const seen = new Set<string>();
	const merged: DesktopModelOption[] = [];
	for (const item of [...extra, ...base]) {
		const key = `${item.provider}\u0000${item.id}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		merged.push(item);
	}
	return merged;
}

export function providersFromModels(models: DesktopModelOption[]): string[] {
	const providers = [...new Set(models.map((model) => model.provider).filter(Boolean))];
	const primary = PRIMARY_PROVIDER_IDS.filter((provider) => providers.includes(provider));
	const secondary = providers
		.filter((provider) => !primary.includes(provider))
		.sort((left, right) => left.localeCompare(right));
	return [...primary, ...secondary];
}
