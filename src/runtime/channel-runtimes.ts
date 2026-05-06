import { isChannelAvailableForRelease } from "../core/channel-availability.js";
import type { AgentProfile, ChannelKind } from "../core/config-store.js";
import { readDesktopSettings } from "../desktop/main/desktop-settings.js";
import { loadConfig as loadDiscordConfig } from "../channels/discord/config.js";
import { createDiscordBotRuntime } from "../channels/discord/main.js";
import { loadConfig as loadFeishuConfig } from "../channels/feishu/config.js";
import { createFeishuBotRuntime } from "../channels/feishu/main.js";
import { loadConfig as loadSlackConfig } from "../channels/slack/config.js";
import { createSlackBotRuntime } from "../channels/slack/main.js";
import { loadConfig as loadTelegramConfig } from "../channels/telegram/config.js";
import { createTelegramBotRuntime } from "../channels/telegram/main.js";
import { loadConfig as loadWechatConfig } from "../channels/wechat/config.js";
import { createWechatBotRuntime } from "../channels/wechat/main.js";
import type { AgentTurnPort, ManagedRuntime } from "./types.js";

export type ChannelRuntime = ManagedRuntime & AgentTurnPort & { setShutdownExitCode?: (code: number) => void };

function getEnabledChannelKinds(profile: AgentProfile | undefined): ChannelKind[] {
	const enabledChannels = profile?.channels.filter((channel) => channel.enabled !== false) ?? [];
	return enabledChannels.length ? enabledChannels.map((channel) => channel.kind) : ["feishu"];
}

function createChannelRuntime(kind: ChannelKind): ChannelRuntime | undefined {
	if (kind === "feishu") {
		return createFeishuBotRuntime(loadFeishuConfig());
	}
	if (kind === "wechat") {
		return createWechatBotRuntime(loadWechatConfig());
	}
	if (kind === "slack") {
		return createSlackBotRuntime(loadSlackConfig());
	}
	if (kind === "discord") {
		return createDiscordBotRuntime(loadDiscordConfig());
	}
	if (kind === "telegram") {
		return createTelegramBotRuntime(loadTelegramConfig());
	}
	return undefined;
}

export function createChannelRuntimes(profile: AgentProfile | undefined): ChannelRuntime[] {
	const developerMode = readDesktopSettings().developerMode;
	const runtimes: ChannelRuntime[] = [];
	for (const kind of getEnabledChannelKinds(profile)) {
		if (!isChannelAvailableForRelease(kind, { developerMode })) {
			console.warn(`[runtime] ${kind} channel is still in development and is disabled for this release.`);
			continue;
		}
		const runtime = createChannelRuntime(kind);
		if (runtime) {
			runtimes.push(runtime);
		}
	}
	return runtimes;
}
