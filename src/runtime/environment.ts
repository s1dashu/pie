import { mkdirSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { expandUserHomePath } from "../core/agent-home.js";
import type { AgentProfile } from "../core/config-store.js";

export type RuntimeEnvironmentLifecycleState =
	| "created"
	| "starting"
	| "running"
	| "degraded"
	| "stopping"
	| "stopped"
	| "failed";

export interface RuntimeEnvironmentLifecycleSnapshot {
	state: RuntimeEnvironmentLifecycleState;
	updatedAt: string;
	reason?: string;
}

export interface AgentRuntimeEnvironment {
	homeDir: string;
	workDir: string;
	lifecycle: RuntimeEnvironmentLifecycleSnapshot;
}

export class RuntimeEnvironmentLifecycle {
	private snapshotValue: RuntimeEnvironmentLifecycleSnapshot = {
		state: "created",
		updatedAt: new Date().toISOString(),
	};

	get snapshot(): RuntimeEnvironmentLifecycleSnapshot {
		return this.snapshotValue;
	}

	mark(state: RuntimeEnvironmentLifecycleState, reason?: string): RuntimeEnvironmentLifecycleSnapshot {
		this.snapshotValue = {
			state,
			updatedAt: new Date().toISOString(),
			...(reason ? { reason } : {}),
		};
		return this.snapshotValue;
	}
}

function resolveWorkDir(homeDir: string, rawWorkDir: string | undefined): string {
	const value = rawWorkDir?.trim();
	if (!value) {
		return resolve(homeDir);
	}
	if (value === "~" || value.startsWith("~/") || value.startsWith("~\\") || isAbsolute(value)) {
		return expandUserHomePath(value);
	}
	return resolve(join(homeDir, value));
}

export function createRuntimeEnvironment(options: {
	homeDir: string;
	profile?: AgentProfile;
	lifecycle?: RuntimeEnvironmentLifecycle;
}): AgentRuntimeEnvironment {
	const lifecycle = options.lifecycle ?? new RuntimeEnvironmentLifecycle();
	return {
		homeDir: resolve(options.homeDir),
		workDir: resolveWorkDir(options.homeDir, options.profile?.runtime?.workDir ?? options.profile?.harness.model?.workDir),
		lifecycle: lifecycle.snapshot,
	};
}

export function ensureRuntimeEnvironment(environment: AgentRuntimeEnvironment): void {
	mkdirSync(environment.homeDir, { recursive: true });
	mkdirSync(environment.workDir, { recursive: true });
}
