import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AgentEventNormalizer } from "./event-normalizer.js";
import type { AgentConversationSession, AgentSessionEvent } from "./types.js";

class FakeSession implements AgentConversationSession {
	readonly capabilities = {
		supportsSteering: false,
		supportsInterrupt: false,
		supportsStreamingEvents: true,
		supportsSessionPersistence: false,
		supportsToolEvents: true,
	};
	readonly state = { messages: [] };
	readonly isStreaming = false;

	async prompt(): Promise<void> {}
	async abort(): Promise<void> {}
	subscribe(): () => void {
		return () => undefined;
	}
}

describe("AgentEventNormalizer", () => {
	it("scopes text ids by run and turn for legacy message update events", () => {
		const normalizer = new AgentEventNormalizer(new FakeSession());

		const firstEvents = [
			...normalizer.normalize({ type: "agent_start" } as never),
			...normalizer.normalize({ type: "turn_start" } as never),
			...normalizer.normalize({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hello" } } as never),
			...normalizer.normalize({ type: "turn_end" } as never),
			...normalizer.normalize({ type: "agent_end" } as never),
		];
		const secondEvents = [
			...normalizer.normalize({ type: "agent_start" } as never),
			...normalizer.normalize({ type: "turn_start" } as never),
			...normalizer.normalize({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "again" } } as never),
		];

		const firstText = firstEvents.find((event): event is Extract<AgentSessionEvent, { type: "text_delta" }> => event.type === "text_delta");
		const secondText = secondEvents.find((event): event is Extract<AgentSessionEvent, { type: "text_delta" }> => event.type === "text_delta");
		assert(firstText);
		assert(secondText);
		assert.notEqual(firstText.textId, secondText.textId);
		assert.equal(firstText.textId, "run_1:turn_1:text_0");
		assert.equal(secondText.textId, "run_2:turn_1:text_0");
	});

	it("splits implicit text blocks around tool calls", () => {
		const normalizer = new AgentEventNormalizer(new FakeSession());
		const events = [
			...normalizer.normalize({ type: "agent_start" } as never),
			...normalizer.normalize({ type: "turn_start" } as never),
			...normalizer.normalize({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "before" } } as never),
			...normalizer.normalize({ type: "tool_execution_start", toolCallId: "tool_a", toolName: "web_search", args: { query: "x" } } as never),
			...normalizer.normalize({ type: "tool_execution_end", toolCallId: "tool_a", toolName: "web_search", result: "done" } as never),
			...normalizer.normalize({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "after" } } as never),
			...normalizer.normalize({ type: "turn_end" } as never),
		];

		assert.deepEqual(events.map((event) => event.type), [
			"agent_run_started",
			"turn_started",
			"text_delta",
			"text_finished",
			"tool_call_started",
			"tool_call_finished",
			"text_delta",
			"text_finished",
			"turn_finished",
		]);
		const textDeltas = events.filter((event): event is Extract<AgentSessionEvent, { type: "text_delta" }> => event.type === "text_delta");
		assert.equal(textDeltas[0]?.textId, "run_1:turn_1:text_0");
		assert.equal(textDeltas[1]?.textId, "run_1:turn_1:text_1");
	});
});
