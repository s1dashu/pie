import { useMemo } from "react";
import Avatar, { genConfig } from "react-nice-avatar";

export function AgentAvatar({ seed, size = 44 }: { seed: string; size?: number }): JSX.Element {
	const config = useMemo(() => genConfig(seed), [seed]);
	return (
		<div
			className="agent-avatar-frame shrink-0 overflow-hidden rounded-full bg-white"
			style={{ width: size, height: size }}
		>
			<Avatar className="h-full w-full" {...config} />
		</div>
	);
}
