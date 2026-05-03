import * as lark from "@larksuiteoapi/node-sdk";
import type { Model } from "@mariozechner/pi-ai";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	upsertAgentEnv,
} from "../../core/agent-home.js";
import { LarkClient } from "../../channels/feishu/platform/core/lark-client.js";
import {
	DEFAULT_WECHAT_BASE_URL,
	fetchLoginQr,
	pollLoginQrStatus,
} from "../../channels/wechat/platform/api.js";
import { normalizeWechatAccountId } from "../../channels/wechat/state.js";
import {
	createAgentProfile,
	getProfileModel,
	getStoredProfile,
	loadConfigStore,
	saveConfigStore,
	setStoredProfile,
} from "../../core/config-store.js";
import {
	generateBotProfileId,
	getProfileHomeDir,
	loadProfileRegistry,
	registerProfileHome,
} from "../../core/profile-registry.js";
import type {
	AgentCreationDraft,
	AgentCreationSession,
	AgentOnboardEvent,
	DesktopFeishuAppCredentials,
	DesktopModelOption,
	DesktopWechatCredentials,
} from "../shared/types.js";

type EmitOnboardEvent = (event: AgentOnboardEvent) => void;

type ModelsJsonRoot = {
	providers?: Record<string, unknown>;
};

const nodeRequire = createRequire(import.meta.url);

const PROVIDER_CREDENTIAL_ENV: Record<string, string> = {
	openai: "OPENAI_API_KEY",
	anthropic: "ANTHROPIC_API_KEY",
	google: "GEMINI_API_KEY",
	"google-vertex": "GOOGLE_CLOUD_API_KEY",
	groq: "GROQ_API_KEY",
	cerebras: "CEREBRAS_API_KEY",
	xai: "XAI_API_KEY",
	openrouter: "OPENROUTER_API_KEY",
	"vercel-ai-gateway": "AI_GATEWAY_API_KEY",
	zai: "ZAI_API_KEY",
	mistral: "MISTRAL_API_KEY",
	minimax: "MINIMAX_API_KEY",
	"minimax-cn": "MINIMAX_CN_API_KEY",
	huggingface: "HF_TOKEN",
	opencode: "OPENCODE_API_KEY",
	"opencode-go": "OPENCODE_API_KEY",
	"kimi-coding": "KIMI_API_KEY",
	deepseek: "DEEPSEEK_API_KEY",
	"azure-openai-responses": "AZURE_OPENAI_API_KEY",
	"github-copilot": "COPILOT_GITHUB_TOKEN",
	"amazon-bedrock": "AWS_BEARER_TOKEN_BEDROCK",
};

const DEFAULT_BOT_NAMES = [
	"Mia",
	"Ava",
	"Eva",
	"Ivy",
	"Zoe",
	"Amy",
	"May",
	"Ada",
	"Elsa",
	"Nora",
	"Lily",
	"Yui",
	"Lua",
	"Luna",
	"Mimi",
	"Kiki",
];

function pickDefaultBotName(): string {
	return DEFAULT_BOT_NAMES[Math.floor(Math.random() * DEFAULT_BOT_NAMES.length)] ?? "Mia";
}

export function getProviderCredentialEnv(provider: string): string | undefined {
	if (provider === "pie-openai-proxy") {
		return "PIE_OPENAI_PROXY_API_KEY";
	}
	return PROVIDER_CREDENTIAL_ENV[provider];
}

function modelToOption(model: Model<any>): DesktopModelOption {
	return {
		id: String(model.id),
		name: typeof model.name === "string" ? model.name : undefined,
		provider: String(model.provider),
	};
}

export function loadModelOptions(homeDir: string): DesktopModelOption[] {
	const registry = ModelRegistry.create(AuthStorage.inMemory(), join(homeDir, "models.json"));
	registry.refresh();
	return registry.getAll().map(modelToOption);
}

export function loadModelCatalog(homeDir: string): Pick<AgentCreationSession, "models" | "providers"> {
	const models = loadModelOptions(homeDir);
	const providers = [...new Set(models.map((model) => model.provider))].sort((left, right) => left.localeCompare(right));
	return { models, providers };
}

function mergeProxyIntoModelsJson(homeDir: string, providerId: string, providerConfig: unknown): void {
	const path = join(homeDir, "models.json");
	let root: ModelsJsonRoot = {};
	if (existsSync(path)) {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			root = parsed as ModelsJsonRoot;
		}
	}
	if (!root.providers || typeof root.providers !== "object") {
		root.providers = {};
	}
	root.providers[providerId] = providerConfig;
	writeFileSync(path, `${JSON.stringify(root, null, 2)}\n`, "utf8");
}

function generateQrText(url: string): Promise<string> {
	return new Promise((resolve) => {
		const qrcode = nodeRequire("qrcode-terminal") as {
			generate(input: string, options: { small: boolean }, callback: (qr: string) => void): void;
		};
		qrcode.generate(url, { small: true }, resolve);
	});
}

export function beginAgentCreation(): AgentCreationSession {
	const registry = loadProfileRegistry();
	const profileId = generateBotProfileId(registry);
	const home = getProfileHomeDir(profileId);
	mkdirSync(home, { recursive: true });
	const { models, providers } = loadModelCatalog(home);
	return {
		sessionId: profileId,
		profileId,
		name: pickDefaultBotName(),
		home,
		models,
		providers,
	};
}

export async function createFeishuAppForSession(
	sessionId: string,
	emit: EmitOnboardEvent,
): Promise<DesktopFeishuAppCredentials> {
	try {
		emit({ sessionId, type: "status", message: "正在准备扫码授权..." });
		const result = await lark.registerApp({
			source: "pie",
			onQRCodeReady(info) {
				void generateQrText(info.url).then((qr) => {
					emit({
						sessionId,
						type: "qr",
						message: "请使用飞书或 Lark 扫码授权创建 bot",
						url: info.url,
						qr,
						expiresIn: info.expireIn,
					});
				});
			},
			onStatusChange(info) {
				if (info.status === "domain_switched") {
					emit({ sessionId, type: "status", message: "检测到 Lark 租户，已切换注册域名。" });
				} else if (info.status === "slow_down") {
					emit({ sessionId, type: "status", message: `授权轮询已放慢${info.interval ? `到 ${info.interval}s` : ""}。` });
				}
			},
		});
		const feishu = {
			appId: result.client_id,
			appSecret: result.client_secret,
			brand: result.user_info?.tenant_brand === "lark" ? "lark" as const : "feishu" as const,
		};
		emit({ sessionId, type: "status", message: "正在读取飞书应用名称和头像..." });
		const probe = await LarkClient.fromCredentials({
			accountId: `desktop-onboard-${sessionId}`,
			appId: feishu.appId,
			appSecret: feishu.appSecret,
			brand: feishu.brand,
		}).probe();
		const syncedFeishu = {
			...feishu,
			...(probe.ok && probe.botName ? { appName: probe.botName } : {}),
			...(probe.ok && probe.botAvatarUrl ? { avatarUrl: probe.botAvatarUrl } : {}),
		};
		const syncParts = [
			syncedFeishu.appName ? "名称" : undefined,
			syncedFeishu.avatarUrl ? "头像" : undefined,
		].filter(Boolean);
		emit({
			sessionId,
			type: "done",
			message: syncParts.length
				? `已创建 ${syncedFeishu.brand === "lark" ? "Lark" : "飞书"} 应用，并同步${syncParts.join("和")}`
				: `已创建 ${syncedFeishu.brand === "lark" ? "Lark" : "飞书"} 应用，但未从开放平台读取到名称和头像`,
			feishu: syncedFeishu,
		});
		return syncedFeishu;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		emit({ sessionId, type: "error", message });
		throw error;
	}
}

const WECHAT_BOT_TYPE = "3";
const WECHAT_LOGIN_TIMEOUT_MS = 480_000;
const WECHAT_QR_STATUS_TIMEOUT_MS = 35_000;
const MAX_WECHAT_QR_REFRESH_COUNT = 3;

export async function createWechatLoginForSession(
	sessionId: string,
	emit: EmitOnboardEvent,
): Promise<DesktopWechatCredentials> {
	const homeDir = getProfileHomeDir(sessionId);
	try {
		emit({ sessionId, type: "status", message: "正在准备微信扫码授权..." });
		let qr = await fetchLoginQr({
			baseUrl: DEFAULT_WECHAT_BASE_URL,
			botType: WECHAT_BOT_TYPE,
		});
		let refreshCount = 1;
		let scanned = false;
		const deadline = Date.now() + WECHAT_LOGIN_TIMEOUT_MS;
		const emitQr = async (message: string) => {
			emit({
				sessionId,
				type: "qr",
				message,
				url: qr.qrcode_img_content,
				qr: await generateQrText(qr.qrcode_img_content),
			});
		};
		await emitQr("请使用微信扫码连接 bot");
		while (Date.now() < deadline) {
			const status = await pollLoginQrStatus({
				baseUrl: DEFAULT_WECHAT_BASE_URL,
				qrcode: qr.qrcode,
				timeoutMs: WECHAT_QR_STATUS_TIMEOUT_MS,
			});
			if (status.status === "wait") {
				continue;
			}
			if (status.status === "scaned") {
				if (!scanned) {
					emit({ sessionId, type: "status", message: "已扫码，请在微信里继续确认..." });
					scanned = true;
				}
				continue;
			}
			if (status.status === "scaned_but_redirect") {
				emit({ sessionId, type: "status", message: "微信扫码已跳转，请继续等待确认..." });
				continue;
			}
			if (status.status === "expired") {
				refreshCount += 1;
				if (refreshCount > MAX_WECHAT_QR_REFRESH_COUNT) {
					throw new Error("微信登录二维码多次过期，请重新开始创建。");
				}
				emit({ sessionId, type: "status", message: `微信二维码已过期，正在刷新 (${refreshCount}/${MAX_WECHAT_QR_REFRESH_COUNT})...` });
				qr = await fetchLoginQr({
					baseUrl: DEFAULT_WECHAT_BASE_URL,
					botType: WECHAT_BOT_TYPE,
				});
				scanned = false;
				await emitQr("请使用新的微信二维码扫码连接 bot");
				continue;
			}
			if (status.status === "confirmed") {
				const token = status.bot_token?.trim();
				const rawAccountId = status.ilink_bot_id?.trim();
				if (!token || !rawAccountId) {
					throw new Error("微信登录已确认，但响应缺少 bot token 或 account id。");
				}
				const wechat: DesktopWechatCredentials = {
					accountId: normalizeWechatAccountId(rawAccountId),
					baseUrl: status.baseurl?.trim() || DEFAULT_WECHAT_BASE_URL,
					...(status.ilink_user_id?.trim() ? { userId: status.ilink_user_id.trim() } : {}),
				};
				upsertAgentEnv({
					WECHAT_BOT_TOKEN: token,
					WECHAT_ACCOUNT_ID: wechat.accountId,
					WECHAT_BASE_URL: wechat.baseUrl,
					...(wechat.userId ? { WECHAT_USER_ID: wechat.userId } : {}),
				}, homeDir);
				emit({ sessionId, type: "done", message: "微信已连接", wechat });
				return wechat;
			}
		}
		throw new Error("微信登录超时，请重新开始创建。");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		emit({ sessionId, type: "error", message });
		throw error;
	}
}

export function completeAgentCreation(draft: AgentCreationDraft): void {
	const profileId = draft.sessionId;
	const homeDir = getProfileHomeDir(profileId);
	const channels = Array.from(new Set(draft.channels)).filter(
		(channel) =>
			channel === "feishu" ||
			channel === "wechat" ||
			channel === "slack" ||
			channel === "discord" ||
			channel === "telegram",
	);
	if (!channels.length) {
		throw new Error("至少选择一个 IM 渠道");
	}
	if (channels.includes("feishu") && (!draft.feishu?.appId.trim() || !draft.feishu.appSecret.trim())) {
		throw new Error("飞书 App ID 和 App Secret 必填");
	}
	if (channels.includes("wechat") && !draft.wechat?.accountId.trim()) {
		throw new Error("微信渠道尚未完成扫码授权");
	}
	if (channels.includes("slack") && (!draft.slack?.botToken.trim() || !draft.slack.appToken.trim())) {
		throw new Error("Slack Bot Token 和 App Token 必填");
	}
	if (channels.includes("discord") && !draft.discord?.botToken.trim()) {
		throw new Error("Discord Bot Token 必填");
	}
	if (channels.includes("telegram") && !draft.telegram?.botToken.trim()) {
		throw new Error("Telegram Bot Token 必填");
	}
	if (!draft.provider.trim() || !draft.model.trim()) {
		throw new Error("Provider 和模型必填");
	}

	mkdirSync(homeDir, { recursive: true });
	const store = loadConfigStore(homeDir);
	const ex = getStoredProfile(store);
	const exModel = getProfileModel(ex);

	const provider = draft.provider.trim();
	const model = draft.model.trim();
	const apiKey = draft.apiKey?.trim();
	if (provider === "pie-openai-proxy") {
		mergeProxyIntoModelsJson(homeDir, provider, {
			baseUrl: "https://api.openai.com/v1",
			api: "openai-completions",
			apiKey: "PIE_OPENAI_PROXY_API_KEY",
			compat: {
				supportsDeveloperRole: false,
				supportsReasoningEffort: false,
			},
			models: [{ id: model }],
		});
	}

	const profile = createAgentProfile({
		backend: {
			kind: draft.framework,
			model: {
				provider,
				model,
				thinkingLevel: draft.thinkingLevel as ThinkingLevel,
				tools: exModel?.tools ?? "coding",
				debug: exModel?.debug ?? false,
				resumeSessions: draft.framework === "ousia",
				outputToolCallsToIm: true,
			},
		},
		channels: [
			...(channels.includes("feishu") && draft.feishu
				? [{
						kind: "feishu" as const,
						id: "feishu",
						enabled: true,
						appId: draft.feishu.appId.trim(),
						brand: draft.feishu.brand,
					}]
				: []),
			...(channels.includes("wechat")
				? [{
						kind: "wechat" as const,
						id: "wechat",
						enabled: true,
						accountId: draft.wechat?.accountId.trim() || "wechat",
						baseUrl: draft.wechat?.baseUrl.trim() || DEFAULT_WECHAT_BASE_URL,
					}]
				: []),
			...(channels.includes("slack")
				? [{
						kind: "slack" as const,
						id: "slack",
						enabled: true,
						teamId: draft.slack?.teamId?.trim() || undefined,
						appId: draft.slack?.appId?.trim() || undefined,
						botUserId: draft.slack?.botUserId?.trim() || undefined,
					}]
				: []),
			...(channels.includes("discord")
				? [{
						kind: "discord" as const,
						id: "discord",
						enabled: true,
						applicationId: draft.discord?.applicationId?.trim() || undefined,
						guildId: draft.discord?.guildId?.trim() || undefined,
					}]
				: []),
			...(channels.includes("telegram")
				? [{
						kind: "telegram" as const,
						id: "telegram",
						enabled: true,
						botUsername: draft.telegram?.botUsername?.trim() || undefined,
					}]
				: []),
		],
	});

	saveConfigStore(setStoredProfile(store, profile), homeDir);
	const savedEnv: Record<string, string> = {};
	if (channels.includes("feishu") && draft.feishu) {
		savedEnv.FEISHU_APP_SECRET = draft.feishu.appSecret.trim();
	}
	if (channels.includes("slack") && draft.slack) {
		savedEnv.SLACK_BOT_TOKEN = draft.slack.botToken.trim();
		savedEnv.SLACK_APP_TOKEN = draft.slack.appToken.trim();
		if (draft.slack.signingSecret?.trim()) {
			savedEnv.SLACK_SIGNING_SECRET = draft.slack.signingSecret.trim();
		}
	}
	if (channels.includes("discord") && draft.discord) {
		savedEnv.DISCORD_BOT_TOKEN = draft.discord.botToken.trim();
	}
	if (channels.includes("telegram") && draft.telegram) {
		savedEnv.TELEGRAM_BOT_TOKEN = draft.telegram.botToken.trim();
	}
	const envKey = getProviderCredentialEnv(provider);
	if (envKey && apiKey) {
		savedEnv[envKey] = apiKey;
	}
	upsertAgentEnv(savedEnv, homeDir);
	registerProfileHome(profileId, {
		displayName: draft.feishu?.appName?.trim() || draft.telegram?.botUsername?.trim() || draft.name?.trim() || profileId,
		enabled: false,
		active: true,
	});
}
