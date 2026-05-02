export function AgentAvatar({ seed, src, size = 44 }: { seed: string; src?: string; size?: number }): JSX.Element {
	return (
		<div
			className="agent-avatar-frame shrink-0 overflow-hidden rounded-full bg-white"
			style={{ width: size, height: size }}
			data-seed={seed}
		>
			{src ? (
				<img src={src} alt="" className="h-full w-full object-cover" draggable={false} />
			) : (
				<div className="grid h-full w-full place-items-center bg-[linear-gradient(45deg,rgba(15,23,42,0.08)_25%,transparent_25%,transparent_75%,rgba(15,23,42,0.08)_75%),linear-gradient(45deg,rgba(15,23,42,0.08)_25%,transparent_25%,transparent_75%,rgba(15,23,42,0.08)_75%)] bg-[length:12px_12px] bg-[position:0_0,6px_6px]">
					<span className="h-[42%] w-[42%] rounded-full border border-dashed border-muted-foreground/60" />
				</div>
			)}
		</div>
	);
}
