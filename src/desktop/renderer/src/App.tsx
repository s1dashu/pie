import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { AgentDetails, AgentSummary } from "../shared/types";
import { AgentAvatar } from "./components/shared/agent-avatar";
import { Spinner } from "./components/ui/spinner-1";
import { Toaster, toast } from "./components/ui/sonner";
import { runtimeLifecycleLabel, runtimeLifecycleTone, statusLabel, statusTone } from "./features/agents/agent-display";
import { formatAgentSubtitle } from "./features/agents/agent-labels";
import { AgentDetailPane } from "./layout/AgentDetailPane";
import { AgentSidebar } from "./layout/AgentSidebar";
import { cn } from "./lib/utils";
import { applyDesktopAppearance, watchSystemColorScheme } from "./lib/appearance-theme";
import { I18nProvider, useI18n } from "./lib/i18n";

type AppSelection = { type: "agent"; id: string } | { type: "settings" } | { type: "create" };

function agentSummaryFingerprint(agent: AgentSummary): string {
	return JSON.stringify({
		id: agent.id,
		name: agent.name,
		status: agent.status,
		avatarSeed: agent.avatarSeed,
		avatarUrl: agent.avatarUrl,
		desiredState: agent.desiredState,
		selected: agent.selected,
		home: agent.home,
		runtimeEnvironment: agent.runtimeEnvironment,
		createdAt: agent.createdAt,
		updatedAt: agent.updatedAt,
		harnessKind: agent.harnessKind,
		modelLabel: agent.modelLabel,
		channelKinds: agent.channelKinds,
		appId: agent.appId,
	});
}

function mergeAgentSummaryIntoDetails(current: AgentDetails, summary: AgentSummary): AgentDetails {
	const next = {
		...current,
		...summary,
		model: current.model,
		brand: current.brand,
		appSecret: current.appSecret,
		wechat: current.wechat,
	};
	return agentSummaryFingerprint(current) === agentSummaryFingerprint(next) ? current : next;
}

export function App(): JSX.Element {
	const mode = new URLSearchParams(window.location.search).get("mode");
	if (mode === "menubar") {
		return <MenuBarAgentList />;
	}

	const [selection, setSelection] = useState<AppSelection | undefined>();
	const [quittingAgentIds, setQuittingAgentIds] = useState<string[]>();
	const queryClient = useQueryClient();
	const selectedId = selection?.type === "agent" ? selection.id : undefined;

	const handleError = (message: string) => {
		toast.error(message);
	};

	const agents = useQuery({
		queryKey: ["agents"],
		queryFn: () => window.pie.listAgents(),
		refetchInterval: 3000,
	});
	const settings = useQuery({
		queryKey: ["settings"],
		queryFn: () => window.pie.getSettings(),
	});
	const selected = useQuery({
		queryKey: ["agent", selectedId],
		queryFn: () => window.pie.getAgent(selectedId!),
		enabled: Boolean(selectedId),
	});

	useEffect(() => {
		applyDesktopAppearance(settings.data?.colorScheme, settings.data?.appearanceGrayHue);
		return watchSystemColorScheme(settings.data?.colorScheme, () => {
			applyDesktopAppearance(settings.data?.colorScheme, settings.data?.appearanceGrayHue);
		});
	}, [settings.data?.appearanceGrayHue, settings.data?.colorScheme]);

	useEffect(() => {
		if (agents.error) {
			handleError((agents.error as Error).message);
		}
	}, [agents.error]);

	useEffect(() => {
		if (selected.error) {
			handleError((selected.error as Error).message);
		}
	}, [selected.error]);

	useEffect(() => {
		return window.pie.onSelectAgent((agentId) => {
			setSelection({ type: "agent", id: agentId });
			void queryClient.invalidateQueries({ queryKey: ["agents"] });
			void queryClient.invalidateQueries({ queryKey: ["agent", agentId] });
		});
	}, [queryClient]);

	useEffect(() => {
		return window.pie.onDesktopQuitEvent((event) => {
			if (event.phase !== "terminating-agents") {
				return;
			}
			const agentIds = new Set(event.agentIds);
			setQuittingAgentIds(event.agentIds);
			const updatedAt = new Date().toISOString();
			queryClient.setQueryData<AgentSummary[]>(["agents"], (current) =>
				current?.map((agent) =>
					agentIds.has(agent.id)
						? {
								...agent,
								status: "running",
								runtimeEnvironment: agent.runtimeEnvironment
									? {
											...agent.runtimeEnvironment,
											lifecycle: {
												state: "stopping",
												updatedAt,
												reason: "quit",
											},
										}
									: agent.runtimeEnvironment,
							}
						: agent,
				),
			);
			for (const agentId of event.agentIds) {
				queryClient.setQueryData<AgentDetails>(["agent", agentId], (current) =>
					current?.runtimeEnvironment
						? {
								...current,
								status: "running",
								runtimeEnvironment: {
									...current.runtimeEnvironment,
									lifecycle: {
										state: "stopping",
										updatedAt,
										reason: "quit",
									},
								},
							}
						: current,
				);
			}
		});
	}, [queryClient]);

	useEffect(() => {
		if (!agents.data || selection?.type === "settings" || selection?.type === "create") {
			return;
		}
		if (!agents.data.length) {
			if (selection?.type === "agent") {
				setSelection(undefined);
			}
			return;
		}
		const selectedAgentExists = selection?.type === "agent" && agents.data.some((agent) => agent.id === selection.id);
		if (!selectedAgentExists) {
			setSelection({ type: "agent", id: agents.data[0]!.id });
		}
	}, [agents.data, selection]);

	useEffect(() => {
		if (!agents.data || !selectedId) {
			return;
		}
		const summary = agents.data.find((agent) => agent.id === selectedId);
		if (!summary) {
			return;
		}
		queryClient.setQueryData(["agent", selectedId], (current: typeof selected.data) => {
			if (!current) {
				return current;
			}
			return mergeAgentSummaryIntoDetails(current, summary);
		});
	}, [agents.data, queryClient, selected.data, selectedId]);

	return (
		<I18nProvider language={settings.data?.language ?? "zh"}>
			<main className="app-continuous-corner app-shell-surface relative flex h-full w-full overflow-hidden bg-[var(--slate-2)] p-[var(--app-shell-gap)] text-foreground">
				<div className="drag-region absolute left-0 right-0 top-0 z-0 h-10 w-full" />
				<AgentSidebar
					agents={agents.data}
					selectedId={selectedId}
					settingsSelected={selection?.type === "settings"}
					isLoading={agents.isLoading}
					onSelectAgent={(id) => setSelection({ type: "agent", id })}
					onSelectSettings={() => setSelection({ type: "settings" })}
					onCreateAgent={() => {
						setSelection({ type: "create" });
					}}
				/>
				<AgentDetailPane
					agent={selectedId ? selected.data : undefined}
					showSettings={selection?.type === "settings"}
					showCreateAgent={selection?.type === "create"}
					hasAgents={Boolean(agents.data?.length)}
					isLoadingAgents={agents.isLoading}
					onCreateAgent={() => setSelection({ type: "create" })}
					onError={handleError}
					onCloseSettings={() => setSelection(undefined)}
					onCancelCreate={() => {
						setSelection(agents.data?.[0] ? { type: "agent", id: agents.data[0].id } : undefined);
					}}
					onCreated={(agent) => setSelection({ type: "agent", id: agent.id })}
					onDeleted={() => {
						setSelection(undefined);
						queryClient.removeQueries({ queryKey: ["agent", selectedId] });
					}}
				/>
				<Toaster />
				{quittingAgentIds?.length ? <QuitOverlay /> : null}
			</main>
		</I18nProvider>
	);
}

function QuitOverlay(): JSX.Element {
	const { t } = useI18n();
	return (
		<div className="app-shell-overlay no-drag inset-0 flex items-center justify-center bg-white px-6 text-center">
			<div className="flex items-center gap-2.5 text-base font-medium leading-6 text-foreground">
				<span className="grid h-5 w-5 shrink-0 place-items-center" aria-hidden="true">
					<Spinner size={18} color="var(--slate-11)" />
				</span>
				<span>{t("quittingTitle")}</span>
			</div>
		</div>
	);
}

function MenuBarAgentList(): JSX.Element {
	const agents = useQuery({
		queryKey: ["menu-bar-agents"],
		queryFn: () => window.pie.listAgents(),
		refetchInterval: 3000,
	});
	const settings = useQuery({
		queryKey: ["settings"],
		queryFn: () => window.pie.getSettings(),
	});

	useEffect(() => {
		applyDesktopAppearance(settings.data?.colorScheme, settings.data?.appearanceGrayHue);
		return watchSystemColorScheme(settings.data?.colorScheme, () => {
			applyDesktopAppearance(settings.data?.colorScheme, settings.data?.appearanceGrayHue);
		});
	}, [settings.data?.appearanceGrayHue, settings.data?.colorScheme]);

	return (
		<I18nProvider language={settings.data?.language ?? "zh"}>
			<MenuBarAgentListContent agents={agents.data} isLoading={agents.isLoading} />
		</I18nProvider>
	);
}

function MenuBarAgentListContent({ agents, isLoading }: { agents?: AgentSummary[]; isLoading: boolean }): JSX.Element {
	const { t } = useI18n();
	return (
		<main className="flex h-full w-full overflow-hidden bg-transparent p-2 text-foreground">
			<div className="pie-smooth-corner flex h-full w-full flex-col overflow-hidden rounded-[24px] border border-black/5 bg-white/95 shadow-[0_18px_44px_rgba(15,23,42,0.18)] backdrop-blur-xl">
				<div className="shrink-0 px-4 pb-2 pt-3">
					<div className="text-sm font-semibold leading-5 text-foreground">{t("agents")}</div>
					<div className="mt-0.5 text-xs leading-4 text-muted-foreground">
						{agents?.length ? t("agentCount", { count: agents.length }) : t("agentList")}
					</div>
				</div>
				<div className="max-h-[340px] flex-1 overflow-y-auto px-2 pb-2">
					{isLoading ? (
						<div className="px-2 py-8 text-center text-xs text-muted-foreground">{t("loading")}</div>
					) : agents?.length ? (
						<div className="flex flex-col gap-1">
							{agents.map((agent) => (
								<MenuBarAgentItem key={agent.id} agent={agent} />
							))}
						</div>
					) : (
						<div className="px-2 py-8 text-center text-xs text-muted-foreground">{t("noAgents")}</div>
					)}
				</div>
			</div>
		</main>
	);
}

function MenuBarAgentItem({ agent }: { agent: AgentSummary }): JSX.Element {
	const { language, t } = useI18n();
	const lifecycle = agent.runtimeEnvironment?.lifecycle;
	const lifecycleTone = runtimeLifecycleTone(lifecycle?.state);
	const statusText = lifecycle ? runtimeLifecycleLabel(lifecycle.state, language) : statusLabel(agent.status, language);
	const tone = agent.runtimeEnvironment ? lifecycleTone : statusTone(agent.status);
	const subtitle = formatAgentSubtitle(agent, t);

	return (
		<button
			type="button"
			className="pie-smooth-corner flex h-[64px] w-full items-center gap-3 rounded-[18px] px-2.5 text-left transition hover:bg-[var(--slate-3)] active:scale-[0.99]"
			onClick={() => void window.pie.openAgentFromMenuBar(agent.id)}
		>
			<AgentAvatar seed={agent.avatarSeed} src={agent.avatarUrl} size={38} />
			<div className="min-w-0 flex-1">
				<div className="truncate text-sm font-medium leading-5 text-foreground">{agent.name}</div>
				<div className="mt-0.5 truncate text-xs leading-4 text-muted-foreground">
					{subtitle}
				</div>
			</div>
			<div className="flex shrink-0 items-center gap-1.5">
				<span className={cn("h-2 w-2 rounded-full", tone)} />
				<span className="max-w-[52px] truncate text-xs text-muted-foreground">{statusText}</span>
			</div>
		</button>
	);
}
