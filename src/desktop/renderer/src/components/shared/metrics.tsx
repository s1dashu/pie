import { cn } from "../../lib/utils";

/** 固定高度，副标题永远单行，避免窄屏时把卡片撑高。 */
function metricHintSlot(hint?: string): JSX.Element {
	return (
		<div className="mt-1 flex min-h-[1rem] w-full min-w-0 items-end">
			{hint ? (
				<p className="w-full truncate text-xs leading-none text-muted-foreground">{hint}</p>
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
			<div className="text-sm font-bold leading-none text-foreground tabular-nums min-[960px]:text-base">{value}</div>
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
			<div className="text-lg font-bold tracking-tight text-foreground tabular-nums min-[960px]:text-2xl">{value}</div>
			{metricHintSlot(hint)}
		</div>
	);
}
