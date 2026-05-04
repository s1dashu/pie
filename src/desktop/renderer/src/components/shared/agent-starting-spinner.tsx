import { RestartCircleBoldDuotone } from "solar-icon-set";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { AppIcon } from "./app-icon";

export function AgentStartingSpinner({
	className,
	iconClassName,
}: {
	className?: string;
	iconClassName?: string;
}): JSX.Element {
	const { t } = useI18n();
	return (
		<span
			className={cn(
				"grid h-7 w-7 shrink-0 place-items-center text-[var(--lime-11)]",
				className,
			)}
			aria-label={t("starting")}
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
