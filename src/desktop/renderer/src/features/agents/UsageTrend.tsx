import type { AgentUsageDailyPoint, AgentUsageStats } from "../../../shared/types";
import { AceternityTooltip } from "../../components/shared/tooltip";
import { formatTokenCount } from "./agent-display";

export function UsageTrend({ usage }: { usage: AgentUsageStats }): JSX.Element {
	const days = getDisplayDays(usage);

	if (!days.length) {
		return (
			<div className="pie-smooth-corner mt-3 flex h-28 items-center justify-center rounded-[24px] px-4 text-sm text-muted-foreground">
				暂无用量数据
			</div>
		);
	}

	const maxDay = Math.max(1, ...days.map((d) => d.tokens));

	return (
		<div className="pie-smooth-corner mt-3 rounded-[24px] px-4 py-3">
			<div className="space-y-2">
				{days.map((day) => (
					<AceternityTooltip
						key={day.date}
						content={`${day.date}\n${formatTokenCount(day.tokens)} token`}
						className="flex w-full items-center gap-2.5 text-sm"
					>
						<span className="w-12 shrink-0 text-xs text-muted-foreground tabular-nums">{day.date.slice(5)}</span>
						<div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--slate-4)]">
							<div
								className="h-full max-w-full rounded-full bg-[var(--slate-8)] transition-[width] duration-300"
								style={{ width: `${Math.max(4, (day.tokens / maxDay) * 100)}%` }}
							/>
						</div>
						<span className="w-16 shrink-0 text-right text-xs text-foreground tabular-nums">{formatTokenCount(day.tokens)}</span>
					</AceternityTooltip>
				))}
			</div>
		</div>
	);
}

function getDisplayDays(usage: AgentUsageStats): AgentUsageDailyPoint[] {
	return usage.recentDays.slice(-7);
}
