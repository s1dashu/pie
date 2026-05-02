import { cn } from "../../lib/utils";

export function CompactMetric({ label, value }: { label: string; value: string }): JSX.Element {
	return (
		<div className="pie-smooth-corner min-w-0 rounded-[36px] bg-[var(--slate-2)] p-4">
			<div className="truncate text-xs font-medium uppercase text-muted-foreground">{label}</div>
			<div className="mt-2 text-base font-bold leading-none text-foreground tabular-nums">{value}</div>
		</div>
	);
}

export function UsageMetric({ label, value, className }: { label: string; value: string; className?: string }): JSX.Element {
	return (
		<div className={cn("pie-smooth-corner flex flex-col rounded-[36px] bg-[var(--slate-2)] p-4", className)}>
			<div className="text-sm font-medium text-foreground">{label}</div>
			<div className="mt-auto pt-2 text-2xl font-bold tracking-tight text-foreground tabular-nums">{value}</div>
		</div>
	);
}
