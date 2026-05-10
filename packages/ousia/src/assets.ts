import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OUSIA_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), ".");

function firstExistingPath(paths: string[]): string {
	return paths.find((path) => existsSync(path)) ?? paths[0]!;
}

export function getOusiaRootDir(): string {
	return OUSIA_ROOT;
}

export function getOusiaPromptDir(): string {
	return firstExistingPath([
		join(OUSIA_ROOT, "prompts"),
		join(OUSIA_ROOT, "..", "src", "prompts"),
		join(process.cwd(), "src", "prompts"),
		join(process.cwd(), "packages", "ousia", "src", "prompts"),
	]);
}

export function getOusiaDocsDir(): string {
	return firstExistingPath([
		join(OUSIA_ROOT, "docs"),
		join(OUSIA_ROOT, "..", "src", "docs"),
		join(process.cwd(), "src", "docs"),
		join(process.cwd(), "packages", "ousia", "src", "docs"),
	]);
}

export function getOusiaSystemPromptFile(): string {
	return join(getOusiaPromptDir(), "system-prompt.md");
}

export const OUSIA_ASSET_DIRS = [
	{ name: "prompts", resolve: getOusiaPromptDir },
	{ name: "docs", resolve: getOusiaDocsDir },
] as const;
