import { toOpenClawModelRef } from "../../agents/openclaw-models.js";
import {
	getPrimaryDiscordChannel,
	getPrimaryDingTalkChannel,
	getPrimaryFeishuChannel,
	getPrimarySlackChannel,
	getPrimaryTelegramChannel,
	getPrimaryWechatChannel,
	getProfileModel,
	getImBehavior,
	setProfileModel,
	setImBehavior,
	upsertDiscordChannel,
	upsertDingTalkChannel,
	upsertFeishuChannel,
	upsertSlackChannel,
	upsertTelegramChannel,
	upsertWechatChannel,
	type AgentProfile,
} from "../../core/config-store.js";
import { getDefaultResumeSessionsForHarness } from "../../core/session-policy.js";
import { DEFAULT_WECHAT_BASE_URL } from "../../channels/wechat/platform/api.js";
import type { AgentDraft } from "../shared/types.js";

export interface AgentProfileMutationPlan {
	nextProfile: AgentProfile;
	envUpdates: Record<string, string | undefined>;
	hasFeishuUpdate: boolean;
	shouldInvalidateFeishuCredentials: boolean;
	feishu?: {
		appId: string;
		appSecret: string;
		brand: "feishu" | "lark";
	};
	hasModelUpdate: boolean;
	hermesModelUpdate?: {
		provider: string;
		model: string;
	};
	openClawModelRef?: string;
	nextProvider?: string;
}

type RuntimeEnv = Record<string, string | undefined>;

export function planAgentProfileMutation(options: {
	currentProfile: AgentProfile | undefined;
	draft: AgentDraft;
	env: RuntimeEnv;
}): AgentProfileMutationPlan {
	const { currentProfile, draft, env } = options;
	const feishuChannel = getPrimaryFeishuChannel(currentProfile);
	const wechatChannel = getPrimaryWechatChannel(currentProfile);
	const slackChannel = getPrimarySlackChannel(currentProfile);
	const discordChannel = getPrimaryDiscordChannel(currentProfile);
	const dingtalkChannel = getPrimaryDingTalkChannel(currentProfile);
	const telegramChannel = getPrimaryTelegramChannel(currentProfile);
	const model = getProfileModel(currentProfile) ?? {};
	const hasFeishuDraft =
		draft.appId !== undefined ||
		draft.appSecret !== undefined ||
		draft.brand !== undefined ||
		draft.feishuMessageOutputMode !== undefined;
	const hasImBehaviorDraft = draft.imGroupResponseMode !== undefined;
	const hasWechatDraft =
		draft.wechatAccountId !== undefined ||
		draft.wechatBaseUrl !== undefined ||
		draft.wechatBotToken !== undefined;
	const hasSlackDraft =
		draft.slackBotToken !== undefined ||
		draft.slackAppToken !== undefined;
	const hasDiscordDraft =
		draft.discordBotToken !== undefined ||
		draft.discordApplicationId !== undefined ||
		draft.discordGuildId !== undefined;
	const hasDingTalkDraft =
		draft.dingtalkClientId !== undefined ||
		draft.dingtalkClientSecret !== undefined;
	const hasTelegramDraft = draft.telegramBotToken !== undefined || draft.telegramBotUsername !== undefined;
	const hasModelUpdate =
		draft.provider !== undefined ||
		draft.model !== undefined ||
		draft.thinkingLevel !== undefined ||
		draft.resumeSessions !== undefined;
	const hasFeishuUpdate = feishuChannel
		? hasFeishuDraft
		: hasNonEmptyDraftValue(draft.appId, draft.appSecret);
	const hasWechatUpdate = wechatChannel
		? hasWechatDraft
		: hasNonEmptyDraftValue(draft.wechatAccountId, draft.wechatBotToken);
	const hasSlackUpdate = slackChannel
		? hasSlackDraft
		: hasNonEmptyDraftValue(draft.slackBotToken, draft.slackAppToken);
	const hasDiscordUpdate = discordChannel
		? hasDiscordDraft
		: hasNonEmptyDraftValue(draft.discordBotToken, draft.discordApplicationId, draft.discordGuildId);
	const hasDingTalkUpdate = dingtalkChannel
		? hasDingTalkDraft
		: hasNonEmptyDraftValue(draft.dingtalkClientId, draft.dingtalkClientSecret);
	const hasTelegramUpdate = telegramChannel
		? hasTelegramDraft
		: hasNonEmptyDraftValue(draft.telegramBotToken, draft.telegramBotUsername);
	const nextAppId = draft.appId ?? feishuChannel?.appId ?? "";
	const nextBrand = draft.brand ?? feishuChannel?.brand ?? "feishu";
	const nextFeishuMessageOutputMode = draft.feishuMessageOutputMode ?? feishuChannel?.messageOutputMode ?? "bubble";
	const nextOutputThinkingToIm = nextFeishuMessageOutputMode === "card"
		? false
		: draft.outputThinkingToIm ?? model.outputThinkingToIm ?? false;
	const nextAppSecret = draft.appSecret ?? env.FEISHU_APP_SECRET ?? "";
	if (hasFeishuUpdate && (!nextAppId.trim() || !nextAppSecret.trim())) {
		throw new Error("飞书 App ID 和 App Secret 必填");
	}
	const nextWechatAccountId = draft.wechatAccountId ?? wechatChannel?.accountId ?? "";
	const nextWechatBaseUrl = draft.wechatBaseUrl ?? wechatChannel?.baseUrl ?? DEFAULT_WECHAT_BASE_URL;
	if (hasWechatUpdate && !nextWechatAccountId.trim()) {
		throw new Error("微信 Account ID 必填");
	}
	if (hasSlackUpdate) {
		const botToken = draft.slackBotToken ?? env.SLACK_BOT_TOKEN ?? "";
		const appToken = draft.slackAppToken ?? env.SLACK_APP_TOKEN ?? "";
		if (!botToken.trim() || !appToken.trim()) {
			throw new Error("Slack Bot Token 和 App Token 必填");
		}
	}
	if (hasDiscordUpdate) {
		const token = draft.discordBotToken ?? env.DISCORD_BOT_TOKEN ?? "";
		if (!token.trim()) {
			throw new Error("Discord Bot Token 必填");
		}
	}
	if (hasDingTalkUpdate) {
		const clientId = draft.dingtalkClientId ?? dingtalkChannel?.clientId ?? "";
		const clientSecret = draft.dingtalkClientSecret ?? env.DINGTALK_CLIENT_SECRET ?? "";
		if (!clientId.trim() || !clientSecret.trim()) {
			throw new Error("钉钉 Client ID 和 Client Secret 必填");
		}
	}
	if (hasTelegramUpdate) {
		const token = draft.telegramBotToken ?? env.TELEGRAM_BOT_TOKEN ?? "";
		if (!token.trim()) {
			throw new Error("Telegram Bot Token 必填");
		}
	}
	validateModelDraft(draft);
	let nextProfileWithChannel = currentProfile;
	if (feishuChannel || hasFeishuUpdate) {
		nextProfileWithChannel = upsertFeishuChannel(nextProfileWithChannel, {
			...(feishuChannel ?? { kind: "feishu" as const, id: "feishu", enabled: true }),
			appId: nextAppId.trim(),
			credentialState: draft.appId !== undefined || draft.appSecret !== undefined ? "active" : feishuChannel?.credentialState ?? "active",
			credentialInvalidatedAt: draft.appId !== undefined || draft.appSecret !== undefined ? undefined : feishuChannel?.credentialInvalidatedAt,
			credentialInvalidatedReason: draft.appId !== undefined || draft.appSecret !== undefined ? undefined : feishuChannel?.credentialInvalidatedReason,
			brand: nextBrand,
			messageOutputMode: nextFeishuMessageOutputMode,
		});
	}
	if (wechatChannel || hasWechatUpdate) {
		nextProfileWithChannel = upsertWechatChannel(nextProfileWithChannel, {
			...(wechatChannel ?? { kind: "wechat" as const, id: "wechat", enabled: true }),
			accountId: nextWechatAccountId.trim(),
			baseUrl: nextWechatBaseUrl.trim(),
		});
	}
	if (slackChannel || hasSlackUpdate) {
		nextProfileWithChannel = upsertSlackChannel(nextProfileWithChannel, {
			...(slackChannel ?? { kind: "slack" as const, id: "slack", enabled: true }),
		});
	}
	if (discordChannel || hasDiscordUpdate) {
		nextProfileWithChannel = upsertDiscordChannel(nextProfileWithChannel, {
			...(discordChannel ?? { kind: "discord" as const, id: "discord", enabled: true }),
			applicationId: draft.discordApplicationId ?? discordChannel?.applicationId,
			guildId: draft.discordGuildId ?? discordChannel?.guildId,
		});
	}
	if (dingtalkChannel || hasDingTalkUpdate) {
		nextProfileWithChannel = upsertDingTalkChannel(nextProfileWithChannel, {
			...(dingtalkChannel ?? { kind: "dingtalk" as const, id: "dingtalk", enabled: true }),
			clientId: (draft.dingtalkClientId ?? dingtalkChannel?.clientId ?? "").trim(),
		});
	}
	if (telegramChannel || hasTelegramUpdate) {
		nextProfileWithChannel = upsertTelegramChannel(nextProfileWithChannel, {
			...(telegramChannel ?? { kind: "telegram" as const, id: "telegram", enabled: true }),
			botUsername: draft.telegramBotUsername ?? telegramChannel?.botUsername,
		});
	}
	const nextProfileWithImBehavior = hasImBehaviorDraft
		? setImBehavior(nextProfileWithChannel, {
				...getImBehavior(nextProfileWithChannel),
				groupResponseMode: draft.imGroupResponseMode ?? getImBehavior(nextProfileWithChannel).groupResponseMode,
			})
		: nextProfileWithChannel;
	const nextProfileBase = setProfileModel(nextProfileWithImBehavior, {
		...model,
		provider: draft.provider ?? model.provider,
		model: draft.model ?? model.model,
		thinkingLevel: draft.thinkingLevel ?? model.thinkingLevel,
		resumeSessions: draft.resumeSessions ?? model.resumeSessions ?? getDefaultResumeSessionsForHarness(currentProfile?.harness.kind),
		outputToolCallsToIm: draft.outputToolCallsToIm ?? model.outputToolCallsToIm ?? true,
		outputToolCallImMaxLength: draft.outputToolCallImMaxLength ?? model.outputToolCallImMaxLength ?? 60,
		outputThinkingToIm: nextOutputThinkingToIm,
	});
	const openClawModelRef = nextProfileBase.harness.kind === "openclaw"
		? toOpenClawModelRef(nextProfileBase.harness.model?.provider, nextProfileBase.harness.model?.model)
		: undefined;
	const nextProfile = nextProfileBase.harness.kind === "openclaw"
		? {
				...nextProfileBase,
				harness: {
					...nextProfileBase.harness,
					config: {
						...(nextProfileBase.harness.config ?? {}),
						modelRef: openClawModelRef,
					},
				},
			}
		: nextProfileBase;
	const envUpdates: Record<string, string | undefined> = {};
	if (hasFeishuUpdate) {
		envUpdates.FEISHU_APP_SECRET = nextAppSecret.trim();
	}
	if (hasWechatUpdate) {
		if (draft.wechatBotToken !== undefined) {
			envUpdates.WECHAT_BOT_TOKEN = draft.wechatBotToken.trim();
		}
		if (draft.wechatAccountId !== undefined) {
			envUpdates.WECHAT_ACCOUNT_ID = nextWechatAccountId.trim();
		}
		if (draft.wechatBaseUrl !== undefined) {
			envUpdates.WECHAT_BASE_URL = nextWechatBaseUrl.trim();
		}
	}
	if (hasSlackUpdate) {
		if (draft.slackBotToken !== undefined) {
			envUpdates.SLACK_BOT_TOKEN = draft.slackBotToken.trim();
		}
		if (draft.slackAppToken !== undefined) {
			envUpdates.SLACK_APP_TOKEN = draft.slackAppToken.trim();
		}
	}
	if (hasDiscordUpdate && draft.discordBotToken !== undefined) {
		envUpdates.DISCORD_BOT_TOKEN = draft.discordBotToken.trim();
	}
	if (hasDingTalkUpdate && draft.dingtalkClientSecret !== undefined) {
		envUpdates.DINGTALK_CLIENT_SECRET = draft.dingtalkClientSecret.trim();
	}
	if (hasTelegramUpdate && draft.telegramBotToken !== undefined) {
		envUpdates.TELEGRAM_BOT_TOKEN = draft.telegramBotToken.trim();
	}
	const nextProvider = draft.provider ?? model.provider;
	const nextModel = draft.model ?? model.model;
	return {
		nextProfile,
		envUpdates,
		hasFeishuUpdate,
		shouldInvalidateFeishuCredentials: hasFeishuUpdate && (draft.appId !== undefined || draft.appSecret !== undefined),
		feishu: hasFeishuUpdate
			? {
					appId: nextAppId,
					appSecret: nextAppSecret,
					brand: nextBrand,
				}
			: undefined,
		hasModelUpdate,
		hermesModelUpdate:
			hasModelUpdate && currentProfile?.harness.kind === "hermes" && nextProvider?.trim() && nextModel?.trim()
				? { provider: nextProvider.trim(), model: nextModel.trim() }
				: undefined,
		openClawModelRef,
		nextProvider,
	};
}

function validateModelDraft(draft: AgentDraft): void {
	const hasModelUpdate =
		draft.provider !== undefined ||
		draft.model !== undefined ||
		draft.thinkingLevel !== undefined ||
		draft.resumeSessions !== undefined;
	if (!hasModelUpdate) {
		return;
	}
	if (draft.provider === undefined && draft.model === undefined) {
		return;
	}
	if (!draft.provider?.trim()) {
		throw new Error("模型 Provider 必填");
	}
	if (!draft.model?.trim()) {
		throw new Error("模型 ID 必填");
	}
}

function hasNonEmptyDraftValue(...values: Array<string | undefined>): boolean {
	return values.some((value) => typeof value === "string" && value.trim().length > 0);
}
