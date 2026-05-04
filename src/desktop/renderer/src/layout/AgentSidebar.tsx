import { CPUBoltBoldDuotone, SettingsMinimalisticBoldDuotone } from "solar-icon-set";
import { AnimatePresence, motion } from "motion/react";
import type { AgentSummary } from "../../shared/types";
import { AgentAvatar } from "../components/shared/agent-avatar";
import { AppIcon } from "../components/shared/app-icon";
import { AceternityTooltip } from "../components/shared/tooltip";
import { Button } from "../components/ui/button";
import { Spinner } from "../components/ui/spinner-1";
import { useI18n } from "../lib/i18n";
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
	const { t } = useI18n();
	const selectionTransition = {
		type: "spring",
		stiffness: 520,
		damping: 38,
		mass: 0.7,
	} as const;
	const listItemTransition = { type: "spring", duration: 0.26, bounce: 0 } as const;
	const listItemExitTransition = { duration: 0.14, ease: [0.4, 0, 1, 1] } as const;
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
					<div className="relative flex flex-col gap-1">
						{selectedIndex >= 0 ? (
							<motion.span
								className="pie-smooth-corner pointer-events-none absolute inset-x-0 top-0 z-0 h-[72px] rounded-[36px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.025)]"
								initial={false}
								animate={{
									opacity: 1,
									scale: 1,
									y: selectedIndex * 76,
								}}
								transition={selectionTransition}
							/>
						) : null}
						<AnimatePresence initial={false}>
							{agents?.map((agent) => {
								const isSelected = agent.id === selectedId;
								const subtitle = formatAgentSubtitle(agent, t);
								return (
									<motion.div
										key={agent.id}
										layout="position"
										initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
										animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
										exit={{
											opacity: 0,
											y: -4,
											filter: "blur(3px)",
											transition: listItemExitTransition,
										}}
										transition={listItemTransition}
									>
										<Button
											variant="unstyled"
											size="inline"
											onClick={() => onSelectAgent(agent.id)}
											className={cn(
												"pie-smooth-corner relative z-10 flex h-[72px] w-full items-center gap-3 rounded-[36px] border-0 px-2.5 py-3 text-left transition-[color,opacity] duration-200 active:!translate-y-0",
												isSelected ? "text-foreground" : "text-foreground/75 shadow-none hover:text-foreground hover:opacity-95",
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
									</motion.div>
								);
							})}
						</AnimatePresence>
					</div>
				)}
			</div>
			<div className="flex shrink-0 items-center gap-2 px-3 pb-4 pt-2">
				<AceternityTooltip content={t("createAgentTooltip")} className="min-w-0 flex-1">
					<Button
						className="no-drag h-9 w-full min-w-0 rounded-4xl shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
						onClick={onCreateAgent}
						aria-label={t("createAgentTooltip")}
					>
						<span className="truncate">{t("create")}</span>
					</Button>
				</AceternityTooltip>
				<AceternityTooltip content={t("globalSettings")}>
					<Button
						variant="unstyled"
						size="inline"
						className={cn(
							"no-drag inline-flex h-8 w-8 shrink-0 items-center justify-center text-[var(--slate-10)] transition hover:text-[var(--slate-12)]",
							settingsSelected ? "text-[var(--lime-11)]" : "",
						)}
						onClick={onSelectSettings}
						aria-label={t("globalSettings")}
					>
						<AppIcon IconComponent={SettingsMinimalisticBoldDuotone} className="size-7" />
					</Button>
				</AceternityTooltip>
			</div>
		</div>
	);
}

function formatFrameworkName(kind: string | undefined, t: ReturnType<typeof useI18n>["t"]): string {
	if (!kind?.trim()) {
		return t("agent");
	}
	return formatMetadataLabel(kind);
}

function formatChannelNames(kinds: string[] | undefined, t: ReturnType<typeof useI18n>["t"]): string {
	const values = kinds?.map(formatMetadataLabel).filter(Boolean) ?? [];
	return values.length ? values.join("+") : t("noChannel");
}

function formatMetadataLabel(value: string | undefined): string {
	const normalized = value?.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ") ?? "";
	return normalized
		.split(" ")
		.filter(Boolean)
		.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
		.join(" ");
}

function formatAgentSubtitle(agent: AgentSummary, t: ReturnType<typeof useI18n>["t"]): string {
	const framework = formatFrameworkName(agent.frameworkKind, t);
	const channels = formatChannelNames(agent.channelKinds, t);
	return `${framework} ${t("on")} ${channels}`;
}

function formatRuntimeTooltip(agent: AgentSummary, language: ReturnType<typeof useI18n>["language"], t: ReturnType<typeof useI18n>["t"]): string {
	const lifecycle = agent.runtimeEnvironment?.lifecycle;
	const label = runtimeLifecycleLabel(lifecycle?.state, language);
	const workDir = agent.runtimeEnvironment?.workDir;
	if (!workDir) {
		return label;
	}
	return `${label} · ${t("workDir")}: ${workDir}`;
}

function AgentStatusMark({ agent }: { agent: AgentSummary }): JSX.Element {
	const { language, t } = useI18n();
	const status = agent.status;
	if (status === "starting") {
		return (
			<AceternityTooltip content={formatRuntimeTooltip(agent, language, t)} side="bottom">
				<span className="mr-1 grid h-5 w-5 shrink-0 place-items-center" aria-label={t("starting")}>
					<Spinner size={18} color="var(--slate-11)" />
				</span>
			</AceternityTooltip>
		);
	}
	const lifecycleTone = runtimeLifecycleTone(agent.runtimeEnvironment?.lifecycle.state);
	return (
		<AceternityTooltip content={formatRuntimeTooltip(agent, language, t)} side="bottom">
			<span className={cn("mr-2 h-2 w-2 shrink-0 rounded-full", agent.runtimeEnvironment ? lifecycleTone : statusTone(status))} />
		</AceternityTooltip>
	);
}
