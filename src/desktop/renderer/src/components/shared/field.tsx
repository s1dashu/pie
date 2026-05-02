import type * as React from "react";

export function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
	return (
		<label className="block">
			<span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>
			{children}
		</label>
	);
}
