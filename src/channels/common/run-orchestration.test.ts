import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentRunInput, AgentRunOutput } from "../../runtime/types.js";
import { formatAgentTaskPrompt, isSilentAgentTask, ScheduledRunQueue } from "./run-orchestration.js";

function request(sessionKey: string, id: string): AgentRunInput {
	return {
		kind: "agent_task",
		sessionKey,
		prompt: id,
		metadata: {},
	};
}

function output(sessionKey: string, assistantText: string): AgentRunOutput {
	return { sessionKey, assistantText };
}

async function nextTick(): Promise<void> {
	await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("run orchestration", () => {
	it("formats scheduled task prompts without double-prefixing", () => {
		assert.equal(formatAgentTaskPrompt("Summarize logs"), "Task: Summarize logs");
		assert.equal(formatAgentTaskPrompt("Task: Summarize logs"), "Task: Summarize logs");
		assert.throws(() => formatAgentTaskPrompt("   "), /Task prompt is empty/);
	});

	it("detects silent agent tasks by delivery mode", () => {
		assert.equal(isSilentAgentTask({ ...request("owner", "a"), metadata: { deliveryMode: "silent" } }), true);
		assert.equal(isSilentAgentTask({ ...request("owner", "a"), metadata: { deliveryMode: "im" } }), false);
		assert.equal(isSilentAgentTask({ kind: "agent_run", sessionKey: "owner", prompt: "hello" }), false);
	});

	it("serializes runs for the same queue key and allows different keys to overlap", async () => {
		const queue = new ScheduledRunQueue();
		const events: string[] = [];
		const gates = new Map<string, () => void>();
		const runAgent = async (input: AgentRunInput): Promise<AgentRunOutput> => {
			events.push(`start:${input.prompt}`);
			await new Promise<void>((resolve) => gates.set(input.prompt, resolve));
			events.push(`finish:${input.prompt}`);
			return output(input.sessionKey, `done:${input.prompt}`);
		};

		const first = queue.enqueue(request("same", "first"), runAgent, (input) => input.sessionKey);
		const second = queue.enqueue(request("same", "second"), runAgent, (input) => input.sessionKey);
		const other = queue.enqueue(request("other", "other"), runAgent, (input) => input.sessionKey);
		await nextTick();

		assert.deepEqual(events, ["start:first", "start:other"]);
		gates.get("other")?.();
		assert.equal((await other).assistantText, "done:other");
		assert.deepEqual(events, ["start:first", "start:other", "finish:other"]);

		gates.get("first")?.();
		assert.equal((await first).assistantText, "done:first");
		await nextTick();
		assert.deepEqual(events, ["start:first", "start:other", "finish:other", "finish:first", "start:second"]);

		gates.get("second")?.();
		assert.equal((await second).assistantText, "done:second");
	});

	it("continues queued work after a previous run fails", async () => {
		const queue = new ScheduledRunQueue();
		let attempts = 0;

		const first = queue.enqueue(request("same", "first"), async () => {
			attempts += 1;
			throw new Error("boom");
		});
		await assert.rejects(first, /boom/);

		const second = await queue.enqueue(request("same", "second"), async () => {
			attempts += 1;
			return output("same", "ok");
		});

		assert.equal(second.assistantText, "ok");
		assert.equal(attempts, 2);
	});
});
