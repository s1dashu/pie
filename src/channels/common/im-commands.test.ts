import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentConversationSessionPool } from "../../agents/session-runtime.js";
import { handleImCommand, parseImCommand } from "./im-commands.js";

describe("IM slash commands", () => {
	it("parses /status without arguments", () => {
		assert.deepEqual(parseImCommand("/status"), { name: "status" });
		assert.deepEqual(parseImCommand("/clear"), { name: "clear" });
		assert.equal(parseImCommand("/status now"), undefined);
	});

	it("replies with context usage for /status", async () => {
		const replies: string[] = [];
		const pool: AgentConversationSessionPool = {
			capabilities: {
				supportsSteering: false,
				supportsInterrupt: true,
				supportsStreamingEvents: true,
				supportsSessionPersistence: true,
				supportsToolEvents: true,
			},
			async getSession() {
				throw new Error("getSession should not be called when getSessionStatus is available");
			},
			async getSessionStatus() {
				return {
					totalMessages: 12,
					contextUsage: {
						tokens: 32_000,
						contextWindow: 128_000,
						percent: 25,
					},
				};
			},
		};

		await handleImCommand({ name: "status" }, {
			conversationKey: "chat",
			sessionPool: pool,
			reply: async (text) => {
				replies.push(text);
			},
		});

		assert.deepEqual(replies, [
			[
				"当前会话状态：",
				"消息数：12",
				"Context：32,000 tokens / 128,000 tokens",
				"占用：25.0%",
			].join("\n"),
		]);
	});

	it("explains unknown context usage after compaction", async () => {
		const replies: string[] = [];
		const pool: AgentConversationSessionPool = {
			capabilities: {
				supportsSteering: false,
				supportsInterrupt: true,
				supportsStreamingEvents: true,
				supportsSessionPersistence: true,
				supportsToolEvents: true,
			},
			async getSession() {
				throw new Error("getSession should not be called when getSessionStatus is available");
			},
			async getSessionStatus() {
				return {
					totalMessages: 4,
					contextUsage: {
						tokens: null,
						contextWindow: 128_000,
						percent: null,
					},
				};
			},
		};

		await handleImCommand({ name: "status" }, {
			conversationKey: "chat",
			sessionPool: pool,
			reply: async (text) => {
				replies.push(text);
			},
		});

		assert.equal(replies[0]?.includes("占用：未知"), true);
	});

	it("resets the current session for /clear", async () => {
		const replies: string[] = [];
		const resetKeys: string[] = [];
		const pool: AgentConversationSessionPool = {
			capabilities: {
				supportsSteering: false,
				supportsInterrupt: true,
				supportsStreamingEvents: true,
				supportsSessionPersistence: true,
				supportsToolEvents: true,
			},
			async getSession() {
				throw new Error("getSession should not be called for /clear");
			},
			async resetSession(conversationKey) {
				resetKeys.push(conversationKey);
			},
		};

		await handleImCommand({ name: "clear" }, {
			conversationKey: "chat",
			sessionPool: pool,
			reply: async (text) => {
				replies.push(text);
			},
		});

		assert.deepEqual(resetKeys, ["chat"]);
		assert.deepEqual(replies, ["已清空当前会话历史。"]);
	});
});
