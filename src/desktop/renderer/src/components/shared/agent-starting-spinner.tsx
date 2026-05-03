import { RestartCircleBoldDuotone } from "solar-icon-set";
import { cn } from "../../lib/utils";
import { AppIcon } from "./app-icon";

export function AgentStartingSpinner({
	className,
	iconClassName,
}: {
	className?: string;
	iconClassName?: string;
}): JSX.Element {
	return (
		<span
			className={cn(
				"grid h-7 w-7 shrink-0 place-items-center text-[var(--lime-11)]",
				className,
			)}
			aria-label="启动中"
		>
			<AppIcon
				IconComponent={RestartCircleBoldDuotone}
				className={cn(
					"size-7 animate-spin",
					iconClassName,
				)}
			/>
		</span>
	);
}
