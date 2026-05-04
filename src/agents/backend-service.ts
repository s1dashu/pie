import type { AgentRuntimeEnvironment } from "../runtime/environment.js";
import type { ModelProfile } from "../core/config-store.js";

export interface AgentBackendManagedServiceManagerOptions {
	homeDir: string;
	environment: AgentRuntimeEnvironment;
	config?: Record<string, unknown>;
	model?: ModelProfile;
}

export interface AgentBackendManagedServiceManager {
	start(): void | Promise<void>;
	stop(): void;
}

export type AgentBackendManagedServiceManagerFactory = (
	options: AgentBackendManagedServiceManagerOptions,
) => AgentBackendManagedServiceManager;
