import { SmileCircleBoldDuotone } from "solar-icon-set";
import type { AgentDetails } from "../../shared/types";
import { AppIcon } from "../components/shared/app-icon";
import { Button } from "../components/ui/button";
import { AgentDetailView } from "../features/agents/AgentDetailView";
import { CreateAgentView } from "../features/agents/CreateAgentView";
import { GlobalSettingsView } from "../features/settings/GlobalSettingsView";

export function AgentDetailPane({
	agent,
	showSettings,
	showCreateAgent,
	hasAgents,
	isLoadingAgents,
	onCreateAgent,
	onError,
	onCloseSettings,
	onCancelCreate,
	onCreated,
	onDeleted,
}: {
	agent?: AgentDetails;
	showSettings?: boolean;
	showCreateAgent?: boolean;
	hasAgents?: boolean;
	isLoadingAgents?: boolean;
	onCreateAgent: () => void;
	onError: (message: string) => void;
	onCloseSettings: () => void;
	onCancelCreate: () => void;
	onCreated: (agent: AgentDetails) => void;
	onDeleted: () => void;
}): JSX.Element {
	return (
		<div className="agent-detail-corner relative z-10 ml-1 flex flex-1 flex-col overflow-hidden bg-white shadow-[0_4px_24px_rgba(0,0,0,0.04)]">
			{showCreateAgent ? (
				<CreateAgentView onCancel={onCancelCreate} onCreated={onCreated} onError={onError} />
			) : showSettings ? (
				<GlobalSettingsView onError={onError} onClose={onCloseSettings} />
			) : agent ? (
				<AgentDetailView
					agent={agent}
					onError={onError}
					onDeleted={onDeleted}
				/>
			) : (
				<div className="drag-region flex h-full items-center justify-center bg-white text-muted-foreground">
					<div className="no-drag flex flex-col items-center">
						<AppIcon IconComponent={SmileCircleBoldDuotone} className="mb-4 h-12 w-12 text-[var(--lime-10)]" />
						<p className="text-sm font-medium text-foreground">
							{isLoadingAgents ? "正在加载 Agent..." : hasAgents ? "选择一个 Agent" : "尚未创建 Agent"}
						</p>
						{!isLoadingAgents && !hasAgents && (
							<Button className="mt-5 h-9 rounded-4xl px-5 shadow-[0_1px_3px_rgba(0,0,0,0.08)]" onClick={onCreateAgent}>
								新建 Agent
							</Button>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
