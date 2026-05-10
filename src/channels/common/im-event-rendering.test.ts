import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentSessionEvent } from "../../agents/types.js";
import { AssistantTextPresentationBuffer, formatThinkingForIm, ThinkingPresentationBuffer } from "./im-event-rendering.js";

function thinkingDelta(delta: string): AgentSessionEvent {
	return { type: "thinking_delta", runId: "round", turnId: "turn", thinkingId: "thinking", delta };
}

function thinkingFinished(thinking: string): AgentSessionEvent {
	return { type: "thinking_finished", runId: "round", turnId: "turn", thinkingId: "thinking", thinking };
}

function textStart(): AgentSessionEvent {
	return { type: "text_start", runId: "round", turnId: "turn", textId: "text" };
}

function textDelta(delta: string): AgentSessionEvent {
	return { type: "text_delta", runId: "round", turnId: "turn", textId: "text", delta };
}

function textFinished(text: string): AgentSessionEvent {
	return { type: "text_finished", runId: "round", turnId: "turn", textId: "text", text };
}

function turnFinished(): AgentSessionEvent {
	return { type: "turn_finished", runId: "round", turnId: "turn", status: "success" };
}

describe("IM event rendering", () => {
	it("formats thinking as quoted IM text", () => {
		assert.equal(formatThinkingForIm(" first\nsecond "), "> first\n> second");
	});

	it("flushes thinking deltas incrementally and replaces with final thinking when provided", () => {
		const buffer = new ThinkingPresentationBuffer();

		buffer.ingest(thinkingDelta("plan"));
		assert.equal(buffer.takeNextFormatted(), "> plan");
		assert.equal(buffer.takeNextFormatted(), undefined);

		buffer.ingest(thinkingDelta("\nnext"));
		assert.equal(buffer.takeNextFormatted(), "> next");

		buffer.ingest(thinkingFinished("final thinking"));
		assert.equal(buffer.takeNextFormatted(), "> final thinking");
	});

	it("emits assistant text on text_finished and turn_finished fallback", () => {
		const buffer = new AssistantTextPresentationBuffer();

		assert.equal(buffer.ingest(textStart()), undefined);
		assert.equal(buffer.ingest(textDelta("hello ")), undefined);
		assert.equal(buffer.ingest(textDelta("world")), undefined);
		assert.equal(buffer.ingest(textFinished("")), "hello world");
		assert.equal(buffer.take(), undefined);

		buffer.ingest(textStart());
		buffer.ingest(textDelta("partial"));
		assert.equal(buffer.ingest(turnFinished()), "partial");
	});

	it("prefers non-empty final text over accumulated deltas", () => {
		const buffer = new AssistantTextPresentationBuffer();

		buffer.ingest(textStart());
		buffer.ingest(textDelta("draft"));

		assert.equal(buffer.ingest(textFinished("final")), "final");
	});
});
