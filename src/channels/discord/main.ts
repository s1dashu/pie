#!/usr/bin/env node

import process from "node:process";
import {
	ChannelType,
	Client,
	Events,
	GatewayIntentBits,
	Partials,
	type Message,
} from "discord.js";
import chalk from "chalk";
import { TextChannelRuntime } from "../common/text-channel-runtime.js";
import type { IncomingChannelMessage, TextChannelAdapter } from "../common/channel-model.js";
import { ChannelTokenLock } from "../common/token-lock.js";
import { loadConfig, type DiscordBotConfig } from "./config.js";
import { buildDiscordMessageParts } from "./messages.js";

function mentionedBotRole(message: Message, botId: string | undefined): string[] {
	if (!botId || !message.guild) {
		return [];
	}
	const botRoleIds = new Set(
		message.guild.members.me?.roles.cache
			.filter((role) => role.tags?.botId === botId)
			.map((role) => role.id) ?? [],
	);
	return [...message.mentions.roles.keys()].filter((roleId) => botRoleIds.has(roleId));
}

class DiscordAdapter implements TextChannelAdapter {
	readonly kind = "discord" as const;
	private readonly client: Client;
	private readonly lock: ChannelTokenLock;
	private resolveStopped: (() => void) | undefined;

	constructor(private readonly config: DiscordBotConfig) {
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
		this.lock = new ChannelTokenLock(config.homeDir, "discord", config.discord.token);
	}

	async start(handlers: { onMessage: (message: IncomingChannelMessage) => Promise<void> }): Promise<void> {
		this.lock.acquire();
		this.client.on(Events.MessageCreate, async (message) => {
			const incoming = this.toIncomingMessage(message);
			if (incoming) {
				await handlers.onMessage(incoming);
			}
		});
		await this.client.login(this.config.discord.token);
		console.log(`Discord bot authenticated: ${this.client.user?.tag ?? this.client.user?.id ?? "unknown"}`);
		await new Promise<void>((resolve) => {
			this.resolveStopped = resolve;
		});
	}

	async stop(): Promise<void> {
		this.client.destroy();
		this.resolveStopped?.();
		this.resolveStopped = undefined;
		this.lock.release();
	}

	async sendText(target: { channelId: string; threadId?: string }, text: string): Promise<void> {
		const channel = await this.client.channels.fetch(target.channelId);
		if (!channel || !("send" in channel) || typeof channel.send !== "function") {
			throw new Error(`Discord channel is not sendable: ${target.channelId}`);
		}
		await channel.send({ content: text, reply: target.threadId ? { messageReference: target.threadId } : undefined });
	}

	private toIncomingMessage(message: Message): IncomingChannelMessage | undefined {
		const botId = this.client.user?.id;
		if (message.author.bot) {
			if (this.config.verboseLogs && message.author.id !== botId) {
				this.logIgnoredMessage(message, "author_bot");
			}
			return undefined;
		}
		const isDirectMessage = message.channel.type === ChannelType.DM;
		const botRoleIds = mentionedBotRole(message, botId);
		const mentioned = botId ? message.mentions.users.has(botId) || botRoleIds.length > 0 : false;
		if (this.config.discord.guildId && message.guildId && message.guildId !== this.config.discord.guildId) {
			this.logIgnoredMessage(message, "guild_mismatch");
			return undefined;
		}
		if (!isDirectMessage && !mentioned) {
			if (this.config.verboseLogs) {
				this.logIgnoredMessage(message, "not_mentioned");
			}
			return undefined;
		}
		const parts = buildDiscordMessageParts({
			content: message.content,
			botId,
			botRoleIds,
			attachments: [...message.attachments.values()].map((attachment) => ({
				name: attachment.name,
				url: attachment.url,
				contentType: attachment.contentType,
			})),
		});
		return {
			id: `discord:${message.id}`,
			channel: "discord",
			conversationKey: `discord:${message.channel.id}:${isDirectMessage ? message.author.id : message.id}`,
			target: { channelId: message.channel.id, threadId: message.id, userId: message.author.id },
			parts,
			createdAtMs: message.createdTimestamp,
			isDirectMessage,
			senderId: message.author.id,
		};
	}

	private logIgnoredMessage(message: Message, reason: string): void {
		const guild = message.guildId ?? "dm";
		const channel = message.channel.id;
		const author = message.author.id;
		const mentions = [...message.mentions.users.keys()].join(",") || "none";
		console.log(chalk.gray(`Discord message ignored: ${reason} guild=${guild} channel=${channel} author=${author} mentions=${mentions}`));
	}
}

export function createDiscordBotRuntime(config: DiscordBotConfig): TextChannelRuntime {
	return new TextChannelRuntime(config, new DiscordAdapter(config));
}

export async function runDiscordBot(nextConfig: DiscordBotConfig = loadConfig()): Promise<number> {
	const runtime = createDiscordBotRuntime(nextConfig);
	const onSigint = (): void => {
		runtime.setShutdownExitCode(130);
		void runtime.stop();
	};
	const onSigterm = (): void => {
		runtime.setShutdownExitCode(143);
		void runtime.stop();
	};
	process.once("SIGINT", onSigint);
	process.once("SIGTERM", onSigterm);
	try {
		return await runtime.start();
	} finally {
		process.off("SIGINT", onSigint);
		process.off("SIGTERM", onSigterm);
		await runtime.stop();
	}
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
	try {
		const code = await runDiscordBot();
		process.exit(code);
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}
}
