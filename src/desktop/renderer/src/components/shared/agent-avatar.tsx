import { useMemo } from "react";
import Avatar, { genConfig } from "react-nice-avatar";

export function AgentAvatar({ seed, src, size = 44 }: { seed: string; src?: string; size?: number }): JSX.Element {
	const config = useMemo(() => genConfig(seed), [seed]);
	return (
		<div
			className="agent-avatar-frame shrink-0 overflow-hidden rounded-full bg-white"
			style={{ width: size, height: size }}
		>
			{src ? (
				<img src={src} alt="" className="h-full w-full object-cover" draggable={false} />
			) : (
				<Avatar className="h-full w-full" {...config} />
			)}
		</div>
	);
}
