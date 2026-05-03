import { CPUBoltBoldDuotone, SettingsMinimalisticBoldDuotone } from "solar-icon-set";
import { motion } from "motion/react";
import type { AgentSummary } from "../../shared/types";
import { AgentAvatar } from "../components/shared/agent-avatar";
import { AppIcon } from "../components/shared/app-icon";
import { AceternityTooltip } from "../components/shared/tooltip";
import { Button } from "../components/ui/button";
import { Spinner } from "../components/ui/spinner-1";
import { cn } from "../lib/utils";
import { runtimeLifecycleLabel, runtimeLifecycleTone, statusTone } from "../features/agents/agent-display";

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
	const selectionTransition = {
		type: "spring",
		stiffness: 430,
		damping: 18,
		mass: 0.9,
	} as const;
	const selectedIndex = agents?.findIndex((agent) => agent.id === selectedId) ?? -1;

	return (
		<div className="pie-smooth-corner relative z-10 flex w-[260px] shrink-0 flex-col rounded-[var(--app-shell-radius)] bg-transparent">
			<div className="drag-region h-9 shrink-0" />
			<div className="flex-1 overflow-y-auto px-2 pb-4 pt-3">
				{isLoading ? (
					<div className="flex h-20 items-center justify-center">
						<AppIcon IconComponent={CPUBoltBoldDuotone} className="h-5 w-5 animate-pulse text-muted-foreground" />
					</div>
				) : (
					<div className="relative space-y-1">
						{selectedIndex >= 0 ? (
							<motion.span
								className="pie-smooth-corner pointer-events-none absolute inset-x-0 top-0 z-0 h-[72px] rounded-[36px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.025)]"
								initial={false}
								animate={{
									y: selectedIndex * 76,
									scaleX: [0.96, 1.045, 1],
									scaleY: [1.025, 0.975, 1],
								}}
								transition={{
									y: selectionTransition,
									scaleX: { duration: 0.5, ease: [0.2, 0, 0, 1] },
									scaleY: { duration: 0.5, ease: [0.2, 0, 0, 1] },
								}}
								style={{ transformOrigin: "center" }}
							/>
						) : null}
						{agents?.map((agent) => {
							const isSelected = agent.id === selectedId;
							const subtitle = formatAgentSubtitle(agent);
							return (
								<Button
									key={agent.id}
									variant="unstyled"
									size="inline"
									onClick={() => onSelectAgent(agent.id)}
									className={cn(
										"pie-smooth-corner relative z-10 flex h-[72px] w-full items-center gap-3 rounded-[36px] border-0 px-2.5 py-3 text-left transition-[background-color,color] duration-200 active:!translate-y-0",
										isSelected ? "text-foreground" : "text-foreground/80 shadow-none hover:bg-white/60 hover:text-foreground",
									)}
								>
									<AgentAvatar seed={agent.avatarSeed} src={agent.avatarUrl} size={40} />
									<div className="min-w-0 flex-1">
										<div className="truncate text-sm font-medium">{agent.name}</div>
										<div className="mt-1 truncate text-xs text-muted-foreground opacity-80">
											{subtitle}
										</div>
									</div>
									<AgentStatusMark agent={agent} />
								</Button>
							);
						})}
					</div>
				)}
			</div>
			<div className="flex shrink-0 items-center gap-2 px-3 pb-4 pt-2">
				<AceternityTooltip content="创建新的 Agent" className="min-w-0 flex-1">
					<Button
						className="no-drag h-9 w-full min-w-0 rounded-4xl shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
						onClick={onCreateAgent}
						aria-label="创建新的 Agent"
					>
						<span className="truncate">创建</span>
					</Button>
				</AceternityTooltip>
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

function formatFrameworkName(kind: string | undefined): string {
	const labels: Record<string, string> = {
		pi: "Pi",
		ousia: "Ousia",
		hermes: "Hermes",
		openclaw: "Openclaw",
		"claude-code": "Claude Code",
		claude: "Claude Code",
		codex: "Codex",
	};
	const label = kind ? labels[kind] : undefined;
	if (label) {
		return label;
	}
	if (!kind?.trim()) {
		return "Agent";
	}
	return kind
		.split(/[-_\s]+/)
		.filter(Boolean)
		.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
		.join(" ");
}

function formatAgentSubtitle(agent: AgentSummary): string {
	const framework = formatFrameworkName(agent.frameworkKind);
	if (!agent.modelLabel) {
		return `${framework}, 未配置模型`;
	}
	return `${framework}, ${agent.modelLabel}`;
}

function formatRuntimeTooltip(agent: AgentSummary): string {
	const lifecycle = agent.runtimeEnvironment?.lifecycle;
	const label = runtimeLifecycleLabel(lifecycle?.state);
	const workDir = agent.runtimeEnvironment?.workDir;
	if (!workDir) {
		return label;
	}
	return `${label} · 工作目录：${workDir}`;
}

function AgentStatusMark({ agent }: { agent: AgentSummary }): JSX.Element {
	const status = agent.status;
	if (status === "starting") {
		return (
			<AceternityTooltip content={formatRuntimeTooltip(agent)} side="bottom">
				<span className="mr-1 grid h-5 w-5 shrink-0 place-items-center" aria-label="启动中">
					<Spinner size={18} color="var(--slate-11)" />
				</span>
			</AceternityTooltip>
		);
	}
	const lifecycleTone = runtimeLifecycleTone(agent.runtimeEnvironment?.lifecycle.state);
	return (
		<AceternityTooltip content={formatRuntimeTooltip(agent)} side="bottom">
			<span className={cn("mr-2 h-2 w-2 shrink-0 rounded-full", agent.runtimeEnvironment ? lifecycleTone : statusTone(status))} />
		</AceternityTooltip>
	);
}
