import {
	ChartSquareBoldDuotone,
	CodeSquareBoldDuotone,
	RadioMinimalisticBoldDuotone,
	ShieldStarBoldDuotone,
	Widget5BoldDuotone,
	type SolarIconProps,
} from "solar-icon-set";
import type { AgentSummary, AgentUsageStats, DesktopThinkingLevel } from "../../../shared/types";

export type AgentTab = "overview" | "model" | "skills" | "usage" | "channels";

export const tabs: Array<{ id: AgentTab; label: string; icon: (props: SolarIconProps) => JSX.Element }> = [
	{ id: "overview", label: "概览", icon: Widget5BoldDuotone },
	{ id: "usage", label: "监控", icon: ChartSquareBoldDuotone },
	{ id: "model", label: "模型", icon: CodeSquareBoldDuotone },
	{ id: "skills", label: "技能", icon: ShieldStarBoldDuotone },
	{ id: "channels", label: "渠道", icon: RadioMinimalisticBoldDuotone },
];

export const thinkingLevelOptions: Array<{ value: DesktopThinkingLevel; label: string }> = [
	{ value: "off", label: "off" },
	{ value: "minimal", label: "minimal" },
	{ value: "low", label: "low" },
	{ value: "medium", label: "medium" },
	{ value: "high", label: "high" },
	{ value: "xhigh", label: "xhigh" },
];

export const brandOptions: Array<{ value: "feishu" | "lark"; label: string }> = [
	{ value: "feishu", label: "Feishu" },
	{ value: "lark", label: "Lark" },
];

export function statusTone(status: AgentSummary["status"]): string {
	if (status === "running") {
		return "bg-[var(--lime-9)]";
	}
	if (status === "paused") {
		return "bg-accent";
	}
	return "bg-border";
}

export function statusLabel(status: AgentSummary["status"]): string {
	if (status === "running") {
		return "运行中";
	}
	if (status === "paused") {
		return "已暂停";
	}
	return "未启动";
}

export function formatCount(value: number): string {
	return new Intl.NumberFormat("zh-CN").format(value);
}

export function formatTokenCount(value: number): string {
	const abs = Math.abs(value);
	if (abs >= 1_000_000) {
		return `${(value / 1_000_000).toFixed(2)}M`;
	}
	if (abs >= 1_000) {
		return `${(value / 1_000).toFixed(2)}K`;
	}
	return formatCount(value);
}

export function formatDuration(ms: number): string {
	if (ms < 60_000) {
		return `${Math.floor(ms / 1000)}s`;
	}
	if (ms < 3_600_000) {
		return `${Math.floor(ms / 60_000)}m`;
	}
	const hours = Math.floor(ms / 3_600_000);
	const minutes = Math.floor((ms % 3_600_000) / 60_000);
	return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

export function emptyUsage(): AgentUsageStats {
	const emptyBucket = { incomingMessages: 0, outgoingMessages: 0, actions: 0, failedActions: 0, tokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, runDurationMs: 0 };
	return {
		today: { ...emptyBucket },
		total: { ...emptyBucket },
		currentRun: { ...emptyBucket },
		recentDays: [],
		updatedAt: new Date(0).toISOString(),
	};
}
