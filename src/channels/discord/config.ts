import { getPrimaryDiscordChannel, type AgentProfile, type DiscordChannelProfile } from "../../core/config-store.js";
import { loadCommonChannelConfig, setEnvDefault, type CommonChannelRuntimeConfig } from "../common/config.js";

export interface DiscordBotConfig extends CommonChannelRuntimeConfig {
	discord: {
		token: string;
		applicationId?: string;
		guildId?: string;
	};
}

export function loadConfig(argv: string[] = process.argv.slice(2)): DiscordBotConfig {
	const common = loadCommonChannelConfig({
		channelKind: "discord",
		envPrefix: "DISCORD",
		argv,
		mergeChannelProfile: (env: Record<string, string | undefined>, profile: AgentProfile) => {
			const channel: DiscordChannelProfile | undefined = getPrimaryDiscordChannel(profile);
			if (channel) {
				setEnvDefault(env, "DISCORD_APPLICATION_ID", channel.applicationId);
				setEnvDefault(env, "DISCORD_GUILD_ID", channel.guildId);
			}
		},
	});
	const env = common.runtimeEnv;
	const token = env.DISCORD_BOT_TOKEN?.trim();
	if (!token) {
		throw new Error("Missing DISCORD_BOT_TOKEN");
	}
	return {
		...common,
		discord: {
			token,
			applicationId: env.DISCORD_APPLICATION_ID?.trim() || undefined,
			guildId: env.DISCORD_GUILD_ID?.trim() || undefined,
		},
	};
}
