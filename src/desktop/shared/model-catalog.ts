import type { DesktopModelOption } from "./types.js";

export const HERMES_MODEL_OPTIONS: DesktopModelOption[] = [
	{
		id: "kimi-k2.6",
		name: "kimi-k2.6",
		provider: "kimi-coding",
	},
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
	return [...new Set(models.map((model) => model.provider))].sort((left, right) => left.localeCompare(right));
}
