import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PieChannelKind } from "../runtime/types.js";
import type { ChannelTarget, IncomingChannelMessage, TextChannelAdapter } from "../channels/common/channel-model.js";
import { loadCommonChannelConfig } from "../channels/common/config.js";
import { TextChannelRuntime } from "../channels/common/text-channel-runtime.js";
import {
	env,
	liveUseCaseExpectedPattern,
	renderLiveUseCasePrompt,
} from "./live-use-case.js";

const LIVE = process.env.PIE_LIVE_IM_RUNTIME_TESTS === "1";
const TIMEOUT_MS = Number(process.env.PIE_LIVE_IM_RUNTIME_TIMEOUT_MS ?? "120000");
const EXPECTED_PATTERN = liveUseCaseExpectedPattern({
	token: "",
	regexEnvName: "PIE_LIVE_IM_EXPECTED_REGEX",
});

function requireChannelKind(): PieChannelKind {
	const value = env("PIE_LIVE_CHANNEL_KIND");
	if (value === "feishu" || value === "wechat" || value === "slack" || value === "discord" || value === "telegram") {
		return value;
	}
	throw new Error("PIE_LIVE_CHANNEL_KIND must be one of feishu, wechat, slack, discord, telegram.");
}

function envPrefixForChannel(channel: PieChannelKind): string {
	return channel.toUpperCase();
}

class SyntheticTextChannelAdapter implements TextChannelAdapter {
	readonly sent: Array<{ target: ChannelTarget; text: string }> = [];
	private onMessage?: (message: IncomingChannelMessage) => Promise<void>;

	constructor(readonly kind: PieChannelKind) {}

	async start(handlers: { onMessage: (message: IncomingChannelMessage) => Promise<void> }): Promise<void> {
		this.onMessage = handlers.onMessage;
	}

	async stop(): Promise<void> {}

	async sendText(target: ChannelTarget, text: string): Promise<void> {
		this.sent.push({ target, text });
	}

	async receive(message: IncomingChannelMessage): Promise<void> {
		if (!this.onMessage) {
			throw new Error("Synthetic adapter has not been started.");
		}
		await this.onMessage(message);
	}
}

function createMessage(channel: PieChannelKind): IncomingChannelMessage {
	const profileId = env("PIE_LIVE_PROFILE_ID") ?? "profile";
	const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
	const prompt = renderLiveUseCasePrompt({
		index: 1,
		token: "PIE_L2_OK",
		templateEnvName: "PIE_LIVE_IM_PROMPT_TEMPLATE",
	});
	return {
		id: `synthetic:${profileId}:${nonce}`,
		channel,
		conversationKey: `synthetic:${profileId}:${channel}`,
		target: { channelId: `synthetic-${channel}`, userId: "synthetic-user" },
		parts: [
			{
				type: "text",
				text: prompt,
			},
		],
		createdAtMs: Date.now(),
		isDirectMessage: true,
		senderId: "synthetic-user",
	};
}

describe("live IM runtime with real harness", { skip: !LIVE }, () => {
	it("handles a synthetic inbound IM message and sends the real harness reply", { timeout: TIMEOUT_MS }, async () => {
		const channel = requireChannelKind();
		const adapter = new SyntheticTextChannelAdapter(channel);
		const config = loadCommonChannelConfig({
			channelKind: channel,
			envPrefix: envPrefixForChannel(channel),
			argv: ["--home", env("PIE_AGENT_HOME") ?? ""],
		});
		const runtime = new TextChannelRuntime(
			{
				...config,
				outputToolCallsToIm: false,
				outputThinkingToIm: false,
			},
			adapter,
		);

		await runtime.start();
		try {
			await adapter.receive(createMessage(channel));
		} finally {
			await runtime.stop();
		}

		const reply = adapter.sent.map((entry) => entry.text).join("\n");
		assert.match(reply, EXPECTED_PATTERN, `reply did not match expected pattern ${EXPECTED_PATTERN}: ${reply}`);
		setTimeout(() => process.exit(0), 50);
	});
});
