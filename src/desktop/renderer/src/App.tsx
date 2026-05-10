import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { AgentDetails, AgentSummary, DesktopQuitAgent } from "../shared/types";
import { AgentLoadingIndicator } from "./components/shared/agent-loading-indicator";
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

type AppSelection = { type: "agent"; id: string } | { type: "settings" } | { type: "docs" } | { type: "create" };
type QuitOverlayAgent = DesktopQuitAgent & { stopped: boolean; stoppedAt?: number };

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
	const [quittingAgents, setQuittingAgents] = useState<QuitOverlayAgent[]>();
	const pendingStoppedAgentsRef = useRef<DesktopQuitAgent[]>([]);
	const stoppedAgentsFrameRef = useRef<number>();
	const queryClient = useQueryClient();
	const selectedId = selection?.type === "agent" ? selection.id : undefined;

	const handleError = (message: string) => {
		toast.error(message);
	};

	const bootstrap = useQuery({
		queryKey: ["desktop-bootstrap"],
		queryFn: () => window.pie.getDesktopBootstrap(),
		staleTime: 60_000,
	});
	const agents = useQuery({
		queryKey: ["agents"],
		queryFn: () => window.pie.listAgents(),
		enabled: bootstrap.isSuccess,
		initialData: () => queryClient.getQueryData<AgentSummary[]>(["agents"]),
		staleTime: 2500,
		refetchInterval: 10_000,
	});
	const settings = useQuery({
		queryKey: ["settings"],
		queryFn: () => window.pie.getSettings(),
		enabled: bootstrap.isError,
		initialData: () => queryClient.getQueryData(["settings"]),
		staleTime: 60_000,
	});
	const selected = useQuery({
		queryKey: ["agent", selectedId],
		queryFn: () => window.pie.getAgent(selectedId!),
		enabled: Boolean(selectedId) && bootstrap.isSuccess,
		initialData: () => selectedId ? queryClient.getQueryData(["agent", selectedId]) : undefined,
		staleTime: 2000,
	});

	useEffect(() => {
		if (!bootstrap.data) {
			return;
		}
		queryClient.setQueryData(["settings"], bootstrap.data.settings);
		queryClient.setQueryData(["agents"], bootstrap.data.agents);
		if (bootstrap.data.selectedAgent) {
			queryClient.setQueryData(["agent", bootstrap.data.selectedAgent.id], bootstrap.data.selectedAgent);
			setSelection((current) => current ?? { type: "agent", id: bootstrap.data.selectedAgent!.id });
		}
	}, [bootstrap.data, queryClient]);

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
		return window.pie.onAgentChange((event) => {
			void queryClient.invalidateQueries({ queryKey: ["agents"] });
			for (const agentId of event.agentIds) {
				void queryClient.invalidateQueries({ queryKey: ["agent", agentId] });
			}
		});
	}, [queryClient]);

	useEffect(() => {
		const flushStoppedAgents = () => {
			stoppedAgentsFrameRef.current = undefined;
			const stoppedAgents = pendingStoppedAgentsRef.current.splice(0);
			if (!stoppedAgents.length) {
				return;
			}
			const stoppedAt = Date.now();
			setQuittingAgents((current) => {
				const byId = new Map((current ?? []).map((agent) => [agent.id, agent]));
				for (const agent of stoppedAgents) {
					byId.set(agent.id, { ...byId.get(agent.id), ...agent, stopped: true, stoppedAt });
				}
				return Array.from(byId.values());
			});
		};
		const unsubscribe = window.pie.onDesktopQuitEvent((event) => {
			if (event.phase === "agent-stopped") {
				pendingStoppedAgentsRef.current.push(event.agent);
				stoppedAgentsFrameRef.current ??= window.requestAnimationFrame(flushStoppedAgents);
				return;
			}
			pendingStoppedAgentsRef.current = [];
			if (stoppedAgentsFrameRef.current !== undefined) {
				window.cancelAnimationFrame(stoppedAgentsFrameRef.current);
				stoppedAgentsFrameRef.current = undefined;
			}
			const agentIds = new Set(event.agentIds);
			setQuittingAgents(event.agents.map((agent) => ({ ...agent, stopped: false })));
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
		return () => {
			unsubscribe();
			if (stoppedAgentsFrameRef.current !== undefined) {
				window.cancelAnimationFrame(stoppedAgentsFrameRef.current);
				stoppedAgentsFrameRef.current = undefined;
			}
		};
	}, [queryClient]);

	useEffect(() => {
		if (!agents.data || selection?.type === "settings" || selection?.type === "docs" || selection?.type === "create") {
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
			<main className="app-continuous-corner app-shell-surface relative flex h-full w-full overflow-hidden bg-[var(--slate-3)] p-[var(--app-shell-gap)] text-foreground">
				<div className="drag-region absolute left-0 right-0 top-0 z-0 h-10 w-full" />
				<AgentSidebar
					agents={agents.data}
					selectedId={selectedId}
					docsSelected={selection?.type === "docs"}
					settingsSelected={selection?.type === "settings"}
					isLoading={agents.isLoading}
					onSelectAgent={(id) => setSelection({ type: "agent", id })}
					onSelectDocs={() => setSelection({ type: "docs" })}
					onSelectSettings={() => setSelection({ type: "settings" })}
					onCreateAgent={() => {
						setSelection({ type: "create" });
					}}
				/>
				<AgentDetailPane
					agent={selectedId ? selected.data : undefined}
					showDocs={selection?.type === "docs"}
					showSettings={selection?.type === "settings"}
					showCreateAgent={selection?.type === "create"}
					hasAgents={Boolean(agents.data?.length)}
					isLoadingAgents={agents.isLoading}
					onCreateAgent={() => setSelection({ type: "create" })}
					onError={handleError}
					onCloseDocs={() => setSelection(undefined)}
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
				{quittingAgents?.length ? <QuitOverlay agents={quittingAgents} /> : null}
			</main>
		</I18nProvider>
	);
}

function QuitOverlay({ agents }: { agents: QuitOverlayAgent[] }): JSX.Element {
	const { t } = useI18n();
	const stoppedListRef = useRef<HTMLDivElement>(null);
	const stoppedAgents = agents.filter((agent) => agent.stopped);

	useEffect(() => {
		const node = stoppedListRef.current;
		if (!node) {
			return;
		}
		const frame = window.requestAnimationFrame(() => {
			node.scrollTop = node.scrollHeight;
		});
		return () => window.cancelAnimationFrame(frame);
	}, [stoppedAgents.length]);

	return (
		<div className="app-shell-overlay no-drag inset-0 flex items-center justify-center bg-white px-6 text-center">
			<div className="drag-region absolute left-0 right-0 top-0 h-10 w-full" />
			<div className="flex w-full max-w-[420px] flex-col items-stretch">
				<div className="flex items-center justify-center gap-3 text-lg font-semibold leading-7 text-foreground">
					<span className="grid h-5 w-5 shrink-0 place-items-center" aria-hidden="true">
						<Spinner size={18} color="var(--slate-11)" />
					</span>
					<span>{t("quittingTitle")}</span>
				</div>
				{stoppedAgents.length ? (
					<div
						ref={stoppedListRef}
						className="quit-agent-list mx-auto mt-8 flex max-h-[340px] w-[286px] flex-col gap-2 overflow-y-auto text-left"
					>
						{stoppedAgents.map((agent) => (
							<div
								key={agent.id}
								className="grid h-9 w-full shrink-0 grid-cols-[28px_minmax(0,132px)_1fr_20px] items-center gap-2"
							>
								<AgentAvatar seed={agent.avatarSeed} src={agent.avatarUrl} size={28} label={agent.name} />
								<span className="min-w-0 truncate text-sm font-medium leading-5 text-foreground">
									{agent.name} {t("quittingExited")}
								</span>
								<span aria-hidden="true" />
								<QuitCheckIcon />
							</div>
						))}
					</div>
				) : null}
			</div>
		</div>
	);
}

function QuitCheckIcon(): JSX.Element {
	return (
		<span className="grid size-5 place-items-center rounded-full bg-[var(--lime-10)]" aria-hidden="true">
			<svg viewBox="0 0 24 24" className="size-4" fill="none" xmlns="http://www.w3.org/2000/svg">
				<path
					d="M7.8 12.2 10.55 15 16.4 9.15"
					stroke="white"
					strokeWidth="2.7"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
		</span>
	);
}

function MenuBarAgentList(): JSX.Element {
	const agents = useQuery({
		queryKey: ["menu-bar-agents"],
		queryFn: () => window.pie.listAgents(),
		refetchInterval: 5_000,
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
						<AgentLoadingIndicator className="px-2 py-8" label={t("loading")} />
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
			<AgentAvatar seed={agent.avatarSeed} src={agent.avatarUrl} size={38} label={agent.name} />
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
