import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	expandUserHomePath,
	getDefaultPieRootDir,
	getProfilesDir,
	resolveAgentHomeDir,
} from "./agent-home.js";

export interface PieProfileRegistryEntry {
	enabled: boolean;
	displayName: string;
	home: string;
	createdAt?: string;
	updatedAt?: string;
}

export interface PieProfileRegistry {
	version: 1;
	activeProfile?: string;
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
	const value = raw as Partial<PieProfileRegistry>;
	const profiles =
		value.profiles && typeof value.profiles === "object" && !Array.isArray(value.profiles)
			? value.profiles
			: {};
	return {
		version: 1,
		activeProfile: typeof value.activeProfile === "string" ? value.activeProfile : undefined,
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
		enabled?: boolean;
		active?: boolean;
	},
): PieProfileRegistry {
	const rootDir = options?.rootDir ?? getDefaultPieRootDir();
	const registry = loadProfileRegistry(rootDir);
	const now = new Date().toISOString();
	registry.profiles[profileId] = {
		enabled: options?.enabled ?? true,
		displayName: options?.displayName ?? profileId,
		home: `profiles/${profileId}`,
		createdAt: registry.profiles[profileId]?.createdAt ?? now,
		updatedAt: now,
	};
	if (options?.active ?? !registry.activeProfile) {
		registry.activeProfile = profileId;
	}
	saveProfileRegistry(registry, rootDir);
	return registry;
}

export function updateProfileRegistryEntry(
	profileId: string,
	updates: {
		rootDir?: string;
		displayName?: string;
		enabled?: boolean;
		active?: boolean;
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
		...(updates.enabled !== undefined ? { enabled: updates.enabled } : {}),
		updatedAt: new Date().toISOString(),
	};
	if (updates.active) {
		registry.activeProfile = profileId;
	}
	saveProfileRegistry(registry, rootDir);
	return registry;
}

export function deleteProfileRegistryEntry(profileId: string, rootDir: string = getDefaultPieRootDir()): PieProfileRegistry {
	const registry = loadProfileRegistry(rootDir);
	delete registry.profiles[profileId];
	if (registry.activeProfile === profileId) {
		registry.activeProfile = Object.keys(registry.profiles).sort((left, right) => left.localeCompare(right))[0];
	}
	saveProfileRegistry(registry, rootDir);
	return registry;
}

export function resolveActiveProfileHomeDir(rootDir: string = getDefaultPieRootDir()): string | undefined {
	const registry = loadProfileRegistry(rootDir);
	const active = registry.activeProfile;
	if (!active) {
		return undefined;
	}
	const entry = registry.profiles[active];
	if (!entry?.home) {
		return undefined;
	}
	return expandUserHomePath(join(rootDir, entry.home));
}

export function resolveDefaultRuntimeHomeDir(): string {
	if (process.env.PIE_AGENT_HOME?.trim()) {
		return resolveAgentHomeDir();
	}
	const activeHome = resolveActiveProfileHomeDir();
	return activeHome ?? resolveAgentHomeDir();
}
