import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
		return readdirSync(stateDir)
			.filter(isOpenClawConfigSnapshotFile)
			.map((fileName) => join(stateDir, fileName));
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
