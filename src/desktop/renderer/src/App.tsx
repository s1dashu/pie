import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Toaster, toast } from "./components/ui/sonner";
import { CreateAgentDialog } from "./features/agents/CreateAgentDialog";
import { AgentDetailPane } from "./layout/AgentDetailPane";
import { AgentSidebar } from "./layout/AgentSidebar";

export function App(): JSX.Element {
	const [selectedId, setSelectedId] = useState<string | undefined>();
	const [creating, setCreating] = useState(false);
	const queryClient = useQueryClient();

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
				isLoading={agents.isLoading}
				onSelectAgent={setSelectedId}
				onCreateAgent={() => {
					setCreating(true);
				}}
			/>
			<AgentDetailPane
				agent={selectedId ? selected.data : undefined}
				onError={handleError}
				onDeleted={() => {
					setSelectedId(undefined);
					queryClient.removeQueries({ queryKey: ["agent", selectedId] });
				}}
			/>
			<CreateAgentDialog
				open={creating}
				onClose={() => setCreating(false)}
				onError={handleError}
				onCreated={(agent) => setSelectedId(agent.id)}
			/>
			{/* <Toaster /> */}
		</main>
	);
}
