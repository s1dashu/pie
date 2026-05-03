import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Durable Ousia workspace layout under `PIE_AGENT_HOME`. */
export const OUSIA_AGENT_HOME_SUBDIRS = ["tasks", "projects", "runtime", "docs"] as const;
export type OusiaWorkspaceSubdir = (typeof OUSIA_AGENT_HOME_SUBDIRS)[number];

const OUSIA_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), ".");
const OUSIA_DOCS = ["task-engine.md", "task-engine-observability.md"] as const;

export function ensureOusiaAgentHomeLayout(homeDir: string): void {
	for (const name of OUSIA_AGENT_HOME_SUBDIRS) {
		mkdirSync(join(homeDir, name), { recursive: true });
	}
	ensureOusiaRuntimeDocs(homeDir);
}

function ensureOusiaRuntimeDocs(homeDir: string): void {
	const targetDir = join(homeDir, "docs");
	mkdirSync(targetDir, { recursive: true });
	for (const name of OUSIA_DOCS) {
		const sourcePath = firstExistingPath([
			join(OUSIA_ROOT, "docs", name),
			join(process.cwd(), "src", "frameworks", "ousia", "docs", name),
		]);
		const targetPath = join(targetDir, name);
		const body = readUtf8IfExists(sourcePath);
		if (!body.trim()) {
			continue;
		}
		writeFileSync(targetPath, body, "utf8");
	}
}

function firstExistingPath(paths: string[]): string {
	return paths.find((path) => existsSync(path)) ?? paths[0]!;
}

function readUtf8IfExists(filePath: string): string {
	try {
		if (!existsSync(filePath)) {
			return "";
		}
		return readFileSync(filePath, "utf8");
	} catch {
		return "";
	}
}
