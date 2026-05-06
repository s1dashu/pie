import type { AgentDetails } from "../../../shared/types";
import { TerminalLog } from "../logs/TerminalLog";
import { cn } from "../../lib/utils";

export function AgentLogsPanel({
	agent,
	title,
}: {
	agent: AgentDetails;
	title: string;
}): JSX.Element {
	return (
		<div className="pie-smooth-corner flex min-h-0 flex-1 flex-col overflow-hidden rounded-[42px] bg-slate-950 pb-3 pt-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
			<div className="flex items-center justify-between px-4 pb-2.5">
				<SectionTitle title={title} className="[&_div:first-child]:text-slate-100" />
			</div>
			<TerminalLog agent={agent} tone="dark" />
		</div>
	);
}

function SectionTitle({
	title,
	description,
	className,
}: {
	title: string;
	description?: string;
	className?: string;
}): JSX.Element {
	return (
		<div className={cn("min-w-0", className)}>
			<div className="truncate text-base font-semibold leading-snug text-foreground text-balance">{title}</div>
			{description ? (
				<div className="mt-1 min-w-0 text-pretty text-xs leading-5 text-muted-foreground">{description}</div>
			) : null}
		</div>
	);
}
