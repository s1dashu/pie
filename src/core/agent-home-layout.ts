import { mkdirSync } from "node:fs";
import { join } from "node:path";

/** Minimal durable home layout under `PIE_AGENT_HOME`. */
export const AGENT_HOME_SUBDIRS = ["runtime"] as const;
export type AgentWorkspaceSubdir = (typeof AGENT_HOME_SUBDIRS)[number];

/** Ensures the durable agent-home dirs exist under `homeDir`. */
export function ensureAgentHomeLayout(homeDir: string): void {
	for (const name of AGENT_HOME_SUBDIRS) {
		mkdirSync(join(homeDir, name), { recursive: true });
	}
}
