import { SmileCircleBoldDuotone } from "solar-icon-set";
import type { AgentDetails } from "../../shared/types";
import { AppIcon } from "../components/shared/app-icon";
import { AgentDetailView } from "../features/agents/AgentDetailView";

export function AgentDetailPane({
	agent,
	onError,
	onDeleted,
}: {
	agent?: AgentDetails;
	onError: (message: string) => void;
	onDeleted: () => void;
}): JSX.Element {
	return (
		<div className="agent-detail-corner relative z-10 ml-1 flex flex-1 flex-col overflow-hidden bg-white shadow-[0_4px_24px_rgba(0,0,0,0.04)]">
			{agent ? (
				<AgentDetailView
					agent={agent}
					onError={onError}
					onDeleted={onDeleted}
				/>
			) : (
				<div className="drag-region flex h-full flex-col items-center justify-center bg-white text-muted-foreground">
					<AppIcon IconComponent={SmileCircleBoldDuotone} className="mb-4 h-12 w-12 text-[var(--lime-10)]" />
					<p className="text-sm font-medium">选择一个 bot，或创建新的 bot</p>
				</div>
			)}
		</div>
	);
}
