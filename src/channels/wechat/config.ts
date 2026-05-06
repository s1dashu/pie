import {
	getPrimaryWechatChannel,
	type AgentProfile,
	type WechatChannelProfile,
} from "../../core/config-store.js";
import {
	loadCommonChannelConfig,
	setEnvDefault,
	type CommonChannelRuntimeConfig,
} from "../common/config.js";
import { DEFAULT_WECHAT_BASE_URL } from "./platform/api.js";

export interface WechatChannelConfig {
	accountId: string;
	token?: string;
	baseUrl: string;
	botType: string;
	routeTag?: string;
}

export interface WechatBotConfig extends CommonChannelRuntimeConfig {
	wechat: WechatChannelConfig;
}

export function loadConfig(argv: string[] = process.argv.slice(2)): WechatBotConfig {
	const common = loadCommonChannelConfig({
		channelKind: "wechat",
		envPrefix: "WECHAT",
		argv,
		mergeChannelProfile: (env: Record<string, string | undefined>, profile: AgentProfile) => {
			const channel: WechatChannelProfile | undefined = getPrimaryWechatChannel(profile);
			if (channel) {
				setEnvDefault(env, "WECHAT_ACCOUNT_ID", channel.accountId);
				setEnvDefault(env, "WECHAT_BASE_URL", channel.baseUrl);
				setEnvDefault(env, "WECHAT_BOT_TYPE", channel.botType);
				setEnvDefault(env, "WECHAT_ROUTE_TAG", channel.routeTag);
			}
		},
	});
	const env = common.runtimeEnv;
	return {
		...common,
		wechat: {
			accountId: env.WECHAT_ACCOUNT_ID?.trim() || "wechat",
			token: env.WECHAT_BOT_TOKEN?.trim() || undefined,
			baseUrl: env.WECHAT_BASE_URL?.trim() || DEFAULT_WECHAT_BASE_URL,
			botType: env.WECHAT_BOT_TYPE?.trim() || "3",
			routeTag: env.WECHAT_ROUTE_TAG?.trim() || undefined,
		},
	};
}
