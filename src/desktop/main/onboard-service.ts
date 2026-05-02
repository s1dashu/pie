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
		emit({ sessionId, type: "done", message: `已创建 ${feishu.brand === "lark" ? "Lark" : "飞书"} 应用 ${feishu.appId}`, feishu });
		return feishu;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		emit({ sessionId, type: "error", message });
		throw error;
	}
}

export function completeAgentCreation(draft: AgentCreationDraft): void {
	const profileId = draft.sessionId;
	const homeDir = getProfileHomeDir(profileId);
	if (!draft.feishu.appId.trim() || !draft.feishu.appSecret.trim()) {
		throw new Error("飞书 App ID 和 App Secret 必填");
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
		feishu: {
			kind: "feishu",
			id: "feishu",
			enabled: true,
			appId: draft.feishu.appId.trim(),
			brand: draft.feishu.brand,
		},
		model: {
			provider,
			model,
			thinkingLevel: draft.thinkingLevel as ThinkingLevel,
			tools: exModel?.tools ?? "coding",
			debug: exModel?.debug ?? false,
			resumeSessions: true,
			outputToolCallsToIm: true,
		},
	});

	saveConfigStore(setStoredProfile(store, profile), homeDir);
	const savedEnv: Record<string, string> = {
		FEISHU_APP_SECRET: draft.feishu.appSecret.trim(),
	};
	const envKey = getProviderCredentialEnv(provider);
	if (envKey && apiKey) {
		savedEnv[envKey] = apiKey;
	}
	upsertAgentEnv(savedEnv, homeDir);
	registerProfileHome(profileId, {
		displayName: draft.name?.trim() || profileId,
		enabled: false,
		active: true,
	});
}
