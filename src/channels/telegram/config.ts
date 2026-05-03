import {
	getPrimaryTelegramChannel,
	type TelegramChannelProfile,
	type AgentProfile,
} from "../../core/config-store.js";
import { loadCommonChannelConfig, setEnvDefault, type CommonChannelRuntimeConfig } from "../common/config.js";

export interface TelegramBotConfig extends CommonChannelRuntimeConfig {
	telegram: {
		token: string;
		botUsername?: string;
	};
}

export function loadConfig(argv: string[] = process.argv.slice(2)): TelegramBotConfig {
	const common = loadCommonChannelConfig({
		channelKind: "telegram",
		envPrefix: "TELEGRAM",
		argv,
		mergeChannelProfile: (env: Record<string, string | undefined>, profile: AgentProfile) => {
			const channel: TelegramChannelProfile | undefined = getPrimaryTelegramChannel(profile);
			if (channel) {
				setEnvDefault(env, "TELEGRAM_BOT_USERNAME", channel.botUsername);
			}
		},
	});
	const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
	if (!token) {
		throw new Error("Missing TELEGRAM_BOT_TOKEN");
	}
	return {
		...common,
		telegram: {
			token,
			botUsername: process.env.TELEGRAM_BOT_USERNAME?.trim() || undefined,
		},
	};
}
