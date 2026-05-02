import { CPUBoltBoldDuotone, SettingsMinimalisticBoldDuotone } from "solar-icon-set";
import type { AgentSummary } from "../../shared/types";
import { AgentAvatar } from "../components/shared/agent-avatar";
import { AppIcon } from "../components/shared/app-icon";
import { AceternityTooltip } from "../components/shared/tooltip";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import { statusLabel, statusTone } from "../features/agents/agent-display";

export function AgentSidebar({
	agents,
	selectedId,
	settingsSelected,
	isLoading,
	onSelectAgent,
	onSelectSettings,
	onCreateAgent,
}: {
	agents?: AgentSummary[];
	selectedId?: string;
	settingsSelected?: boolean;
	isLoading: boolean;
	onSelectAgent: (agentId: string) => void;
	onSelectSettings: () => void;
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
										"pie-smooth-corner flex min-h-[72px] w-full items-center gap-3 rounded-[36px] px-2.5 py-3 text-left transition-all duration-200 hover:scale-[1.01] active:scale-[0.96]",
										isSelected ? "bg-white text-foreground shadow-[0_1px_3px_rgba(0,0,0,0.04)]" : "text-foreground/80 hover:bg-white/60 hover:text-foreground",
									)}
								>
									<AgentAvatar seed={agent.avatarSeed} src={agent.avatarUrl} size={40} />
									<div className="min-w-0 flex-1">
										<div className="truncate text-sm font-medium">{agent.name}</div>
										<div className="mt-1 truncate text-xs text-muted-foreground opacity-80">
											{agent.modelLabel ?? statusLabel(agent.status)}
										</div>
									</div>
									<span className={cn("mr-1.5 h-2 w-2 shrink-0 rounded-full", statusTone(agent.status))} />
								</Button>
							);
						})}
					</div>
				)}
			</div>
			<div className="flex shrink-0 items-center gap-2 px-3 pb-4 pt-2">
				<Button
					className="no-drag h-9 min-w-0 flex-1 rounded-4xl shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
					onClick={onCreateAgent}
					aria-label="创建"
				>
					<span className="truncate">创建</span>
				</Button>
				<AceternityTooltip content="全局设置">
					<Button
						variant="unstyled"
						size="inline"
						className={cn(
							"no-drag inline-flex h-8 w-8 shrink-0 items-center justify-center text-[var(--slate-10)] transition hover:text-[var(--slate-12)]",
							settingsSelected ? "text-[var(--lime-11)]" : "",
						)}
						onClick={onSelectSettings}
						aria-label="全局设置"
					>
						<AppIcon IconComponent={SettingsMinimalisticBoldDuotone} className="size-7" />
					</Button>
				</AceternityTooltip>
			</div>
		</div>
	);
}
