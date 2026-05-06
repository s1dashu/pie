import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	OPENCLAW_BUILT_IN_MODEL_OPTIONS,
	OPENCLAW_LEGACY_MODEL_REF_ALIASES,
	findOpenClawBuiltInModel,
	findOpenClawBuiltInModelByBareId,
	findOpenClawBuiltInModelByRef,
} from "../core/openclaw-model-catalog.js";

type JsonObject = Record<string, unknown>;

const OPENCLAW_CONFIG_FILE = "openclaw.json";
const DEFAULT_OPENCLAW_GATEWAY_URL = "ws://127.0.0.1:18789";
const OPENCLAW_WORKSPACE_STATE_DIR = ".openclaw";
const OPENCLAW_WORKSPACE_STATE_FILE = "workspace-state.json";
const OPENCLAW_BOOTSTRAP_FILE = "BOOTSTRAP.md";

const OPENCLAW_PROVIDER_STATE_SEEDS: Record<string, JsonObject> = {
	"kimi-coding": {
		api: "anthropic-messages",
		baseUrl: "https://api.kimi.com/coding/",
		apiKey: "KIMI_API_KEY",
	},
};

function isObject(value: unknown): value is JsonObject {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readJsonObject(path: string): JsonObject {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		return isObject(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

function writeJsonObject(path: string, value: JsonObject): void {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizePart(value: string | undefined): string {
	return value?.trim() ?? "";
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string") {
		const parsed = Number.parseInt(value, 10);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

function asGatewayUrl(value: string | undefined): string | undefined {
	const raw = value?.trim();
	if (!raw) {
		return undefined;
	}
	if (raw.startsWith("http://")) {
		return `ws://${raw.slice("http://".length).replace(/\/+$/, "")}`;
	}
	if (raw.startsWith("https://")) {
		return `wss://${raw.slice("https://".length).replace(/\/+$/, "")}`;
	}
	return raw.replace(/\/+$/, "");
}

function gatewayUrlFromOpenClawConfig(openClawJson: JsonObject): string | undefined {
	const gateway = isObject(openClawJson.gateway) ? openClawJson.gateway : {};
	const explicitUrl = asGatewayUrl(readString(gateway.url) ?? readString(gateway.gatewayUrl));
	if (explicitUrl) {
		return explicitUrl;
	}
	const port = readNumber(gateway.port) ?? 18789;
	const host = readString(gateway.host) ?? readString(gateway.hostname) ?? "127.0.0.1";
	return `ws://${host}:${port}`;
}

export interface OpenClawGatewaySettings {
	stateDir: string;
	configPath: string;
	gatewayUrl: string;
	authMode?: string;
	token?: string;
	password?: string;
}

export function resolveOpenClawStateDir(stateDir?: string): string {
	return normalizePart(stateDir) || process.env.OPENCLAW_STATE_DIR?.trim() || join(homedir(), ".openclaw");
}

export function resolveOpenClawConfigPath(options: { stateDir?: string; configPath?: string } = {}): string {
	return normalizePart(options.configPath) ||
		process.env.OPENCLAW_CONFIG_PATH?.trim() ||
		join(resolveOpenClawStateDir(options.stateDir), OPENCLAW_CONFIG_FILE);
}

export function readOpenClawGatewaySettings(options: {
	stateDir?: string;
	configPath?: string;
	gatewayUrl?: string;
} = {}): OpenClawGatewaySettings {
	const stateDir = resolveOpenClawStateDir(options.stateDir);
	const configPath = resolveOpenClawConfigPath({ stateDir, configPath: options.configPath });
	const openClawJson = readJsonObject(configPath);
	const gateway = isObject(openClawJson.gateway) ? openClawJson.gateway : {};
	const auth = isObject(gateway.auth) ? gateway.auth : {};
	const authMode = readString(auth.mode);
	return {
		stateDir,
		configPath,
		gatewayUrl: asGatewayUrl(options.gatewayUrl) ?? gatewayUrlFromOpenClawConfig(openClawJson) ?? DEFAULT_OPENCLAW_GATEWAY_URL,
		...(authMode ? { authMode } : {}),
		...(readString(auth.token) ? { token: readString(auth.token) } : {}),
		...(readString(auth.password) ? { password: readString(auth.password) } : {}),
	};
}

export function toOpenClawModelRef(provider: string | undefined, model: string | undefined): string | undefined {
	const cleanProvider = normalizePart(provider);
	const cleanModel = normalizePart(model);
	if (!cleanModel) {
		return undefined;
	}
	const builtInModel = findOpenClawBuiltInModel(cleanProvider, cleanModel);
	if (builtInModel) {
		return builtInModel.modelRef;
	}
	if (!cleanProvider) {
		return normalizeOpenClawModelRef(cleanModel);
	}
	return `${cleanProvider}/${cleanModel}`;
}

export function normalizeOpenClawModelRef(modelRef: string | undefined): string | undefined {
	const cleanRef = normalizePart(modelRef);
	if (!cleanRef) {
		return undefined;
	}
	const legacyRef = OPENCLAW_LEGACY_MODEL_REF_ALIASES[cleanRef];
	if (legacyRef) {
		return legacyRef;
	}
	const builtInRef = findOpenClawBuiltInModelByRef(cleanRef);
	if (builtInRef) {
		return builtInRef.modelRef;
	}
	const [provider, ...modelParts] = cleanRef.split("/");
	if (modelParts.length === 0) {
		return findOpenClawBuiltInModelByBareId(cleanRef)?.modelRef ?? cleanRef;
	}
	const model = modelParts.join("/");
	return toOpenClawModelRef(provider, model);
}

function toOpenClawModelJson(item: typeof OPENCLAW_BUILT_IN_MODEL_OPTIONS[number]): JsonObject {
	return {
		id: item.id,
		name: item.name,
		...(typeof item.reasoning === "boolean" ? { reasoning: item.reasoning } : {}),
		...(typeof item.contextWindow === "number" ? { contextWindow: item.contextWindow } : {}),
		...(typeof item.maxTokens === "number" ? { maxTokens: item.maxTokens } : {}),
		...(item.input ? { input: item.input } : {}),
	};
}

function upsertBuiltInProviderModels(modelsJson: JsonObject): void {
	const providers = isObject(modelsJson.providers) ? modelsJson.providers : {};
	const byProvider = new Map<string, typeof OPENCLAW_BUILT_IN_MODEL_OPTIONS>();
	for (const item of OPENCLAW_BUILT_IN_MODEL_OPTIONS) {
		const list = byProvider.get(item.provider) ?? [];
		byProvider.set(item.provider, [...list, item]);
	}
	for (const [providerId, models] of byProvider) {
		const existing = isObject(providers[providerId]) ? providers[providerId] : OPENCLAW_PROVIDER_STATE_SEEDS[providerId];
		if (!existing) {
			continue;
		}
		const existingModels = Array.isArray(existing.models) ? existing.models : [];
		const byId = new Map<string, unknown>();
		for (const item of existingModels) {
			if (isObject(item) && typeof item.id === "string") {
				byId.set(item.id, item);
			}
		}
		for (const item of models) {
			const modelJson = toOpenClawModelJson(item);
			byId.set(item.id, { ...modelJson, ...(isObject(byId.get(item.id)) ? byId.get(item.id) as JsonObject : {}) });
		}
		providers[providerId] = {
			...existing,
			models: [...byId.values()],
		};
	}
	modelsJson.providers = providers;
}

function isOpenClawConfigSnapshotFile(fileName: string): boolean {
	return (
		fileName === OPENCLAW_CONFIG_FILE ||
		fileName === `${OPENCLAW_CONFIG_FILE}.last-good` ||
		fileName === `${OPENCLAW_CONFIG_FILE}.bak` ||
		fileName.startsWith(`${OPENCLAW_CONFIG_FILE}.bak.`)
	);
}

function getOpenClawConfigSnapshotPaths(stateDir: string): string[] {
	try {
		const paths = readdirSync(stateDir)
			.filter(isOpenClawConfigSnapshotFile)
			.map((fileName) => join(stateDir, fileName));
		return paths.length ? paths : [join(stateDir, OPENCLAW_CONFIG_FILE)];
	} catch {
		return [join(stateDir, OPENCLAW_CONFIG_FILE)];
	}
}

function normalizeModelList(value: unknown): unknown {
	if (!Array.isArray(value)) {
		return value;
	}
	return value.map((item) => (typeof item === "string" ? normalizeOpenClawModelRef(item) ?? item : item));
}

function normalizeModelConfigValue(value: unknown): unknown {
	if (typeof value === "string") {
		return normalizeOpenClawModelRef(value) ?? value;
	}
	if (!isObject(value)) {
		return value;
	}
	const primary = typeof value.primary === "string" ? normalizeOpenClawModelRef(value.primary) ?? value.primary : value.primary;
	return {
		...value,
		...(primary !== undefined ? { primary } : {}),
		...(value.fallbacks !== undefined ? { fallbacks: normalizeModelList(value.fallbacks) } : {}),
	};
}

function normalizeModelAllowlist(models: JsonObject): void {
	for (const key of Object.keys(models)) {
		const normalizedKey = normalizeOpenClawModelRef(key);
		if (normalizedKey && normalizedKey !== key) {
			if (!isObject(models[normalizedKey])) {
				models[normalizedKey] = isObject(models[key]) ? models[key] : {};
			}
			delete models[key];
		}
	}
	for (const item of OPENCLAW_BUILT_IN_MODEL_OPTIONS) {
		if (item.id !== item.modelRef) {
			delete models[item.id];
		}
	}
}

function normalizeOpenClawAgentModels(openClawJson: JsonObject): void {
	const agents = isObject(openClawJson.agents) ? openClawJson.agents : {};
	const defaults = isObject(agents.defaults) ? agents.defaults : {};
	const models = isObject(defaults.models) ? defaults.models : {};
	defaults.model = normalizeModelConfigValue(defaults.model);
	if (defaults.imageModel !== undefined) {
		defaults.imageModel = normalizeModelConfigValue(defaults.imageModel);
	}
	if (isObject(defaults.subagents)) {
		defaults.subagents.model = normalizeModelConfigValue(defaults.subagents.model);
	}
	normalizeModelAllowlist(models);
	defaults.models = models;
	agents.defaults = defaults;

	if (Array.isArray(agents.list)) {
		agents.list = agents.list.map((agent) => {
			if (!isObject(agent)) {
				return agent;
			}
			return {
				...agent,
				...(agent.model !== undefined ? { model: normalizeModelConfigValue(agent.model) } : {}),
				...(agent.imageModel !== undefined ? { imageModel: normalizeModelConfigValue(agent.imageModel) } : {}),
			};
		});
	}

	openClawJson.agents = agents;
}

function setOpenClawDefaultModel(openClawJson: JsonObject, modelRef: string): void {
	const modelProviders = isObject(openClawJson.models) ? openClawJson.models : {};
	upsertBuiltInProviderModels(modelProviders);
	openClawJson.models = modelProviders;

	const agents = isObject(openClawJson.agents) ? openClawJson.agents : {};
	const defaults = isObject(agents.defaults) ? agents.defaults : {};
	const model = isObject(defaults.model) ? defaults.model : {};
	const models = isObject(defaults.models) ? defaults.models : {};
	normalizeOpenClawAgentModels(openClawJson);
	normalizeModelAllowlist(models);
	model.primary = modelRef;
	models[modelRef] = isObject(models[modelRef]) ? models[modelRef] : {};
	defaults.model = model;
	defaults.models = models;
	agents.defaults = defaults;
	openClawJson.agents = agents;
}

export function ensureOpenClawModelState(stateDir: string, modelRef: string | undefined): void {
	const normalizedModelRef = normalizeOpenClawModelRef(modelRef);
	mkdirSync(join(stateDir, "agents", "main", "agent"), { recursive: true });

	const modelsPath = join(stateDir, "agents", "main", "agent", "models.json");
	const modelsJson = readJsonObject(modelsPath);
	upsertBuiltInProviderModels(modelsJson);
	writeJsonObject(modelsPath, modelsJson);

	if (!normalizedModelRef) {
		return;
	}
	for (const openClawConfigPath of getOpenClawConfigSnapshotPaths(stateDir)) {
		const openClawJson = readJsonObject(openClawConfigPath);
		setOpenClawDefaultModel(openClawJson, normalizedModelRef);
		writeJsonObject(openClawConfigPath, openClawJson);
	}
}

export function getOpenClawAgentIdForPieProfile(profileId: string): string {
	const safe = profileId.trim().replace(/[^a-zA-Z0-9._:-]/g, "-").replace(/^-+|-+$/g, "");
	return `pie-${safe || "profile"}`;
}

export function ensureOpenClawAgentProfile(options: {
	stateDir: string;
	profileId: string;
	homeDir: string;
	workDir: string;
	modelRef?: string;
}): { agentId: string; agentDir: string; workspace: string; modelRef?: string } {
	const agentId = getOpenClawAgentIdForPieProfile(options.profileId);
	const agentDir = join(options.homeDir, "openclaw", "agent");
	const workspace = options.workDir;
	const modelRef = normalizeOpenClawModelRef(options.modelRef);
	mkdirSync(options.stateDir, { recursive: true });
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(join(options.stateDir, "agents", agentId, "sessions"), { recursive: true });
	mkdirSync(workspace, { recursive: true });
	ensurePieOpenClawWorkspaceSetupComplete(workspace);

	for (const openClawConfigPath of getOpenClawConfigSnapshotPaths(options.stateDir)) {
		const openClawJson = readJsonObject(openClawConfigPath);
		if (modelRef) {
			const modelProviders = isObject(openClawJson.models) ? openClawJson.models : {};
			upsertBuiltInProviderModels(modelProviders);
			openClawJson.models = modelProviders;
		}
		const agents = isObject(openClawJson.agents) ? openClawJson.agents : {};
		const list = Array.isArray(agents.list) ? agents.list.filter(isObject) : [];
		const nextAgent = {
			...(list.find((agent) => agent.id === agentId) ?? {}),
			id: agentId,
			workspace,
			agentDir,
			...(modelRef ? { model: modelRef } : {}),
		};
		agents.list = [
			...list.filter((agent) => agent.id !== agentId),
			nextAgent,
		];
		openClawJson.agents = agents;
		writeJsonObject(openClawConfigPath, openClawJson);
	}

	const modelsPath = join(agentDir, "models.json");
	const modelsJson = readJsonObject(modelsPath);
	upsertBuiltInProviderModels(modelsJson);
	writeJsonObject(modelsPath, modelsJson);
	return { agentId, agentDir, workspace, ...(modelRef ? { modelRef } : {}) };
}

function ensurePieOpenClawWorkspaceSetupComplete(workspace: string): void {
	const stateDir = join(workspace, OPENCLAW_WORKSPACE_STATE_DIR);
	mkdirSync(stateDir, { recursive: true });
	const statePath = join(stateDir, OPENCLAW_WORKSPACE_STATE_FILE);
	const existingState = readJsonObject(statePath);
	const completedAt = readString(existingState.setupCompletedAt) ?? new Date().toISOString();
	const nextState = {
		...existingState,
		version: 1,
		bootstrapSeededAt: readString(existingState.bootstrapSeededAt) ?? completedAt,
		setupCompletedAt: completedAt,
	};
	writeJsonObjectAtomic(statePath, nextState);

	const bootstrapPath = join(workspace, OPENCLAW_BOOTSTRAP_FILE);
	if (isOpenClawDefaultBootstrapFile(bootstrapPath)) {
		rmSync(bootstrapPath, { force: true });
	}
}

function writeJsonObjectAtomic(path: string, value: JsonObject): void {
	const tmpPath = `${path}.tmp-${process.pid}-${Date.now().toString(36)}`;
	writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
	renameSync(tmpPath, path);
}

function isOpenClawDefaultBootstrapFile(path: string): boolean {
	try {
		const content = readFileSync(path, "utf8");
		return content.includes("# BOOTSTRAP.md - Hello, World") &&
			content.includes("You just woke up") &&
			content.includes("Delete this file");
	} catch {
		return false;
	}
}
