import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentDetails, AgentDraft, DesktopModelOption, DesktopThinkingLevel } from "../../../shared/types";
import { cn } from "../../lib/utils";
import { AppIcon } from "@/components/shared/app-icon";
import { AgentContentPanels } from "./AgentContentPanels";
import { AgentHeader } from "./AgentHeader";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { emptyUsage, type AgentTab, tabs } from "./agent-display";

export function AgentDetailView({
	agent,
	onError,
	onDeleted,
}: {
	agent: AgentDetails;
	onError: (message: string) => void;
	onDeleted: () => void;
}): JSX.Element {
	const queryClient = useQueryClient();
	const [activeTab, setActiveTab] = useState<AgentTab>("overview");
	const nameInputRef = useRef<HTMLInputElement | null>(null);
	const [isEditingName, setIsEditingName] = useState(false);
	const [draft, setDraft] = useState<AgentDraft>({
		name: agent.name,
		provider: agent.model?.provider ?? "kimi-coding",
		model: agent.model?.model ?? "k2p6",
		thinkingLevel: agent.model?.thinkingLevel as DesktopThinkingLevel ?? "off",
		outputToolCallsToIm: agent.model?.outputToolCallsToIm ?? false,
	});
	const [channelDraft, setChannelDraft] = useState<AgentDraft>({
		appId: agent.appId ?? "",
		appSecret: agent.appSecret ?? "",
		brand: agent.brand ?? "feishu",
	});
	const [channelSaveMessage, setChannelSaveMessage] = useState<string | undefined>();
	const usageQuery = useQuery({
		queryKey: ["agent-usage", agent.id],
		queryFn: () => window.pie.getAgentUsage(agent.id),
		refetchInterval: agent.status === "running" ? 5000 : 15000,
	});
	const resourceQuery = useQuery({
		queryKey: ["agent-resources", agent.id],
		queryFn: () => window.pie.getAgentResources(agent.id),
		refetchInterval: activeTab === "usage" ? 2000 : 10000,
	});
	const modelCatalogQuery = useQuery({
		queryKey: ["agent-model-catalog", agent.id],
		queryFn: () => window.pie.getAgentModelCatalog(agent.id),
	});
	const skillSourcesQuery = useQuery({
		queryKey: ["agent-skill-sources", agent.id],
		queryFn: () => window.pie.getAgentSkillSources(agent.id),
	});
	const usage = usageQuery.data ?? emptyUsage();
	const todayMessages = usage.today.incomingMessages + usage.today.outgoingMessages;
	const totalMessages = usage.total.incomingMessages + usage.total.outgoingMessages;
	const providerOptions = useMemo(() => {
		const values = new Set(modelCatalogQuery.data?.providers ?? []);
		if (draft.provider) {
			values.add(draft.provider);
		}
		return [...values].sort((left, right) => left.localeCompare(right));
	}, [draft.provider, modelCatalogQuery.data?.providers]);
	const allModelOptions = modelCatalogQuery.data?.models ?? [];
	const modelOptions = useMemo<DesktopModelOption[]>(() => {
		const provider = draft.provider ?? "";
		const options = allModelOptions.filter((item) => item.provider === provider);
		if (draft.model && !options.some((item) => item.id === draft.model)) {
			return [{ id: draft.model, provider, name: "Current configuration" }, ...options];
		}
		return options;
	}, [allModelOptions, draft.model, draft.provider]);

	useEffect(() => {
		setDraft({
			name: agent.name,
			provider: agent.model?.provider ?? "kimi-coding",
			model: agent.model?.model ?? "k2p6",
			thinkingLevel: agent.model?.thinkingLevel as DesktopThinkingLevel ?? "off",
			outputToolCallsToIm: agent.model?.outputToolCallsToIm ?? false,
		});
		setChannelDraft({
			appId: agent.appId ?? "",
			appSecret: agent.appSecret ?? "",
			brand: agent.brand ?? "feishu",
		});
		setChannelSaveMessage(undefined);
		setIsEditingName(false);
	}, [agent]);

	useEffect(() => {
		if (isEditingName) {
			nameInputRef.current?.focus();
			nameInputRef.current?.select();
		}
	}, [isEditingName]);

	const update = useMutation({
		mutationFn: (newDraft: AgentDraft) => window.pie.updateAgent(agent.id, newDraft),
		onSuccess: async (updated) => {
			await queryClient.invalidateQueries({ queryKey: ["agents"] });
			queryClient.setQueryData(["agent", agent.id], updated);
		},
		onError: (err: Error) => onError(err.message),
	});
	const saveChannel = useMutation({
		mutationFn: (newDraft: AgentDraft) => window.pie.updateAgent(agent.id, newDraft),
		onSuccess: async (updated) => {
			await queryClient.invalidateQueries({ queryKey: ["agents"] });
			queryClient.setQueryData(["agent", agent.id], updated);
			setChannelSaveMessage("验证通过，渠道配置已保存。");
		},
		onError: (err: Error) => {
			setChannelSaveMessage(undefined);
			onError(err.message);
		},
	});
	const start = useMutation({
		mutationFn: () => window.pie.startAgent(agent.id),
		onSuccess: async (updated) => {
			await queryClient.invalidateQueries({ queryKey: ["agents"] });
			queryClient.setQueryData(["agent", agent.id], updated);
		},
		onError: (err: Error) => onError(err.message),
	});
	const pause = useMutation({
		mutationFn: () => window.pie.pauseAgent(agent.id),
		onSuccess: async (updated) => {
			await queryClient.invalidateQueries({ queryKey: ["agents"] });
			queryClient.setQueryData(["agent", agent.id], updated);
		},
		onError: (err: Error) => onError(err.message),
	});
	const remove = useMutation({
		mutationFn: async () => {
			if (agent.status === "running") {
				await window.pie.pauseAgent(agent.id);
			}
			return window.pie.deleteAgent(agent.id);
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["agents"] });
			onDeleted();
		},
		onError: (err: Error) => onError(err.message),
	});
	const revealFinder = useMutation({
		mutationFn: () => window.pie.revealAgentInFinder(agent.id),
		onError: (err: Error) => onError(err.message),
	});
	const openSkillSource = useMutation({
		mutationFn: (sourceId: string) => window.pie.openAgentSkillSource(agent.id, sourceId),
		onSuccess: (sources) => {
			queryClient.setQueryData(["agent-skill-sources", agent.id], sources);
		},
		onError: (err: Error) => onError(err.message),
	});

	const updateField = (field: keyof AgentDraft, value: AgentDraft[keyof AgentDraft]) => {
		const newDraft = { ...draft, [field]: value };
		setDraft(newDraft);
		update.mutate(newDraft);
	};

	const commitNameEdit = () => {
		const nextName = (draft.name ?? "").trim();
		if (!nextName) {
			setDraft((current) => ({ ...current, name: agent.name }));
			setIsEditingName(false);
			return;
		}
		if (nextName === agent.name) {
			setDraft((current) => ({ ...current, name: nextName }));
			setIsEditingName(false);
			return;
		}
		const newDraft = { ...draft, name: nextName };
		setDraft(newDraft);
		setIsEditingName(false);
		update.mutate(newDraft);
	};

	const updateModelSelection = (nextDraft: AgentDraft) => {
		setDraft(nextDraft);
		update.mutate(nextDraft);
	};

	const updateChannelField = (field: keyof AgentDraft, value: string) => {
		setChannelSaveMessage(undefined);
		setChannelDraft((current) => ({ ...current, [field]: value }));
	};

	return (
			<Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as AgentTab)} className="flex h-full flex-col bg-white">
				<AgentHeader
					agent={agent}
					draftName={draft.name ?? ""}
					isEditingName={isEditingName}
					isSaving={update.isPending}
					nameInputRef={nameInputRef}
					onDraftNameChange={(name) => setDraft((current) => ({ ...current, name }))}
					onCommitName={commitNameEdit}
					onEditName={() => setIsEditingName(true)}
					onCancelNameEdit={() => {
						setDraft((current) => ({ ...current, name: agent.name }));
						setIsEditingName(false);
					}}
					onStart={() => start.mutate()}
					onPause={() => pause.mutate()}
					onReveal={() => revealFinder.mutate()}
					onDelete={() => remove.mutate()}
				/>
				<div className="px-7 bg-white">
					<TabsList variant="line" className="h-10 w-full justify-start gap-4 -ml-2">
						{tabs.map((tab) => (
							<TabsTrigger key={tab.id} value={tab.id} className="gap-1.5 px-2">
								<AppIcon IconComponent={tab.icon} className="size-3.5" />
								{tab.label}
							</TabsTrigger>
						))}
					</TabsList>
				</div>
				<div className={cn(
					"flex-1 bg-white px-7 pb-7 pt-4",
					activeTab === "overview" ? "min-h-0 overflow-hidden" : "overflow-y-auto",
				)}>
					<AgentContentPanels
						activeTab={activeTab}
						agent={agent}
						usage={usage}
						resources={resourceQuery.data}
						todayMessages={todayMessages}
						totalMessages={totalMessages}
						draft={draft}
						channelDraft={channelDraft}
						channelSaveMessage={channelSaveMessage}
						providerOptions={providerOptions}
						modelOptions={modelOptions}
						allModelOptions={allModelOptions}
						isModelCatalogLoading={modelCatalogQuery.isLoading}
						skillSources={skillSourcesQuery.data ?? []}
						isLoadingSkillSources={skillSourcesQuery.isLoading}
						openingSkillSourceId={openSkillSource.isPending ? openSkillSource.variables : undefined}
						isSavingChannel={saveChannel.isPending}
						onUpdateField={updateField}
						onUpdateModelSelection={updateModelSelection}
						onOpenSkillSource={(sourceId) => openSkillSource.mutate(sourceId)}
						onUpdateChannelField={updateChannelField}
						onSaveChannel={() => saveChannel.mutate(channelDraft)}
					/>
				</div>
			</Tabs>
	);
}
