import type { AgentHarnessKind } from "./config-store.js";

const SESSION_PERSISTENT_HARNESSES = new Set<AgentHarnessKind>(["hermes", "openclaw"]);

export function getDefaultResumeSessionsForHarness(harnessKind: AgentHarnessKind | string | undefined): boolean {
	return SESSION_PERSISTENT_HARNESSES.has(harnessKind as AgentHarnessKind);
}
