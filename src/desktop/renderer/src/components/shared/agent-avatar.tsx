function avatarInitial(label: string | undefined, seed: string): string {
	const clean = label?.trim() || seed.trim() || "A";
	const first = Array.from(clean)[0] ?? "A";
	return first.toLocaleUpperCase();
}

export function AgentAvatar({ seed, src, size = 44, label }: { seed: string; src?: string; size?: number; label?: string }): JSX.Element {
	return (
		<div
			className="agent-avatar-frame shrink-0 overflow-hidden rounded-full bg-white"
			style={{ width: size, height: size }}
			data-seed={seed}
		>
			{src ? (
				<img src={src} alt="" className="h-full w-full object-cover" draggable={false} />
			) : (
				<div
					className="grid h-full w-full place-items-center"
					style={{
						backgroundColor: "var(--lime-9)",
						color: "var(--lime-1)",
					}}
				>
					<span className="font-semibold leading-none tracking-normal" style={{ fontSize: Math.max(12, Math.round(size * 0.42)) }}>
						{avatarInitial(label, seed)}
					</span>
				</div>
			)}
		</div>
	);
}
