import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Minimal durable home layout under `PIE_AGENT_HOME`. */
export const AGENT_HOME_SUBDIRS = ["tasks", "projects", "runtime", "docs"] as const;
export type AgentWorkspaceSubdir = (typeof AGENT_HOME_SUBDIRS)[number];

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RUNTIME_DOCS = ["task-engine.md", "task-engine-observability.md"] as const;

/** Ensures the durable agent-home dirs exist under `homeDir`. */
export function ensureAgentHomeLayout(homeDir: string): void {
	for (const name of AGENT_HOME_SUBDIRS) {
		mkdirSync(join(homeDir, name), { recursive: true });
	}
	ensureRuntimeDocs(homeDir);
}

function ensureRuntimeDocs(homeDir: string): void {
	const targetDir = join(homeDir, "docs");
	mkdirSync(targetDir, { recursive: true });
	for (const name of RUNTIME_DOCS) {
		const sourcePath = join(REPO_ROOT, "docs", name);
		const targetPath = join(targetDir, name);
		const body = readUtf8IfExists(sourcePath);
		if (!body.trim()) {
			continue;
		}
		writeFileSync(targetPath, body, "utf8");
	}
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
