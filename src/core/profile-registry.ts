import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	expandUserHomePath,
	getDefaultPieRootDir,
	getProfilesDir,
	resolveAgentHomeDir,
} from "./agent-home.js";

export type PieProfileDesiredState = "running" | "paused";

export interface PieProfileRegistryEntry {
	desiredState: PieProfileDesiredState;
	displayName: string;
	home: string;
	createdAt?: string;
	updatedAt?: string;
}

export interface PieProfileRegistry {
	version: 1;
	selectedProfile?: string;
	profiles: Record<string, PieProfileRegistryEntry>;
}

const DEFAULT_REGISTRY: PieProfileRegistry = {
	version: 1,
	profiles: {},
};

const BOT_ID_WORDS = [
	"amber",
	"atlas",
	"basil",
	"cedar",
	"comet",
	"coral",
	"delta",
	"ember",
	"fable",
	"harbor",
	"lumen",
	"maple",
	"nova",
	"orbit",
	"pixel",
	"quartz",
	"river",
	"signal",
	"tempo",
	"vector",
] as const;

function randomHex(bytes = 2): string {
	return randomBytes(bytes).toString("hex");
}

function normalizeRegistry(raw: unknown): PieProfileRegistry {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return DEFAULT_REGISTRY;
	}
	const value = raw as Partial<PieProfileRegistry> & Record<string, unknown>;
	const rawProfiles =
		value.profiles && typeof value.profiles === "object" && !Array.isArray(value.profiles)
			? value.profiles
			: {};
	const profiles = Object.fromEntries(
		Object.entries(rawProfiles).flatMap(([profileId, entry]) => {
			if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
				return [];
			}
			const typedEntry = entry as Partial<PieProfileRegistryEntry> & Record<string, unknown>;
			const desiredState = typedEntry.desiredState === "running" || typedEntry.desiredState === "paused"
				? typedEntry.desiredState
				: typeof typedEntry.autoStart === "boolean"
					? typedEntry.autoStart ? "running" : "paused"
					: typeof typedEntry["enabled"] === "boolean"
						? typedEntry["enabled"] ? "running" : "paused"
						: "running";
			return [[profileId, {
				desiredState,
				displayName: typeof typedEntry.displayName === "string" ? typedEntry.displayName : profileId,
				home: typeof typedEntry.home === "string" ? typedEntry.home : `profiles/${profileId}`,
				...(typeof typedEntry.createdAt === "string" ? { createdAt: typedEntry.createdAt } : {}),
				...(typeof typedEntry.updatedAt === "string" ? { updatedAt: typedEntry.updatedAt } : {}),
			} satisfies PieProfileRegistryEntry]];
		}),
	);
	return {
		version: 1,
		selectedProfile:
			typeof value.selectedProfile === "string"
				? value.selectedProfile
				: typeof value["activeProfile"] === "string"
					? value["activeProfile"]
					: undefined,
		profiles,
	};
}

export function getProfileRegistryPath(rootDir: string = getDefaultPieRootDir()): string {
	return join(rootDir, "profiles.json");
}

export function loadProfileRegistry(rootDir: string = getDefaultPieRootDir()): PieProfileRegistry {
	const path = getProfileRegistryPath(rootDir);
	if (!existsSync(path)) {
		return DEFAULT_REGISTRY;
	}
	const raw = readFileSync(path, "utf8").trim();
	if (!raw) {
		return DEFAULT_REGISTRY;
	}
	return normalizeRegistry(JSON.parse(raw));
}

export function saveProfileRegistry(registry: PieProfileRegistry, rootDir: string = getDefaultPieRootDir()): void {
	const path = getProfileRegistryPath(rootDir);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
	try {
		chmodSync(path, 0o600);
	} catch {
		// Best-effort; unsupported on some filesystems.
	}
}

function randomLowercaseString(length = 6): string {
	const chars = "abcdefghijklmnopqrstuvwxyz";
	let result = "";
	for (let i = 0; i < length; i++) {
		result += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return result;
}

export function generateBotProfileId(registry: PieProfileRegistry): string {
	for (let i = 0; i < 100; i++) {
		const candidate = `bot-${randomLowercaseString(6)}`;
		if (!registry.profiles[candidate]) {
			return candidate;
		}
	}
	const fallback = `bot-${Date.now().toString(36)}-${randomLowercaseString(4)}`;
	if (!registry.profiles[fallback]) {
		return fallback;
	}
	throw new Error("Failed to generate a unique bot profile id");
}

export function getProfileHomeDir(profileId: string, rootDir: string = getDefaultPieRootDir()): string {
	return join(getProfilesDir(rootDir), profileId);
}

export { getDefaultPieRootDir };

export function registerProfileHome(
	profileId: string,
	options?: {
		rootDir?: string;
		displayName?: string;
		desiredState?: PieProfileDesiredState;
		selected?: boolean;
	},
): PieProfileRegistry {
	const rootDir = options?.rootDir ?? getDefaultPieRootDir();
	const registry = loadProfileRegistry(rootDir);
	const now = new Date().toISOString();
	registry.profiles[profileId] = {
		desiredState: options?.desiredState ?? "running",
		displayName: options?.displayName ?? profileId,
		home: `profiles/${profileId}`,
		createdAt: registry.profiles[profileId]?.createdAt ?? now,
		updatedAt: now,
	};
	if (options?.selected ?? !registry.selectedProfile) {
		registry.selectedProfile = profileId;
	}
	saveProfileRegistry(registry, rootDir);
	return registry;
}

export function updateProfileRegistryEntry(
	profileId: string,
	updates: {
		rootDir?: string;
		displayName?: string;
		desiredState?: PieProfileDesiredState;
		selected?: boolean;
	},
): PieProfileRegistry {
	const rootDir = updates.rootDir ?? getDefaultPieRootDir();
	const registry = loadProfileRegistry(rootDir);
	const current = registry.profiles[profileId];
	if (!current) {
		throw new Error(`Unknown profile: ${profileId}`);
	}
	registry.profiles[profileId] = {
		...current,
		...(updates.displayName !== undefined ? { displayName: updates.displayName } : {}),
		...(updates.desiredState !== undefined ? { desiredState: updates.desiredState } : {}),
		updatedAt: new Date().toISOString(),
	};
	if (updates.selected) {
		registry.selectedProfile = profileId;
	}
	saveProfileRegistry(registry, rootDir);
	return registry;
}

export function deleteProfileRegistryEntry(profileId: string, rootDir: string = getDefaultPieRootDir()): PieProfileRegistry {
	const registry = loadProfileRegistry(rootDir);
	delete registry.profiles[profileId];
	if (registry.selectedProfile === profileId) {
		registry.selectedProfile = Object.keys(registry.profiles).sort((left, right) => left.localeCompare(right))[0];
	}
	saveProfileRegistry(registry, rootDir);
	return registry;
}

export function resolveSelectedProfileHomeDir(rootDir: string = getDefaultPieRootDir()): string | undefined {
	const registry = loadProfileRegistry(rootDir);
	const selected = registry.selectedProfile;
	if (!selected) {
		return undefined;
	}
	const entry = registry.profiles[selected];
	if (!entry?.home) {
		return undefined;
	}
	return expandUserHomePath(join(rootDir, entry.home));
}

export function resolveDefaultRuntimeHomeDir(): string {
	if (process.env.PIE_AGENT_HOME?.trim()) {
		return resolveAgentHomeDir();
	}
	const selectedHome = resolveSelectedProfileHomeDir();
	return selectedHome ?? resolveAgentHomeDir();
}
