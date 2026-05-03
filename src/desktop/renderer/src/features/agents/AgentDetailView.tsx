import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
	AgentDetails,
	AgentDraft,
	AgentStatus,
	AgentSummary,
	DesktopModelOption,
	DesktopThinkingLevel,
	RuntimeEnvironmentLifecycleState,
} from "../../../shared/types";
import { cn } from "../../lib/utils";
import { AppIcon } from "@/components/shared/app-icon";
import { AgentContentPanels, type ResourceChartHistory } from "./AgentContentPanels";
import { AgentHeader } from "./AgentHeader";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { emptyUsage, type AgentTab, tabs } from "./agent-display";

const MAX_RESOURCE_HISTORY_POINTS = 30;
const MIN_PAUSE_LOADING_MS = 500;
const resourceHistoryByAgent = new Map<string, ResourceChartHistory>();

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function withMinimumDuration<T>(operation: () => Promise<T>, minDurationMs: number): Promise<T> {
	const startedAt = Date.now();
	try {
		return await operation();
	} finally {
		const remainingMs = minDurationMs - (Date.now() - startedAt);
		if (remainingMs > 0) {
			await delay(remainingMs);
		}
	}
}

function setAgentStatusInCache(
	queryClient: ReturnType<typeof useQueryClient>,
	agentId: string,
	status: AgentStatus,
	lifecycleState?: RuntimeEnvironmentLifecycleState,
): void {
	const nextLifecycleState = lifecycleState ?? (status === "running" ? "running" : status === "starting" ? "starting" : "stopped");
	const updatedAt = new Date().toISOString();
	queryClient.setQueryData<AgentSummary[]>(["agents"], (current) =>
		current?.map((item) => (item.id === agentId
			? {
					...item,
					status,
					runtimeEnvironment: item.runtimeEnvironment
						? { ...item.runtimeEnvironment, lifecycle: { state: nextLifecycleState, updatedAt } }
						: item.runtimeEnvironment,
				}
			: item)),
	);
	queryClient.setQueryData<AgentDetails>(["agent", agentId], (current) =>
		current
			? {
					...current,
					status,
					runtimeEnvironment: current.runtimeEnvironment
						? { ...current.runtimeEnvironment, lifecycle: { state: nextLifecycleState, updatedAt } }
						: current.runtimeEnvironment,
				}
			: current,
	);
}

function createEmptyResourceHistory(): ResourceChartHistory {
	return { memory: [], cpu: [] };
}

function appendResourcePoint(points: number[], value: number): number[] {
	return [...points, value].slice(-MAX_RESOURCE_HISTORY_POINTS);
}

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
	const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | undefined>();
	const [draft, setDraft] = useState<AgentDraft>({
		name: agent.name,
		provider: agent.model?.provider ?? "kimi-coding",
		model: agent.model?.model ?? "k2p6",
		thinkingLevel: agent.model?.thinkingLevel as DesktopThinkingLevel ?? "off",
		outputToolCallsToIm: agent.model?.outputToolCallsToIm ?? true,
		apiKey: agent.model?.apiKey ?? "",
	});
	const [channelDraft, setChannelDraft] = useState<AgentDraft>({
		appId: agent.appId ?? "",
		appSecret: agent.appSecret ?? "",
		brand: agent.brand ?? "feishu",
		wechatAccountId: agent.wechat?.accountId ?? "",
		wechatBaseUrl: agent.wechat?.baseUrl ?? "https://ilinkai.weixin.qq.com",
		wechatBotToken: agent.wechat?.botToken ?? "",
		slackBotToken: agent.slack?.botToken ?? "",
		slackAppToken: agent.slack?.appToken ?? "",
		slackSigningSecret: agent.slack?.signingSecret ?? "",
		slackTeamId: agent.slack?.teamId ?? "",
		slackAppId: agent.slack?.appId ?? "",
		slackBotUserId: agent.slack?.botUserId ?? "",
		discordBotToken: agent.discord?.botToken ?? "",
		discordApplicationId: agent.discord?.applicationId ?? "",
		discordGuildId: agent.discord?.guildId ?? "",
		telegramBotToken: agent.telegram?.botToken ?? "",
		telegramBotUsername: agent.telegram?.botUsername ?? "",
		outputToolCallsToIm: agent.model?.outputToolCallsToIm ?? true,
	});
	const [modelSaveMessage, setModelSaveMessage] = useState<string | undefined>();
	const [channelSaveMessage, setChannelSaveMessage] = useState<string | undefined>();
	const [resourceHistory, setResourceHistory] = useState<ResourceChartHistory>(() => createEmptyResourceHistory());
	const credentialRequestRef = useRef(0);
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
	const systemPromptQuery = useQuery({
		queryKey: ["agent-system-prompt", agent.id],
		queryFn: () => window.pie.getAgentSystemPrompt(agent.id),
	});
	const usage = usageQuery.data ?? emptyUsage();
	const resources = resourceQuery.data;
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
			outputToolCallsToIm: agent.model?.outputToolCallsToIm ?? true,
			apiKey: agent.model?.apiKey ?? "",
		});
		setChannelDraft({
			appId: agent.appId ?? "",
			appSecret: agent.appSecret ?? "",
			brand: agent.brand ?? "feishu",
			wechatAccountId: agent.wechat?.accountId ?? "",
			wechatBaseUrl: agent.wechat?.baseUrl ?? "https://ilinkai.weixin.qq.com",
			wechatBotToken: agent.wechat?.botToken ?? "",
			slackBotToken: agent.slack?.botToken ?? "",
			slackAppToken: agent.slack?.appToken ?? "",
			slackSigningSecret: agent.slack?.signingSecret ?? "",
			slackTeamId: agent.slack?.teamId ?? "",
			slackAppId: agent.slack?.appId ?? "",
			slackBotUserId: agent.slack?.botUserId ?? "",
			discordBotToken: agent.discord?.botToken ?? "",
			discordApplicationId: agent.discord?.applicationId ?? "",
			discordGuildId: agent.discord?.guildId ?? "",
			telegramBotToken: agent.telegram?.botToken ?? "",
			telegramBotUsername: agent.telegram?.botUsername ?? "",
			outputToolCallsToIm: agent.model?.outputToolCallsToIm ?? true,
		});
		setModelSaveMessage(undefined);
		setChannelSaveMessage(undefined);
	}, [agent]);

	useEffect(() => {
		setAvatarPreviewUrl(undefined);
	}, [agent.id, agent.avatarUrl]);

	useEffect(() => {
		setResourceHistory(resourceHistoryByAgent.get(agent.id) ?? createEmptyResourceHistory());
	}, [agent.id]);

	useEffect(() => {
		if (!resources?.updatedAt) {
			return;
		}
		setResourceHistory((current) => {
			if (current.updatedAt === resources.updatedAt) {
				return current;
			}
			const next = {
				updatedAt: resources.updatedAt,
				memory: appendResourcePoint(current.memory, (resources.memoryBytes ?? 0) / 1024 / 1024),
				cpu: appendResourcePoint(current.cpu, resources.cpuPercent ?? 0),
			};
			resourceHistoryByAgent.set(agent.id, next);
			return next;
		});
	}, [agent.id, resources?.updatedAt, resources?.memoryBytes, resources?.cpuPercent]);

	const update = useMutation({
		mutationFn: (newDraft: AgentDraft) => window.pie.updateAgent(agent.id, newDraft),
		onSuccess: async (updated) => {
			await queryClient.invalidateQueries({ queryKey: ["agents"] });
			queryClient.setQueryData(["agent", agent.id], updated);
		},
		onError: (err: Error) => onError(err.message),
	});
	const uploadAvatar = useMutation({
		mutationFn: (upload: { fileName: string; dataUrl: string }) => window.pie.uploadAgentAvatar(agent.id, upload),
		onMutate: (upload) => {
			setAvatarPreviewUrl(upload.dataUrl);
		},
		onSuccess: async (updated) => {
			queryClient.setQueryData(["agent", agent.id], updated);
			await queryClient.invalidateQueries({ queryKey: ["agents"] });
			await queryClient.invalidateQueries({ queryKey: ["agent", agent.id] });
			setAvatarPreviewUrl(undefined);
		},
		onError: (err: Error) => {
			setAvatarPreviewUrl(undefined);
			onError(err.message);
		},
	});
	const saveAgentDraftAndRestart = async (newDraft: AgentDraft) => {
		let updated = await window.pie.updateAgent(agent.id, newDraft);
		if (agent.status === "running") {
			setAgentStatusInCache(queryClient, agent.id, "starting", "stopping");
			await window.pie.pauseAgent(agent.id);
			setAgentStatusInCache(queryClient, agent.id, "starting", "starting");
			updated = await window.pie.startAgent(agent.id);
		}
		return updated;
	};
	const saveModel = useMutation({
		mutationFn: (newDraft: AgentDraft) => saveAgentDraftAndRestart(newDraft),
		onSuccess: async (updated) => {
			await queryClient.invalidateQueries({ queryKey: ["agents"] });
			queryClient.setQueryData(["agent", agent.id], updated);
			setModelSaveMessage(agent.status === "running" ? "验证通过，模型配置已保存并重启 Bot。" : "验证通过，模型配置已保存。");
		},
		onError: (err: Error) => {
			setModelSaveMessage(undefined);
			void queryClient.invalidateQueries({ queryKey: ["agents"] });
			void queryClient.invalidateQueries({ queryKey: ["agent", agent.id] });
			onError(err.message);
		},
	});
	const saveChannel = useMutation({
		mutationFn: (newDraft: AgentDraft) => saveAgentDraftAndRestart(newDraft),
		onMutate: async (newDraft) => {
			await queryClient.cancelQueries({ queryKey: ["agent", agent.id] });
			const previous = queryClient.getQueryData<AgentDetails>(["agent", agent.id]);
			queryClient.setQueryData<AgentDetails>(["agent", agent.id], (current) =>
				current
					? {
							...current,
							model: {
								...(current.model ?? {}),
								outputToolCallsToIm: newDraft.outputToolCallsToIm ?? current.model?.outputToolCallsToIm ?? true,
							},
						}
					: current,
			);
			return { previous };
		},
		onSuccess: async (updated) => {
			await queryClient.invalidateQueries({ queryKey: ["agents"] });
			queryClient.setQueryData(["agent", agent.id], updated);
			setChannelSaveMessage(agent.status === "running" ? "验证通过，渠道配置已保存并重启 Bot。" : "验证通过，渠道配置已保存。");
		},
		onError: (err: Error, _draft, context) => {
			if (context?.previous) {
				queryClient.setQueryData(["agent", agent.id], context.previous);
			}
			setChannelSaveMessage(undefined);
			void queryClient.invalidateQueries({ queryKey: ["agents"] });
			void queryClient.invalidateQueries({ queryKey: ["agent", agent.id] });
			onError(err.message);
		},
	});
	const start = useMutation({
		mutationFn: () => window.pie.startAgent(agent.id),
		onMutate: () => {
			setAgentStatusInCache(queryClient, agent.id, "starting");
		},
		onSuccess: async (updated) => {
			await queryClient.invalidateQueries({ queryKey: ["agents"] });
			queryClient.setQueryData(["agent", agent.id], updated);
		},
		onError: (err: Error) => {
			void queryClient.invalidateQueries({ queryKey: ["agents"] });
			void queryClient.invalidateQueries({ queryKey: ["agent", agent.id] });
			onError(err.message);
		},
	});
	const pause = useMutation({
		mutationFn: () => withMinimumDuration(() => window.pie.pauseAgent(agent.id), MIN_PAUSE_LOADING_MS),
		onMutate: () => {
			setAgentStatusInCache(queryClient, agent.id, "starting", "stopping");
		},
		onSuccess: async (updated) => {
			await queryClient.invalidateQueries({ queryKey: ["agents"] });
			queryClient.setQueryData(["agent", agent.id], updated);
		},
		onError: (err: Error) => {
			void queryClient.invalidateQueries({ queryKey: ["agents"] });
			void queryClient.invalidateQueries({ queryKey: ["agent", agent.id] });
			onError(err.message);
		},
	});
	const remove = useMutation({
		mutationFn: async () => {
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
	const openSystemPrompt = useMutation({
		mutationFn: () => window.pie.openAgentSystemPrompt(agent.id),
		onSuccess: (source) => {
			queryClient.setQueryData(["agent-system-prompt", agent.id], source);
		},
		onError: (err: Error) => onError(err.message),
	});

	const updateField = (field: keyof AgentDraft, value: AgentDraft[keyof AgentDraft]) => {
		const newDraft = { ...draft, [field]: value };
		setDraft(newDraft);
		setModelSaveMessage(undefined);
	};

	const saveName = (name: string) => {
		const nextName = name.trim();
		if (!nextName) {
			setDraft((current) => ({ ...current, name: agent.name }));
			return;
		}
		if (nextName === agent.name) {
			setDraft((current) => ({ ...current, name: nextName }));
			return;
		}
		setDraft((current) => ({ ...current, name: nextName }));
		update.mutate({ name: nextName });
	};

	const updateModelSelection = (nextDraft: AgentDraft) => {
		setDraft(nextDraft);
		setModelSaveMessage(undefined);
	};

	const prefillProviderApiKey = async (nextProvider: string) => {
		const requestId = ++credentialRequestRef.current;
		const reusable = await window.pie.findReusableProviderCredential(nextProvider, agent.id);
		if (requestId !== credentialRequestRef.current) {
			return;
		}
		setDraft((current) => {
			if (current.provider !== nextProvider) {
				return current;
			}
			return { ...current, apiKey: reusable?.value ?? "" };
		});
	};

	const updateProviderSelection = (nextProvider: string) => {
		const nextModel = allModelOptions.find((item) => item.provider === nextProvider)?.id ?? draft.model ?? "";
		const nextApiKey = nextProvider === agent.model?.provider ? agent.model?.apiKey ?? "" : "";
		updateModelSelection({ ...draft, provider: nextProvider, model: nextModel, apiKey: nextApiKey });
		if (nextProvider !== agent.model?.provider) {
			void prefillProviderApiKey(nextProvider);
		}
	};

	const updateChannelField = (field: keyof AgentDraft, value: string | boolean) => {
		setChannelSaveMessage(undefined);
		setChannelDraft((current) => ({ ...current, [field]: value }));
	};

	return (
			<Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as AgentTab)} className="flex h-full flex-col bg-white">
				<AgentHeader
					agent={avatarPreviewUrl ? { ...agent, avatarUrl: avatarPreviewUrl } : agent}
					isSaving={update.isPending}
					onSaveName={saveName}
					isUploadingAvatar={uploadAvatar.isPending}
					onUploadAvatar={(upload) => uploadAvatar.mutate(upload)}
					isStarting={start.isPending}
					isPausing={pause.isPending}
					onStart={() => start.mutate()}
					onPause={() => pause.mutate()}
					onReveal={() => revealFinder.mutate()}
					onDelete={() => remove.mutate()}
					deleteError={remove.error instanceof Error ? remove.error.message : undefined}
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
					"flex-1 bg-white px-7 pt-4",
					activeTab === "overview" ? "min-h-0 overflow-hidden" : "overflow-y-auto",
					activeTab === "overview" ? "pb-7" : "pb-12",
				)}>
					<AgentContentPanels
						activeTab={activeTab}
						agent={agent}
						usage={usage}
						resources={resources}
						resourceHistory={resourceHistory}
						draft={draft}
						channelDraft={channelDraft}
						modelSaveMessage={modelSaveMessage}
						channelSaveMessage={channelSaveMessage}
						providerOptions={providerOptions}
						modelOptions={modelOptions}
						allModelOptions={allModelOptions}
						isModelCatalogLoading={modelCatalogQuery.isLoading}
						systemPrompt={systemPromptQuery.data}
						isLoadingSystemPrompt={systemPromptQuery.isLoading}
						isOpeningSystemPrompt={openSystemPrompt.isPending}
						skillSources={skillSourcesQuery.data ?? []}
						isLoadingSkillSources={skillSourcesQuery.isLoading}
						openingSkillSourceId={openSkillSource.isPending ? openSkillSource.variables : undefined}
						isSavingModel={saveModel.isPending}
						isSavingChannel={saveChannel.isPending}
						onUpdateField={updateField}
						onUpdateProviderSelection={updateProviderSelection}
						onSaveModel={() => saveModel.mutate({
							provider: draft.provider,
							model: draft.model,
							thinkingLevel: draft.thinkingLevel,
							apiKey: draft.apiKey,
						})}
						onOpenSystemPrompt={() => openSystemPrompt.mutate()}
						onOpenSkillSource={(sourceId) => openSkillSource.mutate(sourceId)}
						onUpdateChannelField={updateChannelField}
						onSaveChannel={() => saveChannel.mutate(channelDraft)}
					/>
				</div>
			</Tabs>
	);
}
