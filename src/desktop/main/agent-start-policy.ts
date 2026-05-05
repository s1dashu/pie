import { cpus, freemem, loadavg, totalmem } from "node:os";

export interface AgentStartResourceSnapshot {
	cpuCount: number;
	loadAverage1m: number;
	freeMemoryBytes: number;
	totalMemoryBytes: number;
}

export interface AgentStartBudget {
	maxConcurrent: number;
	maxWeight: number;
}

export function readAgentStartResourceSnapshot(): AgentStartResourceSnapshot {
	return {
		cpuCount: Math.max(1, cpus().length),
		loadAverage1m: Math.max(0, cpus().length ? processLoadAverage1m() : 0),
		freeMemoryBytes: freemem(),
		totalMemoryBytes: totalmem(),
	};
}

function processLoadAverage1m(): number {
	const [loadAverage1m] = process.platform === "win32" ? [0] : loadavg();
	return Number.isFinite(loadAverage1m) ? loadAverage1m : 0;
}

export function getAgentStartWeight(harnessKind: string | undefined): number {
	switch (harnessKind) {
		case "openclaw":
			return 6;
		case "hermes":
			return 3;
		case "codex":
		case "claude-code":
		case "ousia":
			return 2;
		case "pi":
			return 1;
		default:
			return 2;
	}
}

export function getEstimatedStartupMemoryBytes(harnessKind: string | undefined): number {
	switch (harnessKind) {
		case "openclaw":
			return 768 * 1024 ** 2;
		case "hermes":
			return 256 * 1024 ** 2;
		case "codex":
		case "claude-code":
		case "ousia":
			return 384 * 1024 ** 2;
		case "pi":
			return 192 * 1024 ** 2;
		default:
			return 384 * 1024 ** 2;
	}
}

export function shouldDeferAutoStartForResources(
	harnessKind: string | undefined,
	snapshot: AgentStartResourceSnapshot,
): boolean {
	const kind = harnessKind?.trim();
	if (kind !== "openclaw" && kind !== "hermes") {
		return false;
	}
	const reserveBytes = kind === "openclaw" ? 768 * 1024 ** 2 : 512 * 1024 ** 2;
	return snapshot.freeMemoryBytes < getEstimatedStartupMemoryBytes(kind) + reserveBytes;
}

export function calculateAgentStartBudget(snapshot: AgentStartResourceSnapshot): AgentStartBudget {
	const freeGb = snapshot.freeMemoryBytes / 1024 ** 3;
	const loadRatio = snapshot.loadAverage1m / Math.max(1, snapshot.cpuCount);
	const memoryBudget =
		freeGb < 1 ? 2 :
		freeGb < 2 ? 4 :
		freeGb < 4 ? 6 :
		freeGb < 8 ? 8 :
		10;
	const cpuBudget =
		loadRatio > 0.85 ? 4 :
		loadRatio > 0.65 ? 6 :
		loadRatio > 0.45 ? 8 :
		10;
	const maxWeight = Math.max(2, Math.min(memoryBudget, cpuBudget));
	return {
		maxWeight,
		maxConcurrent: maxWeight >= 10 ? 5 : maxWeight >= 8 ? 4 : maxWeight >= 6 ? 3 : 2,
	};
}
