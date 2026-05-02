import type { AgentUsageDailyPoint, AgentUsageStats } from "../../../shared/types";
import { AceternityTooltip } from "../../components/shared/tooltip";
import { formatCount, formatTokenCount } from "./agent-display";

export function UsageTrend({ usage }: { usage: AgentUsageStats }): JSX.Element {
	const days = getDisplayDays(usage);
	const maxValue = Math.max(1, ...days.map((day) => day.tokens));

	return (
		<div className="pie-smooth-corner mt-3 h-28 overflow-x-auto rounded-[24px] px-4 py-3">
			{days.length ? (
				<div className="grid h-full min-w-[160px] items-end gap-3" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
					{days.map((day) => {
						const barHeight = day.tokens > 0 ? Math.max(8, Math.round((day.tokens / maxValue) * 100)) : 2;
						return (
							<TrendBar
									key={day.date}
									date={day.date}
									height={barHeight}
									colorClassName="bg-[var(--slate-8)]"
									tooltip={`${day.date}\n${formatTokenCount(day.tokens)} token`}
								/>
						);
					})}
				</div>
			) : (
				<div className="flex h-full items-center justify-center text-sm text-muted-foreground">暂无用量数据</div>
			)}
		</div>
	);
}

export function CacheHitTrend({ usage }: { usage: AgentUsageStats }): JSX.Element {
	const days = getDisplayDays(usage);

	return (
		<div className="pie-smooth-corner mt-3 h-28 overflow-x-auto rounded-[24px] px-4 py-3">
			{days.length ? (
				<div className="grid h-full min-w-[160px] items-end gap-3" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
					{days.map((day) => {
						const hitRate = getCacheHitRate(day);
						const barHeight = hitRate > 0 ? Math.max(8, Math.round(hitRate * 100)) : 2;
						return (
							<TrendBar
									key={day.date}
									date={day.date}
									height={barHeight}
									colorClassName="bg-[var(--slate-8)]"
									tooltip={[
									`${day.date} · ${formatPercent(hitRate)}`,
									`Read ${formatCount(day.cacheReadTokens)}`,
									`Write ${formatCount(day.cacheWriteTokens)}`,
									`Input ${formatCount(day.inputTokens)}`,
								].join("\n")}
							/>
						);
					})}
				</div>
			) : (
				<div className="flex h-full items-center justify-center text-sm text-muted-foreground">暂无缓存数据</div>
			)}
		</div>
	);
}

function TrendBar({
	date,
	height,
	colorClassName,
	tooltip,
}: {
	date: string;
	height: number;
	colorClassName: string;
	tooltip: string;
}): JSX.Element {
	return (
		<AceternityTooltip content={tooltip} className="flex h-full min-w-0 flex-col items-center justify-end gap-1.5">
			<>
				<div className="flex h-16 w-full items-end justify-center">
					<div
						className={`pie-smooth-corner w-full max-w-12 rounded-xl ${colorClassName}`}
						style={{ height: `${height}%` }}
					/>
				</div>
				<div className="text-center text-xs text-muted-foreground tabular-nums">{date.slice(5)}</div>
			</>
		</AceternityTooltip>
	);
}

function getDisplayDays(usage: AgentUsageStats): AgentUsageDailyPoint[] {
	return usage.recentDays.slice(-7);
}

function getCacheHitRate(day: AgentUsageDailyPoint): number {
	const denominator = day.inputTokens + day.cacheReadTokens + day.cacheWriteTokens;
	return denominator > 0 ? day.cacheReadTokens / denominator : 0;
}

function formatPercent(value: number): string {
	return `${(value * 100).toFixed(value >= 0.1 ? 1 : 2)}%`;
}
