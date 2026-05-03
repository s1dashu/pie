import type * as React from "react";

export function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
	return (
		<div className="block">
			<span className="mb-2.5 block text-xs font-medium leading-none text-muted-foreground">{label}</span>
			{children}
		</div>
	);
}
