import * as SelectPrimitive from "@radix-ui/react-select";
import type * as React from "react";
import { AltArrowDownLinear } from "solar-icon-set";
import { cn } from "../../lib/utils";

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({
	className,
	children,
	...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>): JSX.Element {
	return (
		<SelectPrimitive.Trigger
			className={cn(
				"no-drag flex h-10 w-full items-center justify-between gap-2 rounded-2xl border border-transparent bg-white px-3 text-sm outline-none transition hover:border-[var(--lime-8)] focus:border-primary focus:bg-white disabled:cursor-not-allowed disabled:opacity-60",
				className,
			)}
			{...props}
		>
			{children}
			<SelectPrimitive.Icon asChild>
				<AltArrowDownLinear className="h-4 w-4 shrink-0 text-muted-foreground" />
			</SelectPrimitive.Icon>
		</SelectPrimitive.Trigger>
	);
}

export function SelectContent({
	className,
	children,
	position = "popper",
	...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>): JSX.Element {
	return (
		<SelectPrimitive.Portal>
			<SelectPrimitive.Content
				className={cn(
					"z-50 max-h-[min(var(--radix-select-content-available-height),18rem)] min-w-[8rem] overflow-hidden rounded-2xl bg-white text-foreground",
					position === "popper" && "data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1",
					className,
				)}
				position={position}
				{...props}
			>
				<SelectPrimitive.Viewport
					className={cn("max-h-[inherit] overflow-y-auto p-1", position === "popper" && "min-w-[var(--radix-select-trigger-width)]")}
				>
					{children}
				</SelectPrimitive.Viewport>
			</SelectPrimitive.Content>
		</SelectPrimitive.Portal>
	);
}

export function SelectItem({
	className,
	children,
	...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>): JSX.Element {
	return (
		<SelectPrimitive.Item
			className={cn(
				"relative flex h-9 cursor-default select-none items-center rounded-xl px-8 py-1.5 text-sm outline-none transition data-[disabled]:pointer-events-none data-[highlighted]:bg-[var(--lime-3)] data-[highlighted]:text-accent-foreground data-[disabled]:opacity-50",
				className,
			)}
			{...props}
		>
			<span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
				<SelectPrimitive.ItemIndicator>
					<span className="text-xs leading-none text-[var(--lime-11)]">●</span>
				</SelectPrimitive.ItemIndicator>
			</span>
			<SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
		</SelectPrimitive.Item>
	);
}
