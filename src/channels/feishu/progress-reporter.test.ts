import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FeishuMessageOutputMode } from "../../core/message-style.js";
import { LarkProgressReporter, type LarkProgressDeliveryDeps } from "./progress-reporter.js";
import type { LarkConfig, LarkMessageEvent, LarkSendResult } from "./platform/index.js";

function createEvent(): LarkMessageEvent {
	return {
		sender: {
			sender_id: {},
			sender_type: "user",
		},
		message: {
			message_id: "om_in",
			chat_id: "oc_chat",
			chat_type: "p2p",
			message_type: "text",
			content: "{}",
		},
	};
}

function createReporter(delivery: LarkProgressDeliveryDeps): LarkProgressReporter {
	return new LarkProgressReporter(
		createEvent(),
		{} as LarkConfig,
		false,
		"none",
		false,
		"bubble",
		delivery,
	);
}

function createDelivery(overrides: Partial<LarkProgressDeliveryDeps> = {}): LarkProgressDeliveryDeps {
	return {
		async sendPlainReply(): Promise<LarkSendResult> {
			return { messageId: "om_plain", chatId: "oc_chat" };
		},
		async sendStyledReply(): Promise<LarkSendResult> {
			return { messageId: "om_styled", chatId: "oc_chat" };
		},
		async updateStyledReply(): Promise<void> {},
		...overrides,
	};
}

describe("LarkProgressReporter", () => {
	it("falls back to plain final text when styled delivery fails", async () => {
		const calls: Array<{ kind: string; text: string; mode?: FeishuMessageOutputMode }> = [];
		const reporter = createReporter(createDelivery({
			async sendStyledReply(_config, _event, text, mode) {
				calls.push({ kind: "styled", text, mode });
				throw new Error("styled send failed");
			},
			async sendPlainReply(_config, _event, text) {
				calls.push({ kind: "plain", text });
				return { messageId: "om_fallback", chatId: "oc_chat" };
			},
		}));

		reporter.onSessionEvent({
			type: "text_finished",
			roundId: "round_1",
			turnId: "turn_1",
			textId: "text_1",
			text: "final answer",
		});
		await reporter.finish("final answer");

		assert.deepEqual(calls, [
			{ kind: "styled", text: "final answer", mode: "bubble" },
			{ kind: "plain", text: "final answer" },
		]);
	});

	it("sends final text when no streaming segment was delivered", async () => {
		const calls: string[] = [];
		const reporter = createReporter(createDelivery({
			async sendPlainReply(_config, _event, text) {
				calls.push(text);
				return { messageId: "om_fallback", chatId: "oc_chat" };
			},
		}));

		await reporter.finish("late final answer");

		assert.deepEqual(calls, ["late final answer"]);
	});

	it("propagates delivery failure when fallback also fails", async () => {
		const reporter = createReporter(createDelivery({
			async sendStyledReply() {
				throw new Error("styled send failed");
			},
			async sendPlainReply() {
				throw new Error("plain fallback failed");
			},
		}));

		reporter.onSessionEvent({
			type: "text_finished",
			roundId: "round_1",
			turnId: "turn_1",
			textId: "text_1",
			text: "final answer",
		});

		await assert.rejects(() => reporter.finish("final answer"), /plain fallback failed/);
	});

	it("does not treat delivered tool output as delivered assistant text", async () => {
		const calls: Array<{ kind: string; text: string }> = [];
		const reporter = new LarkProgressReporter(
			createEvent(),
			{} as LarkConfig,
			true,
			"none",
			false,
			"bubble",
			createDelivery({
				async sendStyledReply(_config, _event, text) {
					calls.push({ kind: "styled", text });
					return { messageId: "om_tool", chatId: "oc_chat" };
				},
				async sendPlainReply(_config, _event, text) {
					calls.push({ kind: "plain", text });
					return { messageId: "om_final", chatId: "oc_chat" };
				},
			}),
		);

		reporter.onSessionEvent({
			type: "tool_call_started",
			roundId: "round_1",
			turnId: "turn_1",
			toolCallId: "tool_1",
			name: "bash",
			args: { command: "pwd" },
		});
		await reporter.finish("final answer");

		assert.deepEqual(calls, [
			{ kind: "styled", text: "💻 pwd" },
			{ kind: "plain", text: "final answer" },
		]);
	});

	it("falls back when a later assistant delivery fails after an earlier assistant message succeeded", async () => {
		const calls: Array<{ kind: string; text: string }> = [];
		let styledCalls = 0;
		const reporter = createReporter(createDelivery({
			async sendStyledReply(_config, _event, text) {
				styledCalls += 1;
				calls.push({ kind: "styled", text });
				if (styledCalls > 1) {
					throw new Error("second styled send failed");
				}
				return { messageId: `om_styled_${styledCalls}`, chatId: "oc_chat" };
			},
			async sendPlainReply(_config, _event, text) {
				calls.push({ kind: "plain", text });
				return { messageId: "om_final", chatId: "oc_chat" };
			},
		}));

		reporter.onSessionEvent({
			type: "text_finished",
			roundId: "round_1",
			turnId: "turn_1",
			textId: "text_1",
			text: "partial answer",
		});
		await reporter.dispose();
		reporter.onSessionEvent({
			type: "text_finished",
			roundId: "round_1",
			turnId: "turn_1",
			textId: "text_2",
			text: "final answer",
		});

		await reporter.finish("final answer");

		assert.deepEqual(calls, [
			{ kind: "styled", text: "partial answer" },
			{ kind: "styled", text: "final answer" },
			{ kind: "plain", text: "final answer" },
		]);
	});
});
