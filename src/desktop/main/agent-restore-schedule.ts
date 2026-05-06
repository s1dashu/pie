export interface AgentRestoreScheduleTarget {
	harnessKind?: string;
	selected?: boolean;
}

export interface AgentRestoreScheduleOptions {
	staggerMs?: number;
	openClawSelectedDelayMs?: number;
	openClawBackgroundDelayMs?: number;
}

export const DEFAULT_RESTORE_AGENTS_STAGGER_MS = 500;
export const DEFAULT_RESTORE_OPENCLAW_SELECTED_DELAY_MS = 4_000;
export const DEFAULT_RESTORE_OPENCLAW_BACKGROUND_DELAY_MS = 15_000;

export function getRestoreDelayMs(
	agent: AgentRestoreScheduleTarget,
	index: number,
	options: AgentRestoreScheduleOptions = {},
): number {
	const staggerMs = options.staggerMs ?? DEFAULT_RESTORE_AGENTS_STAGGER_MS;
	const baseDelay = Math.max(0, index) * staggerMs;
	if (agent.harnessKind !== "openclaw") {
		return baseDelay;
	}
	const openClawDelay = agent.selected
		? options.openClawSelectedDelayMs ?? DEFAULT_RESTORE_OPENCLAW_SELECTED_DELAY_MS
		: options.openClawBackgroundDelayMs ?? DEFAULT_RESTORE_OPENCLAW_BACKGROUND_DELAY_MS;
	return baseDelay + openClawDelay;
}
