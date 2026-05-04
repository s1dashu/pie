import type { AgentUsageDailyPoint, AgentUsageStats, UsageBucket } from "../../../shared/types";
import { AceternityTooltip } from "../../components/shared/tooltip";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { formatTokenCount } from "./agent-display";

export function UsageTrend({ usage }: { usage: AgentUsageStats }): JSX.Element {
	const { t } = useI18n();
	const days = getDisplayDays(usage);

	if (!days.length) {
		return (
			<div className="pie-smooth-corner mt-3 flex h-28 items-center justify-center rounded-[24px] text-sm text-muted-foreground">
				{t("noUsageData")}
			</div>
		);
	}

	const maxDay = Math.max(1, ...days.map((d) => d.tokens));

	return (
		<div className="mt-5 min-h-[11.75rem] rounded-[24px]">
			<div className="space-y-2">
				{days.map((day) => (
					<AceternityTooltip
						key={day.date}
						content={`${day.date}\n${formatTokenCount(day.tokens)} token`}
						className="flex h-5 w-full items-center gap-3 text-sm"
					>
						<span className={cn("w-12 shrink-0 text-xs leading-none text-muted-foreground tabular-nums", day.tokens === 0 ? "opacity-55" : "")}>{day.date.slice(5)}</span>
						<div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--slate-4)]">
							<div
								className="h-full max-w-full rounded-full bg-[var(--slate-8)] transition-[width] duration-300"
								style={{ width: `${day.tokens > 0 ? Math.max(4, (day.tokens / maxDay) * 100) : 0}%` }}
							/>
						</div>
						<span className={cn("w-16 shrink-0 text-right text-xs leading-none text-foreground tabular-nums", day.tokens === 0 ? "text-muted-foreground opacity-45" : "")}>{formatTokenCount(day.tokens)}</span>
					</AceternityTooltip>
				))}
			</div>
		</div>
	);
}

function getDisplayDays(usage: AgentUsageStats): AgentUsageDailyPoint[] {
	const byDate = new Map(usage.recentDays.map((day) => [day.date, day]));
	const end = new Date(usage.updatedAt);
	const baseDate = Number.isNaN(end.getTime()) ? new Date() : end;
	const days: AgentUsageDailyPoint[] = [];

	for (let index = 6; index >= 0; index -= 1) {
		const date = new Date(baseDate);
		date.setHours(0, 0, 0, 0);
		date.setDate(date.getDate() - index);
		const key = formatDateKey(date);
		days.push(byDate.get(key) ?? { date: key, ...emptyUsageBucket });
	}

	return days;
}

const emptyUsageBucket: UsageBucket = {
	incomingMessages: 0,
	outgoingMessages: 0,
	actions: 0,
	failedActions: 0,
	turns: 0,
	tokens: 0,
	inputTokens: 0,
	outputTokens: 0,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
	runDurationMs: 0,
};

function formatDateKey(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}
