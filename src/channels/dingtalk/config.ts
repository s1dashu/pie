import { getPrimaryDingTalkChannel, type AgentProfile, type DingTalkChannelProfile } from "../../core/config-store.js";
import { loadCommonChannelConfig, setEnvDefault, type CommonChannelRuntimeConfig } from "../common/config.js";

export interface DingTalkBotConfig extends CommonChannelRuntimeConfig {
	dingtalk: {
		clientId: string;
		clientSecret: string;
	};
}

export function loadConfig(argv: string[] = process.argv.slice(2)): DingTalkBotConfig {
	const common = loadCommonChannelConfig({
		channelKind: "dingtalk",
		envPrefix: "DINGTALK",
		argv,
		mergeChannelProfile: (env: Record<string, string | undefined>, profile: AgentProfile) => {
			const channel: DingTalkChannelProfile | undefined = getPrimaryDingTalkChannel(profile);
			if (channel) {
				setEnvDefault(env, "DINGTALK_CLIENT_ID", channel.clientId);
			}
		},
	});
	const env = common.runtimeEnv;
	const clientId = env.DINGTALK_CLIENT_ID?.trim();
	const clientSecret = env.DINGTALK_CLIENT_SECRET?.trim();
	if (!clientId || !clientSecret) {
		throw new Error("Missing DINGTALK_CLIENT_ID or DINGTALK_CLIENT_SECRET");
	}
	return {
		...common,
		dingtalk: {
			clientId,
			clientSecret,
		},
	};
}
