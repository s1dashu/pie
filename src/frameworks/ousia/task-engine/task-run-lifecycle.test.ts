import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentTaskSpec } from "./agent-task-types.js";
import {
	finalizeAgentTaskRun,
	finalizeExecTaskRun,
	finishAgentTaskRun,
	finishExecTaskRun,
	startAgentTaskRun,
	startExecTaskRun,
} from "./task-run-lifecycle.js";
import { createEmptyCounters, type LoadedAgentTask, type LoadedExecTask } from "./runtime-types.js";
import type { ExecTaskSpec } from "./task-types.js";

describe("task-run-lifecycle", () => {
	it("records a successful exec task run", () => {
		const entry = createExecTask();
		const run = startExecTaskRun(entry, "2026-05-06T00:00:00.000Z");

		assert.equal(entry.state.running, true);
		assert.equal(entry.state.currentRun?.status, "running");

		finishExecTaskRun(entry.state, run, { status: "success", exitCode: 0, timedOut: false, error: null });
		finalizeExecTaskRun(entry.state);

		assert.equal(entry.state.running, false);
		assert.equal(entry.state.currentRun, undefined);
		assert.equal(entry.state.lastCompletedScheduledFor, "2026-05-06T00:00:00.000Z");
		assert.equal(entry.state.lastRun?.status, "success");
		assert.equal(entry.state.counters.runCount, 1);
		assert.equal(entry.state.counters.successCount, 1);
		assert.equal(entry.state.lastError, null);
	});

	it("increments attempt for the same scheduled exec run", () => {
		const entry = createExecTask();
		const first = startExecTaskRun(entry, "2026-05-06T00:00:00.000Z");
		finishExecTaskRun(entry.state, first, { status: "failed", exitCode: 1, timedOut: false, error: "failed" });
		finalizeExecTaskRun(entry.state);

		const second = startExecTaskRun(entry, "2026-05-06T00:00:00.000Z");

		assert.equal(second.attempt, 2);
		assert.match(second.runId, /attempt-2$/);
	});

	it("records and finalizes a successful agent task delivery", () => {
		const entry = createAgentTask();
		const run = startAgentTaskRun(entry, "2026-05-06T01:00:00.000Z");
		finishAgentTaskRun(entry.state, run);
		finalizeAgentTaskRun(entry.state);

		assert.equal(entry.state.delivering, false);
		assert.equal(entry.state.currentRun, undefined);
		assert.equal(entry.state.deliveryCount, 1);
		assert.equal(entry.state.lastCompletedScheduledFor, "2026-05-06T01:00:00.000Z");
		assert.equal(entry.state.lastRun?.status, "success");
		assert.equal(entry.state.counters.runCount, 1);
		assert.equal(entry.state.counters.successCount, 1);
	});
});

function createExecTask(): LoadedExecTask {
	const spec: ExecTaskSpec = {
		version: 1,
		id: "exec-1",
		trigger: { type: "interval", everySec: 60 },
		run: { type: "exec", command: "echo ok" },
		sink: { type: "append_jsonl", path: "runs.jsonl" },
	};
	return {
		spec,
		filePath: "/tmp/exec-1/task.json",
		mtimeMs: 0,
		state: {
			running: false,
			counters: createEmptyCounters(),
		},
	};
}

function createAgentTask(): LoadedAgentTask {
	const spec: AgentTaskSpec = {
		version: 1,
		id: "agent-1",
		trigger: { type: "interval", everySec: 60 },
		prompt: "Do the thing.",
	};
	return {
		spec,
		filePath: "/tmp/agent-1/task.json",
		mtimeMs: 0,
		state: {
			delivering: false,
			deliveryCount: 0,
			counters: createEmptyCounters(),
		},
	};
}
