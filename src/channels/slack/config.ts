import { getPrimarySlackChannel, type AgentProfile, type SlackChannelProfile } from "../../core/config-store.js";
import { loadCommonChannelConfig, setEnvDefault, type CommonChannelRuntimeConfig } from "../common/config.js";

export interface SlackBotConfig extends CommonChannelRuntimeConfig {
	slack: {
		botToken: string;
		appToken: string;
		signingSecret?: string;
		teamId?: string;
		appId?: string;
		botUserId?: string;
	};
}

export function loadConfig(argv: string[] = process.argv.slice(2)): SlackBotConfig {
	const common = loadCommonChannelConfig({
		channelKind: "slack",
		envPrefix: "SLACK",
		argv,
		mergeChannelProfile: (env: Record<string, string | undefined>, profile: AgentProfile) => {
			const channel: SlackChannelProfile | undefined = getPrimarySlackChannel(profile);
			if (channel) {
				setEnvDefault(env, "SLACK_TEAM_ID", channel.teamId);
				setEnvDefault(env, "SLACK_APP_ID", channel.appId);
				setEnvDefault(env, "SLACK_BOT_USER_ID", channel.botUserId);
			}
		},
	});
	const env = common.runtimeEnv;
	const botToken = env.SLACK_BOT_TOKEN?.trim();
	const appToken = env.SLACK_APP_TOKEN?.trim();
	if (!botToken || !appToken) {
		throw new Error("Missing SLACK_BOT_TOKEN or SLACK_APP_TOKEN");
	}
	return {
		...common,
		slack: {
			botToken,
			appToken,
			signingSecret: env.SLACK_SIGNING_SECRET?.trim() || undefined,
			teamId: env.SLACK_TEAM_ID?.trim() || undefined,
			appId: env.SLACK_APP_ID?.trim() || undefined,
			botUserId: env.SLACK_BOT_USER_ID?.trim() || undefined,
		},
	};
}
