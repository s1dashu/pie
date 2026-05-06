import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { createAgentSessionPool } from "../agents/session-runtime.js";
import { getOwnerSessionBinding, loadConfigStore } from "../core/config-store.js";
import { ConversationController } from "../channels/feishu/conversation-controller.js";
import { loadConfig } from "../channels/feishu/config.js";
import type { LarkMessageEvent } from "../channels/feishu/platform/index.js";
import {
	env,
	liveUseCaseExpectedPattern,
	renderLiveUseCasePrompt,
} from "./live-use-case.js";

const LIVE = process.env.PIE_LIVE_FEISHU_LAB_TESTS === "1";
const TIMEOUT_MS = Number(process.env.PIE_LIVE_FEISHU_LAB_TIMEOUT_MS ?? "300000");
const BATCH_COUNT = Number(process.env.PIE_LIVE_FEISHU_LAB_BATCH_COUNT ?? "10");

function renderPrompt(index: number, token: string): string {
	return renderLiveUseCasePrompt({
		index,
		token,
		templateEnvName: "PIE_LIVE_FEISHU_LAB_PROMPT_TEMPLATE",
	});
}

function expectedPatternFor(token: string): RegExp {
	return liveUseCaseExpectedPattern({
		token,
		regexEnvName: "PIE_LIVE_FEISHU_LAB_EXPECTED_REGEX",
	});
}

function resolveLabChat(): { chatId?: string; conversationKey?: string; openId?: string } {
	const chatId = env("PIE_LIVE_FEISHU_LAB_CHAT_ID");
	if (chatId && !chatId.startsWith("synthetic-")) {
		return {
			chatId,
			conversationKey: env("PIE_LIVE_FEISHU_LAB_CONVERSATION_KEY") ?? chatId,
			openId: env("PIE_LIVE_FEISHU_LAB_OPEN_ID"),
		};
	}
	const owner = getOwnerSessionBinding(loadConfigStore());
	if (owner?.chatId?.startsWith("synthetic-")) {
		return {};
	}
	return {
		chatId: owner?.chatId,
		conversationKey: owner?.sessionKey ?? owner?.chatId,
		openId: owner?.openId,
	};
}

function createSyntheticLabEvent(input: {
	chatId: string;
	conversationKey: string;
	openId?: string;
	index: number;
	token: string;
}): LarkMessageEvent {
	const now = Date.now();
	const text = renderPrompt(input.index, input.token);
	return {
		sender: {
			sender_id: {
				open_id: input.openId ?? "ou_pie_feishu_lab",
			},
			sender_type: "system",
		},
		message: {
			message_id: `feishu-lab:${input.index}:${now}:${randomUUID()}`,
			create_time: String(now),
			chat_id: input.chatId,
			chat_type: "p2p",
			message_type: "text",
			content: JSON.stringify({
				text,
			}),
			user_agent: "ousia-task-engine",
		},
	};
}

describe("live Feishu Lab", { skip: !LIVE }, () => {
	it(`sends ${BATCH_COUNT} real Feishu replies for ${BATCH_COUNT} rapid turns`, { timeout: TIMEOUT_MS }, async (t) => {
		const config = loadConfig(["--home", env("PIE_AGENT_HOME") ?? ""]);
		const lab = resolveLabChat();
		if (!lab.chatId || !lab.conversationKey) {
			t.skip("PIE_LIVE_FEISHU_LAB_CHAT_ID or profile ownerSession.chatId is required");
			return;
		}

		const sessionPool = createAgentSessionPool({
			harnessKind: config.harnessKind,
			harnessConfig: config.harnessConfig,
			homeDir: config.homeDir,
			model: config.model,
			modelId: config.modelId,
			assistantSystemPrompt: config.assistantSystemPrompt,
			thinkingLevel: config.thinkingLevel,
			tools: [],
			debug: config.debug,
			verboseLogs: config.verboseLogs,
			resumeSessions: false,
		});
		const controller = new ConversationController({
			conversationKey: `feishu-lab:${lab.conversationKey}:${Date.now()}`,
			config: {
				...config,
				outputToolCallsToIm: false,
				outputThinkingToIm: false,
				messageOutputMode: "bubble",
			},
			sessionPool,
		});

		const runId = randomUUID().slice(0, 8);
		const tokens = Array.from({ length: BATCH_COUNT }, (_, index) => `PIE_FEISHU_LAB_${runId}_${index + 1}`);
		const results = await Promise.all(tokens.map((token, index) =>
			controller.submit(
				createSyntheticLabEvent({
					chatId: lab.chatId!,
					conversationKey: lab.conversationKey!,
					openId: lab.openId,
					index: index + 1,
					token,
				}),
				renderPrompt(index + 1, token),
			),
		));

		assert.equal(results.length, BATCH_COUNT);
		for (const [index, result] of results.entries()) {
			assert.equal(result.interrupted, false, `turn ${index + 1} was interrupted`);
			assert.match(result.assistantText, expectedPatternFor(tokens[index]!), `turn ${index + 1} did not match expected reply`);
		}
		setTimeout(() => process.exit(0), 50);
	});
});
