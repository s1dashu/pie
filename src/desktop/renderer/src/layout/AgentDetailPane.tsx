import { AnimatePresence, motion } from "motion/react";
import { SmileCircleBoldDuotone } from "solar-icon-set";
import { lazy, Suspense, type ReactNode } from "react";
import type { AgentDetails } from "../../shared/types";
import { AgentLoadingIndicator } from "../components/shared/agent-loading-indicator";
import { AppIcon } from "../components/shared/app-icon";
import { Button } from "../components/ui/button";
import { AgentDetailView } from "../features/agents/AgentDetailView";
import { UsageTipsView } from "../features/docs/UsageTipsView";
import { useI18n } from "../lib/i18n";

const CreateAgentView = lazy(() => import("../features/agents/CreateAgentView").then((module) => ({ default: module.CreateAgentView })));
const GlobalSettingsView = lazy(() => import("../features/settings/GlobalSettingsView").then((module) => ({ default: module.GlobalSettingsView })));

const detailPaneMotion = {
	initial: { opacity: 0, scale: 1.01, filter: "blur(5px)" },
	animate: { opacity: 1, scale: 1, filter: "blur(0px)" },
	exit: { opacity: 0, scale: 0.992, filter: "blur(4px)" },
};

const detailPaneTransition = { type: "spring", duration: 0.28, bounce: 0 } as const;
const detailPaneExitTransition = { duration: 0.15, ease: [0.4, 0, 1, 1] } as const;

export function AgentDetailPane({
	agent,
	showDocs,
	showSettings,
	showCreateAgent,
	hasAgents,
	isLoadingAgents,
	onCreateAgent,
	onError,
	onCloseDocs,
	onCloseSettings,
	onCancelCreate,
	onCreated,
	onDeleted,
}: {
	agent?: AgentDetails;
	showDocs?: boolean;
	showSettings?: boolean;
	showCreateAgent?: boolean;
	hasAgents?: boolean;
	isLoadingAgents?: boolean;
	onCreateAgent: () => void;
	onError: (message: string) => void;
	onCloseDocs: () => void;
	onCloseSettings: () => void;
	onCancelCreate: () => void;
	onCreated: (agent: AgentDetails) => void;
	onDeleted: () => void;
}): JSX.Element {
	const { t } = useI18n();
	return (
		<div className="agent-detail-corner agent-detail-surface relative z-10 ml-1 flex flex-1 flex-col overflow-hidden bg-white">
			<div className="relative min-h-0 flex-1 overflow-hidden bg-white">
				<AnimatePresence initial={false} mode="wait">
					{showCreateAgent ? (
						<AnimatedDetailPane key="create-agent">
							<Suspense fallback={<DetailLoading label={t("loading")} />}>
								<CreateAgentView onCancel={onCancelCreate} onCreated={onCreated} onError={onError} />
							</Suspense>
						</AnimatedDetailPane>
					) : showDocs ? (
						<AnimatedDetailPane key="usage-tips">
							<UsageTipsView onClose={onCloseDocs} />
						</AnimatedDetailPane>
					) : showSettings ? (
						<AnimatedDetailPane key="global-settings">
							<Suspense fallback={<DetailLoading label={t("loading")} />}>
								<GlobalSettingsView onError={onError} onClose={onCloseSettings} />
							</Suspense>
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
							{isLoadingAgents ? (
								<AgentLoadingIndicator className="no-drag h-20" label={t("loadingAgents")} />
							) : (
								<div className="no-drag flex flex-col items-center">
									<AppIcon IconComponent={SmileCircleBoldDuotone} className="mb-4 h-12 w-12 text-[var(--lime-10)]" />
									<p className="text-sm font-medium text-foreground">
										{hasAgents ? t("selectAgent") : t("noAgents")}
									</p>
									{!hasAgents && (
										<Button className="mt-5 h-9 rounded-4xl px-5 shadow-[0_1px_3px_rgba(0,0,0,0.08)]" onClick={onCreateAgent}>
											{t("newAgent")}
										</Button>
									)}
								</div>
							)}
						</div>
					)}
				</AnimatePresence>
			</div>
		</div>
	);
}

function DetailLoading({ label }: { label: string }): JSX.Element {
	return <AgentLoadingIndicator className="h-full bg-white" label={label} />;
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
