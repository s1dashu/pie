import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Toaster, toast } from "./components/ui/sonner";
import { AgentDetailPane } from "./layout/AgentDetailPane";
import { AgentSidebar } from "./layout/AgentSidebar";
import { applyAppearanceTheme } from "./lib/appearance-theme";

type AppSelection = { type: "agent"; id: string } | { type: "settings" } | { type: "create" };

export function App(): JSX.Element {
	const [selection, setSelection] = useState<AppSelection | undefined>();
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
		applyAppearanceTheme(settings.data?.appearanceGrayHue);
	}, [settings.data?.appearanceGrayHue]);

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
			return {
				...current,
				...summary,
				model: current.model,
				brand: current.brand,
				appSecret: current.appSecret,
				wechat: current.wechat,
			};
		});
	}, [agents.data, queryClient, selected.data, selectedId]);

	return (
		<main className="app-continuous-corner relative flex h-full w-full overflow-hidden bg-[var(--slate-2)] p-[var(--app-shell-gap)] text-foreground">
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
		</main>
	);
}
