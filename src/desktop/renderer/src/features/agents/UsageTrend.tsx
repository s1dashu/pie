import type { AgentUsageStats } from "../../../shared/types";
import { formatCount } from "./agent-display";

export function UsageTrend({ usage }: { usage: AgentUsageStats }): JSX.Element {
	const usageByDate = new Map(usage.recentDays.map((day) => [day.date, day]));
	const days = getRecentDates(7).map((date) => ({
		date,
		tokens: usageByDate.get(date)?.tokens ?? 0,
	}));
	const maxValue = Math.max(1, ...days.map((day) => day.tokens));

	return (
		<div className="pie-smooth-corner mt-5 h-52 overflow-x-auto rounded-[32px] bg-white px-4 py-4">
			<div className="flex h-full w-max min-w-full items-end gap-3">
				{days.map((day) => {
					const barHeight = day.tokens > 0 ? Math.max(8, Math.round((day.tokens / maxValue) * 100)) : 2;
					return (
						<div key={day.date} className="flex h-full w-12 flex-none flex-col items-center justify-end gap-2">
							<div className="flex h-36 w-full items-end justify-center">
								<div
									className="pie-smooth-corner w-9 rounded-xl bg-primary"
									style={{ height: `${barHeight}%` }}
									title={`${day.date}: ${formatCount(day.tokens)} token`}
								/>
							</div>
							<div className="text-center text-xs text-muted-foreground tabular-nums">{day.date.slice(5)}</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

function getRecentDates(count: number): string[] {
	const result: string[] = [];
	const today = new Date();
	for (let offset = count - 1; offset >= 0; offset -= 1) {
		const date = new Date(today);
		date.setDate(today.getDate() - offset);
		result.push(formatDateKey(date));
	}
	return result;
}

function formatDateKey(date: Date): string {
	const year = date.getFullYear();
	const month = `${date.getMonth() + 1}`.padStart(2, "0");
	const day = `${date.getDate()}`.padStart(2, "0");
	return `${year}-${month}-${day}`;
}
