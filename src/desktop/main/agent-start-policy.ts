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

interface AgentStartCost {
	weight: number;
	estimatedStartupMemoryBytes: number;
	autoStartReserveBytes?: number;
}

const MIB = 1024 ** 2;

const DEFAULT_AGENT_START_COST: AgentStartCost = {
	weight: 2,
	estimatedStartupMemoryBytes: 384 * MIB,
};

const AGENT_START_COSTS: Record<string, AgentStartCost> = {
	openclaw: {
		weight: 6,
		estimatedStartupMemoryBytes: 768 * MIB,
		autoStartReserveBytes: 768 * MIB,
	},
	hermes: {
		weight: 3,
		estimatedStartupMemoryBytes: 256 * MIB,
		autoStartReserveBytes: 512 * MIB,
	},
	codex: {
		weight: 2,
		estimatedStartupMemoryBytes: 384 * MIB,
	},
	"claude-code": {
		weight: 2,
		estimatedStartupMemoryBytes: 384 * MIB,
	},
	ousia: {
		weight: 2,
		estimatedStartupMemoryBytes: 384 * MIB,
	},
	pi: {
		weight: 1,
		estimatedStartupMemoryBytes: 192 * MIB,
	},
};

function getAgentStartCost(harnessKind: string | undefined): AgentStartCost {
	return AGENT_START_COSTS[harnessKind?.trim() ?? ""] ?? DEFAULT_AGENT_START_COST;
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
	return getAgentStartCost(harnessKind).weight;
}

export function getEstimatedStartupMemoryBytes(harnessKind: string | undefined): number {
	return getAgentStartCost(harnessKind).estimatedStartupMemoryBytes;
}

export function shouldDeferAutoStartForResources(
	harnessKind: string | undefined,
	snapshot: AgentStartResourceSnapshot,
): boolean {
	const cost = getAgentStartCost(harnessKind);
	if (!cost.autoStartReserveBytes) {
		return false;
	}
	return snapshot.freeMemoryBytes < cost.estimatedStartupMemoryBytes + cost.autoStartReserveBytes;
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
