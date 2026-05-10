import type { DesktopModelOption } from "./types.js";
import { OPENCLAW_BUILT_IN_MODEL_OPTIONS } from "../../core/openclaw-model-catalog.js";

export const DEFAULT_MODEL_PROVIDER = "openai";
export const DEFAULT_OPENAI_MODEL_ID = "gpt-5.5";

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

export const OPENCLAW_429_MODEL_OPTIONS: DesktopModelOption[] = OPENCLAW_BUILT_IN_MODEL_OPTIONS.map((model) => ({
	provider: model.provider,
	id: model.id,
	name: model.name,
	modelRef: model.modelRef,
}));

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

export function defaultProviderFromModels(models: DesktopModelOption[]): string {
	const providers = providersFromModels(models);
	return providers.includes(DEFAULT_MODEL_PROVIDER) ? DEFAULT_MODEL_PROVIDER : providers[0] ?? DEFAULT_MODEL_PROVIDER;
}

export function defaultModelForProvider(models: DesktopModelOption[], provider: string): string {
	const providerModels = models.filter((model) => model.provider === provider);
	const preferred = provider === DEFAULT_MODEL_PROVIDER
		? providerModels.find((model) => model.id === DEFAULT_OPENAI_MODEL_ID)
		: undefined;
	return preferred?.id ?? providerModels[0]?.id ?? "";
}
