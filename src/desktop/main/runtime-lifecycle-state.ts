import type { RuntimeEnvironmentLifecycleState } from "../shared/types.js";
import {
	type RuntimeProcessRecord,
	writeRuntimeStateRecord,
} from "../../core/runtime-process.js";

export interface RuntimeLifecycleTarget {
	home: string;
	runtimeEnvironment?: {
		homeDir: string;
		workDir: string;
	};
}

export function writeAgentRuntimeLifecycle(
	target: RuntimeLifecycleTarget,
	state: RuntimeEnvironmentLifecycleState,
	reason: string,
	options: { process?: RuntimeProcessRecord; updatedAt?: string } = {},
): void {
	writeRuntimeLifecycle(target.home, target.runtimeEnvironment?.homeDir ?? target.home, target.runtimeEnvironment?.workDir ?? target.home, state, reason, options);
}

export function writeRuntimeLifecycle(
	recordHomeDir: string,
	homeDir: string,
	workDir: string,
	state: RuntimeEnvironmentLifecycleState,
	reason: string,
	options: { process?: RuntimeProcessRecord; updatedAt?: string } = {},
): void {
	writeRuntimeStateRecord(recordHomeDir, {
		homeDir,
		workDir,
		lifecycle: {
			state,
			updatedAt: options.updatedAt ?? new Date().toISOString(),
			reason,
		},
		...(options.process ? { process: options.process } : {}),
	});
}
