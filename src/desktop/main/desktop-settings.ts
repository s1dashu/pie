import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getDefaultPieRootDir } from "../../core/profile-registry.js";
import type { DesktopColorScheme, DesktopSettings, DesktopSettingsDraft, DesktopLogRetention } from "../shared/types.js";

const SETTINGS_FILE = "desktop-settings.json";

const DEFAULT_SETTINGS: DesktopSettings = {
	language: "zh",
	colorScheme: "system",
	quitTerminatesAgents: true,
	restoreRunningAgentsOnLaunch: true,
	openAtLogin: false,
	keepAwakeWhileOpen: false,
	runtimeLogRetention: "30d",
	usageEventRetention: "90d",
};

const LOG_RETENTIONS = new Set<DesktopLogRetention>(["7d", "30d", "90d", "forever"]);
const COLOR_SCHEMES = new Set<DesktopColorScheme>(["system", "light", "dark"]);

export function getDesktopSettingsPath(rootDir: string = getDefaultPieRootDir()): string {
	return join(rootDir, SETTINGS_FILE);
}

export function retentionToDays(retention: DesktopLogRetention): number | undefined {
	if (retention === "forever") {
		return undefined;
	}
	return Number.parseInt(retention, 10);
}

export function readDesktopSettings(rootDir: string = getDefaultPieRootDir()): DesktopSettings {
	const fallback: DesktopSettings = { ...DEFAULT_SETTINGS };
	const path = getDesktopSettingsPath(rootDir);
	if (!existsSync(path)) {
		return fallback;
	}
	try {
		const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<DesktopSettings>;
		return normalizeDesktopSettings(raw);
	} catch {
		return fallback;
	}
}

export function writeDesktopSettings(settings: DesktopSettings, rootDir: string = getDefaultPieRootDir()): DesktopSettings {
	const path = getDesktopSettingsPath(rootDir);
	const normalized = normalizeDesktopSettings(settings);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
	try {
		chmodSync(path, 0o600);
	} catch {
		// Best-effort; unsupported on some filesystems.
	}
	return normalized;
}

export function updateDesktopSettings(draft: DesktopSettingsDraft, rootDir: string = getDefaultPieRootDir()): DesktopSettings {
	return writeDesktopSettings({ ...readDesktopSettings(rootDir), ...draft }, rootDir);
}

function normalizeDesktopSettings(raw: Partial<DesktopSettings>): DesktopSettings {
	return {
		language: raw.language === "en" ? "en" : "zh",
		colorScheme: isColorScheme(raw.colorScheme) ? raw.colorScheme : DEFAULT_SETTINGS.colorScheme,
		quitTerminatesAgents: typeof raw.quitTerminatesAgents === "boolean" ? raw.quitTerminatesAgents : DEFAULT_SETTINGS.quitTerminatesAgents,
		restoreRunningAgentsOnLaunch:
			typeof raw.restoreRunningAgentsOnLaunch === "boolean"
				? raw.restoreRunningAgentsOnLaunch
				: DEFAULT_SETTINGS.restoreRunningAgentsOnLaunch,
		openAtLogin: typeof raw.openAtLogin === "boolean" ? raw.openAtLogin : DEFAULT_SETTINGS.openAtLogin,
		keepAwakeWhileOpen:
			typeof raw.keepAwakeWhileOpen === "boolean"
				? raw.keepAwakeWhileOpen
				: DEFAULT_SETTINGS.keepAwakeWhileOpen,
		runtimeLogRetention: isLogRetention(raw.runtimeLogRetention) ? raw.runtimeLogRetention : DEFAULT_SETTINGS.runtimeLogRetention,
		usageEventRetention: isLogRetention(raw.usageEventRetention) ? raw.usageEventRetention : DEFAULT_SETTINGS.usageEventRetention,
		appearanceGrayHue: normalizeHue(raw.appearanceGrayHue),
	};
}

function isLogRetention(value: unknown): value is DesktopLogRetention {
	return typeof value === "string" && LOG_RETENTIONS.has(value as DesktopLogRetention);
}

function isColorScheme(value: unknown): value is DesktopColorScheme {
	return typeof value === "string" && COLOR_SCHEMES.has(value as DesktopColorScheme);
}

function normalizeHue(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return undefined;
	}
	return Math.round(((value % 360) + 360) % 360);
}
