import type { AgentRuntimeEnvironment } from "../runtime/environment.js";

export interface AgentBackendManagedServiceManagerOptions {
	homeDir: string;
	environment: AgentRuntimeEnvironment;
	config?: Record<string, unknown>;
}

export interface AgentBackendManagedServiceManager {
	start(): void | Promise<void>;
	stop(): void;
}

export type AgentBackendManagedServiceManagerFactory = (
	options: AgentBackendManagedServiceManagerOptions,
) => AgentBackendManagedServiceManager;
