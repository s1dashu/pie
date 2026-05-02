import { cn } from "../../lib/utils";

/** 固定高度，避免副标题 1～2 行时主数字上下错位 */
function metricHintSlot(hint?: string): JSX.Element {
	return (
		<div className="mt-1 flex min-h-[1.75rem] w-full min-w-0 items-end">
			{hint ? (
				<p className="line-clamp-2 w-full text-pretty text-xs leading-snug text-muted-foreground">{hint}</p>
			) : (
				<span className="block min-h-[1.25em] w-full" aria-hidden />
			)}
		</div>
	);
}

export function CompactMetric({
	label,
	value,
	hint,
}: {
	label: string;
	value: string;
	/** 主指标下方灰色小字，增加卡片高度与留白 */
	hint?: string;
}): JSX.Element {
	return (
		<div className="pie-smooth-corner flex min-h-[4rem] min-w-0 flex-col rounded-[24px] bg-[var(--slate-2)] px-3 py-2.5">
			<div className="truncate text-xs font-medium uppercase text-muted-foreground">{label}</div>
			<div className="min-h-1 flex-1" aria-hidden />
			<div className="text-base font-bold leading-none text-foreground tabular-nums">{value}</div>
			{hint ? metricHintSlot(hint) : null}
		</div>
	);
}

export function UsageMetric({
	label,
	value,
	hint,
	className,
}: {
	label: string;
	value: string;
	hint?: string;
	className?: string;
}): JSX.Element {
	return (
		<div
			className={cn(
				"pie-smooth-corner flex min-h-[7.75rem] min-w-0 flex-col rounded-[36px] bg-[var(--slate-2)] p-4",
				className,
			)}
		>
			<div className="truncate text-xs font-medium uppercase text-muted-foreground">{label}</div>
			<div className="min-h-2 flex-1" aria-hidden />
			<div className="text-2xl font-bold tracking-tight text-foreground tabular-nums">{value}</div>
			{metricHintSlot(hint)}
		</div>
	);
}
