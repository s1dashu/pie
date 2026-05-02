import { cn } from "../../lib/utils";

export function CompactMetric({ label, value }: { label: string; value: string }): JSX.Element {
	return (
		<div className="pie-smooth-corner min-w-0 rounded-[36px] bg-[var(--slate-2)] p-4">
			<div className="truncate text-xs font-medium uppercase text-muted-foreground">{label}</div>
			<div className="mt-2 text-base font-semibold leading-none text-foreground tabular-nums">{value}</div>
		</div>
	);
}

export function UsageMetric({ label, value, detail, className }: { label: string; value: string; detail: string; className?: string }): JSX.Element {
	return (
		<div className={cn("pie-smooth-corner rounded-[36px] bg-[var(--slate-2)] p-4", className)}>
			<div className="text-xs font-medium text-muted-foreground">{label}</div>
			<div className="mt-2 text-2xl font-semibold text-foreground tabular-nums">{value}</div>
			<div className="mt-1 text-xs text-muted-foreground tabular-nums">{detail}</div>
		</div>
	);
}
