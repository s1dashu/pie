import * as lark from "@larksuiteoapi/node-sdk";
import type { Model } from "@mariozechner/pi-ai";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	upsertAgentEnv,
} from "../../core/agent-home.js";
import {
	checkCodexAppServerEnvironment,
	codexCliAgentBackendAdapter,
	loginCodexWithAppServer,
} from "../../agents/adapters/codex-cli.js";
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
	DesktopCodexDiagnostic,
	DesktopCodexModelOption,
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

const FALLBACK_CODEX_MODELS: DesktopCodexModelOption[] = [
	{
		id: "gpt-5.5",
		name: "GPT-5.5",
		defaultThinkingLevel: "medium",
		supportedThinkingLevels: ["low", "medium", "high", "xhigh"],
	},
	{
		id: "gpt-5.3-codex",
		name: "GPT-5.3 Codex",
		defaultThinkingLevel: "medium",
		supportedThinkingLevels: ["low", "medium", "high", "xhigh"],
	},
	{
		id: "gpt-5.3-codex-spark",
		name: "GPT-5.3 Codex Spark",
		defaultThinkingLevel: "high",
		supportedThinkingLevels: ["low", "medium", "high", "xhigh"],
	},
];

export function loadCodexModelCatalog(): DesktopCodexModelOption[] {
	const path = join(homedir(), ".codex", "models_cache.json");
	if (!existsSync(path)) {
		return FALLBACK_CODEX_MODELS;
	}
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as { models?: unknown };
		if (!Array.isArray(parsed.models)) {
			return FALLBACK_CODEX_MODELS;
		}
		const models = parsed.models
			.flatMap((value): DesktopCodexModelOption[] => {
				if (!value || typeof value !== "object") {
					return [];
				}
				const model = value as Record<string, unknown>;
				const id = typeof model.slug === "string" ? model.slug.trim() : "";
				if (!id) {
					return [];
				}
				const supportedThinkingLevels = Array.isArray(model.supported_reasoning_levels)
					? model.supported_reasoning_levels
							.map((entry) =>
								entry && typeof entry === "object" && typeof (entry as { effort?: unknown }).effort === "string"
									? ((entry as { effort: string }).effort as DesktopCodexModelOption["supportedThinkingLevels"][number])
									: undefined,
							)
							.filter((entry): entry is DesktopCodexModelOption["supportedThinkingLevels"][number] =>
								entry === "low" || entry === "medium" || entry === "high" || entry === "xhigh",
							)
					: [];
				return [{
					id,
					name: typeof model.display_name === "string" ? model.display_name : undefined,
					defaultThinkingLevel:
						model.default_reasoning_level === "low" ||
						model.default_reasoning_level === "medium" ||
						model.default_reasoning_level === "high" ||
						model.default_reasoning_level === "xhigh"
							? model.default_reasoning_level
							: undefined,
					supportedThinkingLevels: supportedThinkingLevels.length ? supportedThinkingLevels : ["low", "medium", "high", "xhigh"],
					description: typeof model.description === "string" ? model.description : undefined,
				}];
			});
		return models.length ? models : FALLBACK_CODEX_MODELS;
	} catch {
		return FALLBACK_CODEX_MODELS;
	}
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
		codexModels: loadCodexModelCatalog(),
	};
}

export async function checkCodexEnvironmentForDesktop(): Promise<DesktopCodexDiagnostic> {
	try {
		return await checkCodexAppServerEnvironment();
	} catch (error) {
		const homeDir = join(homedir(), ".pie", "diagnostics", "codex");
		mkdirSync(homeDir, { recursive: true });
		const diagnostic = await (codexCliAgentBackendAdapter.checkEnvironment?.({
			backendKind: "codex",
			backendConfig: {},
			homeDir,
			modelId: "gpt-5.5",
			thinkingLevel: "medium",
			tools: [],
			debug: false,
			verboseLogs: false,
			resumeSessions: false,
		}) ?? Promise.resolve({
			installed: false,
			authenticated: false,
			error: "Codex adapter has no environment diagnostic.",
			loginCommand: ["codex", "login"],
		}));
		return {
			...diagnostic,
			error: diagnostic.authenticated ? undefined : diagnostic.error || (error instanceof Error ? error.message : String(error)),
		};
	}
}

let codexLoginPromise: Promise<DesktopCodexDiagnostic> | undefined;

function extractCodexLoginUrl(text: string): string | undefined {
	const cleanText = text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
	return cleanText.match(/https:\/\/auth\.openai\.com\/oauth\/authorize\?[^\s"'<>]+/)?.[0];
}

export async function openCodexLoginForDesktop(
	sessionId: string,
	emit: EmitOnboardEvent,
	openUrl: (url: string) => Promise<unknown>,
): Promise<DesktopCodexDiagnostic> {
	if (codexLoginPromise) {
		emit({ sessionId, type: "status", source: "codex-login", message: "Codex 登录流程已打开，请在浏览器中完成授权。" });
		return codexLoginPromise;
	}
	codexLoginPromise = openCodexLoginWithAppServerForDesktop(sessionId, emit, openUrl)
		.catch((error) => {
			emit({
				sessionId,
				type: "status",
				source: "codex-login",
				message: `Codex app-server 登录不可用，已切换到 CLI 登录：${error instanceof Error ? error.message : String(error)}`,
			});
			return openCodexLoginWithCliForDesktop(sessionId, emit, openUrl);
		})
		.finally(() => {
			codexLoginPromise = undefined;
		});
	return codexLoginPromise;
}

async function openCodexLoginWithAppServerForDesktop(
	sessionId: string,
	emit: EmitOnboardEvent,
	openUrl: (url: string) => Promise<unknown>,
): Promise<DesktopCodexDiagnostic> {
	emit({ sessionId, type: "status", source: "codex-login", message: "正在通过 Codex app-server 准备登录..." });
	return loginCodexWithAppServer({
		onAuthUrl: async (url) => {
			emit({ sessionId, type: "status", source: "codex-login", message: "浏览器已打开，请完成 OpenAI 授权。", url });
			await openUrl(url);
		},
		onCompleted: (completion) => {
			emit({
				sessionId,
				type: completion.success ? "done" : "error",
				source: "codex-login",
				message: completion.success ? "Codex 已登录。" : completion.error || "Codex 登录未完成。",
			});
		},
	});
}

function openCodexLoginWithCliForDesktop(
	sessionId: string,
	emit: EmitOnboardEvent,
	openUrl: (url: string) => Promise<unknown>,
): Promise<DesktopCodexDiagnostic> {
	const shell = process.env.SHELL?.trim() || "/bin/zsh";
	return new Promise<DesktopCodexDiagnostic>((resolvePromise, reject) => {
		let output = "";
		let openedUrl = false;
		emit({ sessionId, type: "status", source: "codex-login", message: "正在打开 Codex 登录..." });
		const child = spawn(shell, ["-lc", "codex login"], {
			stdio: ["ignore", "pipe", "pipe"],
			env: process.env,
		});
		const handleOutput = (chunk: Buffer) => {
			const text = chunk.toString("utf8");
			output += text;
			const url = extractCodexLoginUrl(output);
			if (url && !openedUrl) {
				openedUrl = true;
				emit({ sessionId, type: "status", source: "codex-login", message: "浏览器已打开，请完成 OpenAI 授权。", url });
				void openUrl(url).catch((error) => {
					emit({
						sessionId,
						type: "error",
						source: "codex-login",
						message: `无法打开浏览器：${error instanceof Error ? error.message : String(error)}`,
					});
				});
			}
		};
		child.stdout.on("data", handleOutput);
		child.stderr.on("data", handleOutput);
		child.on("error", (error) => {
			reject(error);
		});
		child.on("close", (code) => {
			void checkCodexEnvironmentForDesktop()
				.then((diagnostic) => {
					if (diagnostic.authenticated) {
						emit({ sessionId, type: "done", source: "codex-login", message: "Codex 已登录。" });
						resolvePromise(diagnostic);
						return;
					}
					const message = output.trim() || diagnostic.error || `codex login exited with code ${String(code)}`;
					emit({ sessionId, type: "error", source: "codex-login", message });
					resolvePromise(diagnostic);
				})
				.catch(reject);
		});
	});
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

export async function createWechatLoginForSession(
	sessionId: string,
	emit: EmitOnboardEvent,
): Promise<DesktopWechatCredentials> {
	const homeDir = getProfileHomeDir(sessionId);
	try {
		emit({ sessionId, type: "status", source: "wechat", message: "正在准备微信扫码授权..." });
		let qr = await fetchLoginQr({
			baseUrl: DEFAULT_WECHAT_BASE_URL,
			botType: WECHAT_BOT_TYPE,
		});
		let scanned = false;
		const deadline = Date.now() + WECHAT_LOGIN_TIMEOUT_MS;
		const emitQr = async (message: string) => {
			emit({
				sessionId,
				type: "qr",
				source: "wechat",
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
					emit({ sessionId, type: "status", source: "wechat", message: "已扫码，请在微信里继续确认..." });
					scanned = true;
				}
				continue;
			}
			if (status.status === "scaned_but_redirect") {
				emit({ sessionId, type: "status", source: "wechat", message: "微信扫码已跳转，请继续等待确认..." });
				continue;
			}
			if (status.status === "expired") {
				throw new Error("微信二维码已失效，请刷新二维码。");
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
				emit({ sessionId, type: "done", source: "wechat", message: "微信已连接", wechat });
				return wechat;
			}
		}
		throw new Error("微信登录超时，请重新开始创建。");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		emit({ sessionId, type: "error", source: "wechat", message });
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

	const codexModels = draft.framework === "codex" ? loadCodexModelCatalog() : [];
	const provider = draft.framework === "codex" ? "codex-cli" : draft.provider.trim();
	const requestedModel = draft.model.trim();
	const model =
		draft.framework === "codex"
			? codexModels.find((item) => item.id === requestedModel)?.id ?? codexModels[0]?.id ?? "gpt-5.5"
			: requestedModel;
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
			...(draft.framework === "codex"
				? {
						config: {
							sandboxMode: draft.codexSandboxMode ?? "danger-full-access",
							webSearchMode: draft.codexWebSearchMode ?? "cached",
						},
					}
				: {}),
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
		desiredState: "paused",
		selected: true,
	});
}
