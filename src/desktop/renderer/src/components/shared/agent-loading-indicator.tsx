import { cn } from "../../lib/utils";
import { Spinner } from "../ui/spinner-1";

export function AgentLoadingIndicator({
	className,
	color = "var(--slate-11)",
	label = "Loading",
	size = 18,
}: {
	className?: string;
	color?: string;
	label?: string;
	size?: number;
}): JSX.Element {
	return (
		<div className={cn("flex items-center justify-center", className)} role="status" aria-label={label}>
			<Spinner size={size} color={color} />
		</div>
	);
}
