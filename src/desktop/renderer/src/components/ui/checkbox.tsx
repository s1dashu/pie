import type * as React from "react";
import { cn } from "../../lib/utils";

export function Checkbox({
	checked,
	onCheckedChange,
	className,
	disabled,
	...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "checked" | "onChange"> & {
	checked?: boolean;
	onCheckedChange?: (checked: boolean) => void;
}): JSX.Element {
	return (
		<button
			type="button"
			role="checkbox"
			aria-checked={checked}
			disabled={disabled}
			className={cn(
				"no-drag flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-transparent bg-white text-xs font-semibold leading-none text-primary transition hover:border-[var(--lime-8)] focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-50",
				checked && "border-[var(--lime-8)] bg-[var(--lime-3)]",
				className,
			)}
			onClick={() => onCheckedChange?.(!checked)}
			{...props}
		>
			{checked ? "✓" : null}
		</button>
	);
}
