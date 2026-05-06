import type { AgentRuntimeEnvironment } from "../runtime/environment.js";
import type { ModelProfile } from "../core/config-store.js";

export interface AgentHarnessManagedServiceManagerOptions {
	homeDir: string;
	environment: AgentRuntimeEnvironment;
	config?: Record<string, unknown>;
	model?: ModelProfile;
}

export interface AgentHarnessManagedServiceManager {
	start(): void | Promise<void>;
	stop(): void | Promise<void>;
}

export type AgentHarnessManagedServiceManagerFactory = (
	options: AgentHarnessManagedServiceManagerOptions,
) => AgentHarnessManagedServiceManager;
