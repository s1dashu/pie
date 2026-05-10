import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ensureOpenClawAgentProfile, readOpenClawGatewaySettings, resolveOpenClawStateDir, toOpenClawModelRef } from "../../agents/openclaw-models.js";
import type { AgentHarnessManagedServiceManager } from "../../agents/harness-service.js";
import { createOpenClawServiceProcessManager } from "../../agents/harness-services/openclaw.js";
import { getStoredProfile, loadConfigStore, saveConfigStore, setStoredProfile } from "../../core/config-store.js";
import { getDefaultPieRootDir } from "../../core/profile-registry.js";
import { readHarnessServiceState, writeHarnessServiceState, type HarnessServiceStateRecord } from "../../core/harness-service-state.js";
import { createRuntimeEnvironment, type AgentRuntimeEnvironment } from "../../runtime/environment.js";

const DEFAULT_GROUP = "default";
const SHARED_OPENCLAW_GATEWAY_URL = process.env.PIE_OPENCLAW_SHARED_GATEWAY_URL?.trim() || undefined;
interface SharedHarnessServiceTarget {
	id: string;
	home: string;
	harnessKind?: string;
}

interface SharedHarnessServiceRegistryOptions {
	rootDir?: string;
	openClawGatewayUrl?: string;
	openClawStateDir?: string;
	createOpenClawManager?: (options: {
		homeDir: string;
		environment: AgentRuntimeEnvironment;
		config: Record<string, unknown>;
	}) => AgentHarnessManagedServiceManager;
}

function serviceHome(rootDir: string, kind: string, group = DEFAULT_GROUP): string {
	return join(rootDir, "runtime", "harness-services", `${kind}-${group}`);
}

function serviceEnvironment(homeDir: string): AgentRuntimeEnvironment {
	return createRuntimeEnvironment({ homeDir });
}

function endpointFor(kind: string, openClawGatewayUrl = SHARED_OPENCLAW_GATEWAY_URL): string | undefined {
	if (kind === "openclaw") {
		return openClawGatewayUrl;
	}
	return undefined;
}

function stableJson(value: unknown): string {
	return JSON.stringify(value, Object.keys(value && typeof value === "object" ? value as Record<string, unknown> : {}).sort());
}

export function readSharedHarnessServiceState(kind: string, group = DEFAULT_GROUP): HarnessServiceStateRecord | undefined {
	return readHarnessServiceState(getDefaultPieRootDir(), kind, group);
}

export class SharedHarnessServiceRegistry {
	private readonly managers = new Map<string, AgentHarnessManagedServiceManager>();
	private readonly starting = new Map<string, Promise<void>>();
	private readonly running = new Set<string>();
	private readonly provisionedProfileIds = new Map<string, Set<string>>();
	private readonly rootDir: string;
	private readonly openClawGatewayUrl: string;
	private readonly openClawStateDir: string;
	private readonly createOpenClawManager: NonNullable<SharedHarnessServiceRegistryOptions["createOpenClawManager"]>;

	constructor(options: SharedHarnessServiceRegistryOptions = {}) {
		this.rootDir = options.rootDir ?? getDefaultPieRootDir();
		this.openClawStateDir = resolveOpenClawStateDir(options.openClawStateDir);
		this.openClawGatewayUrl = options.openClawGatewayUrl ?? SHARED_OPENCLAW_GATEWAY_URL ?? readOpenClawGatewaySettings({ stateDir: this.openClawStateDir }).gatewayUrl;
		this.createOpenClawManager = options.createOpenClawManager ?? ((managerOptions) =>
			createOpenClawServiceProcessManager(managerOptions));
	}

	async ensureForProfile(target: SharedHarnessServiceTarget): Promise<void> {
		if (target.harnessKind !== "openclaw") {
			return;
		}
		await this.provisionProfile(target);
		this.markProfileProvisioned(`${target.harnessKind}:${DEFAULT_GROUP}`, target.id);
		await this.ensureStarted(target.harnessKind);
	}

	async stopAll(): Promise<void> {
		for (const [key, manager] of this.managers) {
			await Promise.resolve(manager.stop()).catch(() => undefined);
			const [kind, group = DEFAULT_GROUP] = key.split(":");
			writeHarnessServiceState(this.rootDir, {
				kind: kind ?? key,
				group,
				homeDir: serviceHome(this.rootDir, kind ?? key, group),
				endpoint: endpointFor(kind ?? key, this.openClawGatewayUrl),
				state: "stopped",
				reason: "desktop-quit",
			});
		}
		this.managers.clear();
		this.starting.clear();
		this.running.clear();
		this.provisionedProfileIds.clear();
	}

	private async provisionProfile(target: SharedHarnessServiceTarget): Promise<boolean> {
		const store = loadConfigStore(target.home);
		const profile = getStoredProfile(store);
		if (!profile) {
			return false;
		}
		const environment = createRuntimeEnvironment({ homeDir: target.home, profile });
		const nextProfile = { ...profile, harness: { ...profile.harness, config: { ...(profile.harness.config ?? {}) } } };
		if (target.harnessKind === "openclaw") {
			const existingHarnessConfig = { ...(nextProfile.harness.config ?? {}) };
			delete existingHarnessConfig.stateDir;
			delete existingHarnessConfig.configPath;
			if (existingHarnessConfig.importedAgent === true && typeof existingHarnessConfig.agentId === "string") {
				nextProfile.harness.config = {
					...existingHarnessConfig,
					gatewayUrl: this.openClawGatewayUrl,
					managed: false,
				};
			} else {
				const modelRef = toOpenClawModelRef(nextProfile.harness.model?.provider, nextProfile.harness.model?.model);
				const provisioned = ensureOpenClawAgentProfile({
					stateDir: this.openClawStateDir,
					profileId: target.id,
					homeDir: target.home,
					workDir: environment.workDir,
					modelRef: modelRef ?? (typeof nextProfile.harness.config.modelRef === "string" ? nextProfile.harness.config.modelRef : undefined),
				});
				nextProfile.harness.config = {
					...existingHarnessConfig,
					gatewayUrl: this.openClawGatewayUrl,
					agentId: provisioned.agentId,
					...(provisioned.modelRef ? { modelRef: provisioned.modelRef } : {}),
					managed: false,
				};
			}
		}
		if (stableJson(profile.harness.config ?? {}) !== stableJson(nextProfile.harness.config ?? {})) {
			saveConfigStore(setStoredProfile(store, nextProfile), target.home);
			return true;
		}
		return false;
	}

	private ensureStarted(kind: "openclaw", group = DEFAULT_GROUP): Promise<void> {
		const key = `${kind}:${group}`;
		if (this.running.has(key)) {
			return Promise.resolve();
		}
		const existing = this.starting.get(key);
		if (existing) {
			return existing;
		}
		const started = this.startService(kind, group).finally(() => {
			this.starting.delete(key);
		});
		this.starting.set(key, started);
		return started;
	}

	private markProfileProvisioned(key: string, profileId: string): void {
		const existing = this.provisionedProfileIds.get(key) ?? new Set<string>();
		existing.add(profileId);
		this.provisionedProfileIds.set(key, existing);
	}

	private async startService(kind: "openclaw", group: string): Promise<void> {
		const key = `${kind}:${group}`;
		const homeDir = serviceHome(this.rootDir, kind, group);
		mkdirSync(homeDir, { recursive: true });
		writeHarnessServiceState(this.rootDir, {
			kind,
			group,
			homeDir,
			endpoint: endpointFor(kind, this.openClawGatewayUrl),
			state: "starting",
		});
		try {
			const manager = this.getManager(kind, group);
			await manager.start();
			this.running.add(key);
			writeHarnessServiceState(this.rootDir, {
				kind,
				group,
				homeDir,
				endpoint: endpointFor(kind, this.openClawGatewayUrl),
				state: "running",
			});
		} catch (error) {
			this.running.delete(key);
			writeHarnessServiceState(this.rootDir, {
				kind,
				group,
				homeDir,
				endpoint: endpointFor(kind, this.openClawGatewayUrl),
				state: "failed",
				reason: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	private getManager(kind: "openclaw", group: string): AgentHarnessManagedServiceManager {
		const key = `${kind}:${group}`;
		const existing = this.managers.get(key);
		if (existing) {
			return existing;
		}
		const homeDir = serviceHome(this.rootDir, kind, group);
		const environment = serviceEnvironment(homeDir);
		const manager = this.createOpenClawManager({
			homeDir,
			environment,
			config: {
				gatewayUrl: this.openClawGatewayUrl,
				stateDir: this.openClawStateDir,
			},
		});
		this.managers.set(key, manager);
		return manager;
	}
}

export const sharedHarnessServices = new SharedHarnessServiceRegistry();

export function getSharedHarnessServiceInfo(kind: string | undefined): HarnessServiceStateRecord | undefined {
	if (kind !== "openclaw") {
		return undefined;
	}
	return readSharedHarnessServiceState(kind);
}
