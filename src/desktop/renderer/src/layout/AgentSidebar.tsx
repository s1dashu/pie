import { CPUBoltBoldDuotone, SettingsMinimalisticBoldDuotone } from "solar-icon-set";
import type { AgentSummary } from "../../shared/types";
import { AgentAvatar } from "../components/shared/agent-avatar";
import { AppIcon } from "../components/shared/app-icon";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import { statusLabel, statusTone } from "../features/agents/agent-display";

export function AgentSidebar({
	agents,
	selectedId,
	isLoading,
	onSelectAgent,
	onCreateAgent,
}: {
	agents?: AgentSummary[];
	selectedId?: string;
	isLoading: boolean;
	onSelectAgent: (agentId: string) => void;
	onCreateAgent: () => void;
}): JSX.Element {
	return (
		<div className="pie-smooth-corner relative z-10 flex w-[260px] shrink-0 flex-col rounded-[var(--app-shell-radius)] bg-transparent">
			<div className="drag-region h-9 shrink-0" />
			<div className="flex-1 overflow-y-auto px-2 pb-4 pt-3">
				{isLoading ? (
					<div className="flex h-20 items-center justify-center">
						<AppIcon IconComponent={CPUBoltBoldDuotone} className="h-5 w-5 animate-pulse text-muted-foreground" />
					</div>
				) : (
					<div className="space-y-1">
						{agents?.map((agent) => {
							const isSelected = agent.id === selectedId;
							return (
								<Button
									key={agent.id}
									variant="unstyled"
									size="inline"
									onClick={() => onSelectAgent(agent.id)}
									className={cn(
											"pie-smooth-corner flex min-h-[72px] w-full items-center gap-3 rounded-[36px] px-2.5 py-3 text-left transition-all",
										isSelected ? "bg-white text-foreground" : "text-foreground/80 hover:bg-white/60 hover:text-foreground",
									)}
								>
									<AgentAvatar seed={agent.avatarSeed} size={40} />
									<div className="min-w-0 flex-1">
										<div className="truncate text-sm font-medium">{agent.name}</div>
										<div className="mt-1 flex items-center gap-1.5">
											<span className={cn("h-1.5 w-1.5 rounded-full", statusTone(agent.status))} />
											<span className="truncate text-xs text-muted-foreground opacity-80">
												{agent.modelLabel ?? statusLabel(agent.status)}
											</span>
										</div>
									</div>
								</Button>
							);
						})}
					</div>
				)}
			</div>
			<div className="flex shrink-0 items-center gap-2 px-2 pb-3 pt-2">
				<Button
					variant="unstyled"
					size="inline"
					className="pie-smooth-corner no-drag flex h-12 min-w-0 flex-1 items-center justify-center rounded-[36px] bg-white px-4 text-sm font-medium text-foreground transition hover:bg-[var(--slate-2)] hover:text-[var(--lime-11)]"
					onClick={onCreateAgent}
					aria-label="创建 Agent"
				>
					<span className="truncate">创建 Agent</span>
				</Button>
				<Button
					variant="unstyled"
					size="inline"
					className="pie-smooth-corner no-drag flex h-12 w-12 shrink-0 items-center justify-center rounded-[36px] bg-white text-[var(--lime-11)] transition hover:bg-[var(--slate-2)] hover:text-[var(--lime-12)]"
					aria-label="全局设置"
					title="全局设置"
				>
					<AppIcon IconComponent={SettingsMinimalisticBoldDuotone} className="size-6" />
				</Button>
			</div>
		</div>
	);
}
