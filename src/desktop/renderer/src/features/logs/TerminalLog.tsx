import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AgentDetails, AgentLogEntry } from "../../../shared/types";
import { cn } from "../../lib/utils";

export function TerminalLog({ agent }: { agent: AgentDetails }): JSX.Element {
	const [logs, setLogs] = useState<AgentLogEntry[]>([]);
	const terminalRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		let cancelled = false;
		window.pie.getAgentLogs(agent.id).then((entries) => {
			if (!cancelled) {
				setLogs(entries);
			}
		}).catch(() => {
			if (!cancelled) {
				setLogs([]);
			}
		});
		const unsubscribe = window.pie.onAgentLog((entry) => {
			if (entry.agentId !== agent.id) {
				return;
			}
			setLogs((current) => {
				const existingIndex = current.findIndex((line) => line.id === entry.id);
				if (existingIndex !== -1) {
					const next = [...current];
					next[existingIndex] = entry;
					return next;
				}
				return [...current.slice(-999), entry];
			});
		});
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, [agent.id]);

	useLayoutEffect(() => {
		if (terminalRef.current) {
			const node = terminalRef.current;
			node.scrollTop = node.scrollHeight;
			const frame = window.requestAnimationFrame(() => {
				node.scrollTop = node.scrollHeight;
			});
			return () => window.cancelAnimationFrame(frame);
		}
	}, [logs]);

	const lines = logs.length
		? logs
		: [{
				id: 0,
				agentId: agent.id,
				stream: "system" as const,
				text: agent.status === "running" ? "waiting for bot output..." : "bot is not running. click start to stream logs here.",
				timestamp: new Date().toISOString(),
			}];

	return (
		<div ref={(node) => { terminalRef.current = node; }} className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-0 font-mono text-xs leading-5 text-[var(--slate-12)] [scrollbar-gutter:stable]">
			{lines.map((line) => (
				<div key={line.id} className="grid grid-cols-[3ch_9ch_minmax(0,1fr)] gap-x-2">
					<span className={cn(
						"text-right font-medium",
						line.stream === "stderr" ? "text-[var(--red-11)]" : line.stream === "system" ? "text-[var(--slate-10)]" : "text-[var(--lime-11)]",
					)}>
						{line.stream === "stderr" ? "err" : line.stream === "system" ? "sys" : "out"}
					</span>
					<span className="font-normal text-[var(--slate-9)] tabular-nums">{new Date(line.timestamp).toLocaleTimeString()}</span>
					<span className={cn(
						"min-w-0 whitespace-pre-wrap break-words text-pretty",
						line.stream === "stderr" ? "text-[var(--red-12)]" : line.stream === "system" ? "text-[var(--slate-11)]" : "text-[var(--slate-12)]",
					)}>
						{line.text}
					</span>
				</div>
			))}
		</div>
	);
}
