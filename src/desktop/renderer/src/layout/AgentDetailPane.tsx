import { AnimatePresence, motion } from "motion/react";
import { SmileCircleBoldDuotone } from "solar-icon-set";
import type { ReactNode } from "react";
import type { AgentDetails } from "../../shared/types";
import { AppIcon } from "../components/shared/app-icon";
import { Button } from "../components/ui/button";
import { AgentDetailView } from "../features/agents/AgentDetailView";
import { CreateAgentView } from "../features/agents/CreateAgentView";
import { GlobalSettingsView } from "../features/settings/GlobalSettingsView";

const detailPaneMotion = {
	initial: { opacity: 0, scale: 1.01, filter: "blur(5px)" },
	animate: { opacity: 1, scale: 1, filter: "blur(0px)" },
	exit: { opacity: 0, scale: 0.992, filter: "blur(4px)" },
};

const detailPaneTransition = { type: "spring", duration: 0.28, bounce: 0 } as const;
const detailPaneExitTransition = { duration: 0.15, ease: [0.4, 0, 1, 1] } as const;

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
			<div className="relative min-h-0 flex-1 overflow-hidden bg-white">
				<AnimatePresence initial={false} mode="wait">
					{showCreateAgent ? (
						<AnimatedDetailPane key="create-agent">
							<CreateAgentView onCancel={onCancelCreate} onCreated={onCreated} onError={onError} />
						</AnimatedDetailPane>
					) : showSettings ? (
						<AnimatedDetailPane key="global-settings">
							<GlobalSettingsView onError={onError} onClose={onCloseSettings} />
						</AnimatedDetailPane>
					) : agent ? (
						<AnimatedDetailPane key={`agent-${agent.id}`}>
							<AgentDetailView
								agent={agent}
								onError={onError}
								onDeleted={onDeleted}
							/>
						</AnimatedDetailPane>
					) : (
						<div key="empty" className="drag-region flex h-full items-center justify-center bg-white text-muted-foreground">
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
				</AnimatePresence>
			</div>
		</div>
	);
}

function AnimatedDetailPane({ children }: { children: ReactNode }): JSX.Element {
	return (
		<motion.div
			className="absolute inset-0 h-full bg-white will-change-[transform,opacity,filter]"
			initial={detailPaneMotion.initial}
			animate={detailPaneMotion.animate}
			exit={{
				...detailPaneMotion.exit,
				transition: detailPaneExitTransition,
			}}
			transition={detailPaneTransition}
		>
			{children}
		</motion.div>
	);
}
