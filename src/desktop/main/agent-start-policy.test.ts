import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	calculateAgentStartBudget,
	getAgentStartWeight,
	getEstimatedStartupMemoryBytes,
	shouldDeferAutoStartForResources,
	type AgentStartResourceSnapshot,
} from "./agent-start-policy.js";

const MIB = 1024 ** 2;
const GIB = 1024 ** 3;

function snapshot(overrides: Partial<AgentStartResourceSnapshot>): AgentStartResourceSnapshot {
	return {
		cpuCount: 8,
		loadAverage1m: 1,
		freeMemoryBytes: 8 * GIB,
		totalMemoryBytes: 16 * GIB,
		...overrides,
	};
}

describe("agent start policy", () => {
	it("keeps heavyweight harness costs above lightweight Pi", () => {
		assert.equal(getAgentStartWeight("pi"), 1);
		assert.equal(getAgentStartWeight("hermes"), 3);
		assert.equal(getAgentStartWeight("openclaw"), 6);
		assert.equal(getEstimatedStartupMemoryBytes("pi"), 192 * MIB);
		assert.equal(getEstimatedStartupMemoryBytes("openclaw"), 768 * MIB);
	});

	it("falls back to the default cost for unknown harnesses", () => {
		assert.equal(getAgentStartWeight("future-harness"), 2);
		assert.equal(getEstimatedStartupMemoryBytes(undefined), 384 * MIB);
	});

	it("calculates conservative budgets from memory and load", () => {
		assert.deepEqual(calculateAgentStartBudget(snapshot({ freeMemoryBytes: 900 * MIB })), {
			maxWeight: 2,
			maxConcurrent: 2,
		});
		assert.deepEqual(calculateAgentStartBudget(snapshot({ freeMemoryBytes: 3 * GIB, loadAverage1m: 6 })), {
			maxWeight: 6,
			maxConcurrent: 3,
		});
		assert.deepEqual(calculateAgentStartBudget(snapshot({ freeMemoryBytes: 16 * GIB, loadAverage1m: 1 })), {
			maxWeight: 10,
			maxConcurrent: 5,
		});
	});

	it("defers auto-start only for harnesses with explicit reserve requirements", () => {
		assert.equal(shouldDeferAutoStartForResources("pi", snapshot({ freeMemoryBytes: 1 })), false);
		assert.equal(shouldDeferAutoStartForResources("openclaw", snapshot({ freeMemoryBytes: 1535 * MIB })), true);
		assert.equal(shouldDeferAutoStartForResources("openclaw", snapshot({ freeMemoryBytes: 1536 * MIB })), false);
		assert.equal(shouldDeferAutoStartForResources("hermes", snapshot({ freeMemoryBytes: 767 * MIB })), true);
		assert.equal(shouldDeferAutoStartForResources("hermes", snapshot({ freeMemoryBytes: 768 * MIB })), false);
	});
});
