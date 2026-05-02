import type * as React from "react";

export function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
	return (
		<div className="block">
			<span className="mb-3.5 block text-sm font-medium text-muted-foreground">{label}</span>
			{children}
		</div>
	);
}
