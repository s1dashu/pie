import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client, GatewayIntentBits, Partials } from "discord.js";
import { describe, it } from "node:test";
import type { ChannelTarget, IncomingChannelMessage, TextChannelAdapter } from "../channels/common/channel-model.js";
import { TextChannelRuntime } from "../channels/common/text-channel-runtime.js";
import { loadConfig } from "../channels/discord/config.js";
import { getOwnerSessionBinding, loadConfigStore } from "../core/config-store.js";
import {
	env,
	liveUseCaseExpectedPattern,
	renderLiveUseCasePrompt,
} from "./live-use-case.js";

const LIVE = process.env.PIE_LIVE_DISCORD_LAB_TESTS === "1";
const TIMEOUT_MS = Number(process.env.PIE_LIVE_DISCORD_LAB_TIMEOUT_MS ?? "300000");
const BATCH_COUNT = Number(process.env.PIE_LIVE_DISCORD_LAB_BATCH_COUNT ?? "10");

function readRecentDiscordConversationFromEvents(homeDir: string): { channelId?: string; conversationKey?: string } {
	const eventsPath = join(homeDir, "runtime", "agent-events.jsonl");
	if (!existsSync(eventsPath)) {
		return {};
	}
	const lines = readFileSync(eventsPath, "utf8").trimEnd().split("\n");
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const line = lines[index];
		if (!line) {
			continue;
		}
		const match = /"conversationKey":"discord:([^":]+):([^"]+)"/.exec(line);
		if (!match) {
			continue;
		}
		const channelId = match[1];
		const tail = match[2];
		if (!channelId?.startsWith("synthetic-") && tail) {
			return {
				channelId,
				conversationKey: `discord:${channelId}:lab-${Date.now()}`,
			};
		}
	}
	return {};
}

function resolveLabChannel(homeDir: string): { channelId?: string; conversationKey?: string; userId?: string } {
	const channelId = env("PIE_LIVE_DISCORD_LAB_CHANNEL_ID");
	if (channelId && !channelId.startsWith("synthetic-")) {
		return {
			channelId,
			conversationKey: env("PIE_LIVE_DISCORD_LAB_CONVERSATION_KEY") ?? `discord-lab:${channelId}`,
			userId: env("PIE_LIVE_DISCORD_LAB_USER_ID") ?? "discord-lab-user",
		};
	}
	const owner = getOwnerSessionBinding(loadConfigStore());
	if (owner?.chatId?.startsWith("synthetic-")) {
		return {
			...readRecentDiscordConversationFromEvents(homeDir),
			userId: env("PIE_LIVE_DISCORD_LAB_USER_ID") ?? "discord-lab-user",
		};
	}
	return {
		channelId: owner?.chatId,
		conversationKey: owner?.sessionKey ?? (owner?.chatId ? `discord-lab:${owner.chatId}` : undefined),
		userId: owner?.openId ?? "discord-lab-user",
	};
}

function renderPrompt(index: number, token: string): string {
	return renderLiveUseCasePrompt({
		index,
		token,
		templateEnvName: "PIE_LIVE_DISCORD_LAB_PROMPT_TEMPLATE",
	});
}

function expectedPatternFor(token: string): RegExp {
	return liveUseCaseExpectedPattern({
		token,
		regexEnvName: "PIE_LIVE_DISCORD_LAB_EXPECTED_REGEX",
	});
}

class LiveDiscordLabAdapter implements TextChannelAdapter {
	readonly kind = "discord" as const;
	private readonly client: Client;
	private onMessage?: (message: IncomingChannelMessage) => Promise<void>;

	constructor(private readonly token: string) {
		this.client = new Client({
			intents: [
				GatewayIntentBits.DirectMessages,
				GatewayIntentBits.GuildMessages,
				GatewayIntentBits.Guilds,
				GatewayIntentBits.MessageContent,
			],
			partials: [Partials.Channel],
			allowedMentions: { parse: [] },
		});
	}

	async start(handlers: { onMessage: (message: IncomingChannelMessage) => Promise<void> }): Promise<void> {
		this.onMessage = handlers.onMessage;
		await this.client.login(this.token);
	}

	async stop(): Promise<void> {
		this.client.destroy();
	}

	async sendText(target: ChannelTarget, text: string): Promise<void> {
		const channel = await this.client.channels.fetch(target.channelId);
		if (!channel || !("send" in channel) || typeof channel.send !== "function") {
			throw new Error(`Discord channel is not sendable: ${target.channelId}`);
		}
		await channel.send({
			content: text,
			reply: target.threadId ? { messageReference: target.threadId } : undefined,
		});
	}

	async receive(message: IncomingChannelMessage): Promise<void> {
		if (!this.onMessage) {
			throw new Error("Discord lab adapter has not started.");
		}
		await this.onMessage(message);
	}
}

function createSyntheticMessage(input: {
	channelId: string;
	conversationKey: string;
	userId: string;
	index: number;
	token: string;
}): IncomingChannelMessage {
	return {
		id: `discord-lab:${input.index}:${Date.now()}:${randomUUID()}`,
		channel: "discord",
		conversationKey: input.conversationKey,
		target: { channelId: input.channelId, userId: input.userId },
		parts: [{ type: "text", text: renderPrompt(input.index, input.token) }],
		createdAtMs: Date.now(),
		isDirectMessage: true,
		senderId: input.userId,
	};
}

describe("live Discord Lab", { skip: !LIVE }, () => {
	it(`sends ${BATCH_COUNT} real Discord replies for ${BATCH_COUNT} rapid runs`, { timeout: TIMEOUT_MS }, async (t) => {
		const config = loadConfig(["--home", env("PIE_AGENT_HOME") ?? ""]);
		const lab = resolveLabChannel(config.homeDir);
		if (!lab.channelId || !lab.conversationKey || !lab.userId) {
			t.skip("PIE_LIVE_DISCORD_LAB_CHANNEL_ID, profile ownerSession.chatId, or prior Discord agent-events.jsonl conversationKey is required");
			return;
		}

		const adapter = new LiveDiscordLabAdapter(config.discord.token);
		const runtime = new TextChannelRuntime(
			{
				...config,
				outputToolCallsToIm: false,
				outputThinkingToIm: false,
				resumeSessions: false,
				tools: [],
			},
			adapter,
		);
		await runtime.start();
		try {
			const runId = randomUUID().slice(0, 8);
			const tokens = Array.from({ length: BATCH_COUNT }, (_, index) => `PIE_DISCORD_LAB_${runId}_${index + 1}`);
			const messages = tokens.map((token, index) =>
				createSyntheticMessage({
					channelId: lab.channelId!,
					conversationKey: `${lab.conversationKey}:${Date.now()}`,
					userId: lab.userId!,
					index: index + 1,
					token,
				}),
			);
			await Promise.all(messages.map((message) => adapter.receive(message)));

			for (const [index, token] of tokens.entries()) {
				const session = await runtime.getSession(messages[index]!.conversationKey);
				const stateText = JSON.stringify(session.state ?? {});
				assert.match(stateText, expectedPatternFor(token), `turn ${index + 1} did not match expected reply`);
			}
		} finally {
			await runtime.stop();
		}
		setTimeout(() => process.exit(0), 50);
	});
});
