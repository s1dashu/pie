import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConversationController } from "./conversation-controller.js";
import type { FeishuBotConfig } from "./config.js";
import type { LarkMessageEvent } from "./platform/index.js";
import type {
	AgentConversationSession,
	AgentConversationSessionPool,
	AgentRoundInputLike,
	AgentSessionCapabilities,
	AgentSessionEvent,
} from "../../agents/types.js";

const CAPABILITIES: AgentSessionCapabilities = {
	supportsSteering: true,
	supportsInterrupt: true,
	supportsStreamingEvents: true,
	supportsSessionPersistence: true,
	supportsToolEvents: true,
};

function createEvent(messageId: string): LarkMessageEvent {
	return {
		message: {
			message_id: messageId,
		},
	} as LarkMessageEvent;
}

describe("ConversationController", () => {
	it("processes rapid Feishu messages as independent FIFO turns", async () => {
		const prompts: string[] = [];
		const finishes: string[] = [];
		const disposed: string[] = [];
		const listeners = new Set<(event: AgentSessionEvent) => void>();
		const session: AgentConversationSession = {
			capabilities: CAPABILITIES,
			get isStreaming() {
				return false;
			},
			state: { messages: [] },
			async prompt(input: AgentRoundInputLike) {
				const text = typeof input === "string" ? input : input.text;
				prompts.push(text);
				await new Promise((resolve) => setTimeout(resolve, 10));
				session.state?.messages.push({ role: "assistant", content: `reply:${text}` });
			},
			async abort() {},
			async steer() {},
			subscribe(listener) {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		};
		const pool: AgentConversationSessionPool = {
			capabilities: CAPABILITIES,
			async getSession() {
				return session;
			},
		};
		const controller = new ConversationController({
			conversationKey: "oc_test",
			config: { verboseLogs: false } as FeishuBotConfig,
			sessionPool: pool,
			createReporter: (event) => ({
				async markReceived() {},
				onSessionEvent() {},
				async finish(finalText) {
					finishes.push(`${event.message.message_id}:${finalText}`);
				},
				async fail(errorMessage) {
					finishes.push(`${event.message.message_id}:ERROR:${errorMessage}`);
				},
				async dispose() {
					disposed.push(event.message.message_id);
				},
			}),
		});

		const results = await Promise.all([
			controller.submit(createEvent("msg-1"), "one"),
			controller.submit(createEvent("msg-2"), "two"),
			controller.submit(createEvent("msg-3"), "three"),
		]);

		assert.deepEqual(prompts, ["one", "two", "three"]);
		assert.deepEqual(finishes, ["msg-1:reply:one", "msg-2:reply:two", "msg-3:reply:three"]);
		assert.deepEqual(disposed, ["msg-1", "msg-2", "msg-3"]);
		assert.deepEqual(results, [
			{ assistantText: "reply:one", interrupted: false },
			{ assistantText: "reply:two", interrupted: false },
			{ assistantText: "reply:three", interrupted: false },
		]);
	});
});
