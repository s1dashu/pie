import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Toaster, toast } from "./components/ui/sonner";
import { CreateAgentDialog } from "./features/agents/CreateAgentDialog";
import { AgentDetailPane } from "./layout/AgentDetailPane";
import { AgentSidebar } from "./layout/AgentSidebar";

type AppSelection = { type: "agent"; id: string } | { type: "settings" };

export function App(): JSX.Element {
	const [selection, setSelection] = useState<AppSelection | undefined>();
	const [creating, setCreating] = useState(false);
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
	const selected = useQuery({
		queryKey: ["agent", selectedId],
		queryFn: () => window.pie.getAgent(selectedId!),
		enabled: Boolean(selectedId),
	});

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

	return (
		<main className="app-continuous-corner relative flex h-full w-full overflow-hidden bg-[var(--slate-3)] p-[var(--app-shell-gap)] text-foreground">
			<div className="drag-region absolute left-0 right-0 top-0 z-0 h-10 w-full" />
			<AgentSidebar
				agents={agents.data}
				selectedId={selectedId}
				settingsSelected={selection?.type === "settings"}
				isLoading={agents.isLoading}
				onSelectAgent={(id) => setSelection({ type: "agent", id })}
				onSelectSettings={() => setSelection({ type: "settings" })}
				onCreateAgent={() => {
					setCreating(true);
				}}
			/>
			<AgentDetailPane
				agent={selectedId ? selected.data : undefined}
				showSettings={selection?.type === "settings"}
				onError={handleError}
				onDeleted={() => {
					setSelection(undefined);
					queryClient.removeQueries({ queryKey: ["agent", selectedId] });
				}}
			/>
			<CreateAgentDialog
				open={creating}
				onClose={() => setCreating(false)}
				onError={handleError}
				onCreated={(agent) => setSelection({ type: "agent", id: agent.id })}
			/>
			<Toaster />
		</main>
	);
}
