import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircleBoldDuotone } from "solar-icon-set";
import type {
	AgentDetails,
	AgentDraft,
	AgentOnboardEvent,
	AgentStatus,
	AgentSummary,
	DesktopModelOption,
	DesktopThinkingLevel,
	RuntimeEnvironmentLifecycleState,
} from "../../../shared/types";
import { defaultModelForProvider, providersFromModels } from "../../../../shared/model-catalog";
import { cn } from "../../lib/utils";
import { AppIcon } from "@/components/shared/app-icon";
import { AgentContentPanels, type ResourceChartHistory } from "./AgentContentPanels";
import { AgentHeader } from "./AgentHeader";
import { Button } from "../../components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { emptyUsage, type AgentTab, tabs } from "./agent-display";
import { useI18n } from "../../lib/i18n";

const MAX_RESOURCE_HISTORY_POINTS = 30;
const MIN_PAUSE_LOADING_MS = 500;
const resourceHistoryByAgent = new Map<string, ResourceChartHistory>();
type ChannelAuthKind = "feishu" | "wechat";
type ChannelAuthPhase = "preparing" | "qr" | "done";

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

function isRuntimeUnavailableStartError(message: string): boolean {
	return message.includes("未检测到 Hermes 运行时") ||
		message.includes("Hermes 运行时不可用") ||
		message.includes("未检测到 OpenClaw 运行时") ||
		message.includes("OpenClaw 运行时不可用");
}

function getFriendlyStartError(message: string, t: ReturnType<typeof useI18n>["t"]): string {
	if (message.includes("Bot did not become ready within 30s")) {
		return t("startTimeout");
	}
	if (message.includes("Bot process exited before it was ready")) {
		return t("startExitedBeforeReady");
	}
	if (isRuntimeUnavailableStartError(message)) {
		return t("startRuntimeUnavailable");
	}
	return message;
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

function normalizeDraftPart(part: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(part).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value]));
}

function sameDraftPart(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
	return JSON.stringify(normalizeDraftPart(left)) === JSON.stringify(normalizeDraftPart(right));
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
	const { t } = useI18n();
	const queryClient = useQueryClient();
	const [activeTab, setActiveTab] = useState<AgentTab>("chat");
	const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | undefined>();
	const [draft, setDraft] = useState<AgentDraft>({
		name: agent.name,
		provider: agent.model?.provider ?? "kimi-coding",
		model: agent.model?.model ?? "k2p6",
		thinkingLevel: agent.model?.thinkingLevel as DesktopThinkingLevel ?? "off",
		resumeSessions: agent.model?.resumeSessions ?? false,
		outputToolCallsToIm: agent.model?.outputToolCallsToIm ?? true,
		outputToolCallImMaxLength: agent.model?.outputToolCallImMaxLength ?? 60,
		outputThinkingToIm: agent.model?.outputThinkingToIm ?? false,
		apiKey: agent.model?.apiKey ?? "",
	});
	const [channelDraft, setChannelDraft] = useState<AgentDraft>({
		appId: agent.appId ?? "",
		appSecret: agent.appSecret ?? "",
		brand: agent.brand ?? "feishu",
		feishuMessageOutputMode: agent.feishuMessageOutputMode ?? "bubble",
		imGroupResponseMode: agent.imGroupResponseMode ?? "owner_mention",
		wechatAccountId: agent.wechat?.accountId ?? "",
		wechatBaseUrl: agent.wechat?.baseUrl ?? "https://ilinkai.weixin.qq.com",
		wechatBotToken: agent.wechat?.botToken ?? "",
		slackBotToken: agent.slack?.botToken ?? "",
		slackAppToken: agent.slack?.appToken ?? "",
		discordBotToken: agent.discord?.botToken ?? "",
		discordApplicationId: agent.discord?.applicationId ?? "",
		discordGuildId: agent.discord?.guildId ?? "",
		telegramBotToken: agent.telegram?.botToken ?? "",
		telegramBotUsername: agent.telegram?.botUsername ?? "",
		outputToolCallsToIm: agent.model?.outputToolCallsToIm ?? true,
		outputToolCallImMaxLength: agent.model?.outputToolCallImMaxLength ?? 60,
		outputThinkingToIm: agent.model?.outputThinkingToIm ?? false,
		resumeSessions: agent.model?.resumeSessions ?? false,
	});
	const [hasPendingRestartConfig, setHasPendingRestartConfig] = useState(false);
	const [feishuAuthStatus, setFeishuAuthStatus] = useState<string | undefined>();
	const [feishuQrEvent, setFeishuQrEvent] = useState<AgentOnboardEvent | undefined>();
	const [feishuQrExpiresAt, setFeishuQrExpiresAt] = useState<number | undefined>();
	const [feishuQrExpired, setFeishuQrExpired] = useState(false);
	const [feishuAuthPhase, setFeishuAuthPhase] = useState<ChannelAuthPhase>("preparing");
	const [wechatAuthStatus, setWechatAuthStatus] = useState<string | undefined>();
	const [wechatQrEvent, setWechatQrEvent] = useState<AgentOnboardEvent | undefined>();
	const [wechatQrExpiresAt, setWechatQrExpiresAt] = useState<number | undefined>();
	const [wechatQrExpired, setWechatQrExpired] = useState(false);
	const [wechatAuthPhase, setWechatAuthPhase] = useState<ChannelAuthPhase>("preparing");
	const [authDialogKind, setAuthDialogKind] = useState<ChannelAuthKind | undefined>();
	const [resourceHistory, setResourceHistory] = useState<ResourceChartHistory>(() => createEmptyResourceHistory());
	const [enableOverviewMetrics, setEnableOverviewMetrics] = useState(false);
	const credentialRequestRef = useRef(0);
	const modelAutosaveReadyRef = useRef(false);
	const channelAutosaveReadyRef = useRef(false);
	const supportsSystemPrompt = agent.harnessKind === "ousia";
	const isOverviewTab = activeTab === "overview";
	const canLoadOverviewMetrics = isOverviewTab && enableOverviewMetrics;
	const isModelTab = activeTab === "model";
	const usageQuery = useQuery({
		queryKey: ["agent-usage", agent.id],
		queryFn: () => window.pie.getAgentUsage(agent.id),
		enabled: canLoadOverviewMetrics,
		refetchInterval: canLoadOverviewMetrics ? agent.status === "running" ? 5000 : 15000 : false,
		staleTime: 2000,
	});
	const resourceQuery = useQuery({
		queryKey: ["agent-resources", agent.id],
		queryFn: () => window.pie.getAgentResources(agent.id),
		enabled: canLoadOverviewMetrics,
		refetchInterval: canLoadOverviewMetrics ? 2000 : false,
		staleTime: 1500,
	});
	const modelCatalogQuery = useQuery({
		queryKey: ["agent-model-catalog", agent.id],
		queryFn: () => window.pie.getAgentModelCatalog(agent.id),
		enabled: isModelTab,
		staleTime: 60_000,
	});
	const skillSourcesQuery = useQuery({
		queryKey: ["agent-skill-sources", agent.id],
		queryFn: () => window.pie.getAgentSkillSources(agent.id),
		enabled: isModelTab,
		staleTime: 10_000,
	});
	const systemPromptQuery = useQuery({
		queryKey: ["agent-system-prompt", agent.id],
		queryFn: () => window.pie.getAgentSystemPrompt(agent.id),
		enabled: supportsSystemPrompt && isModelTab,
		staleTime: 10_000,
	});
	const usage = usageQuery.data ?? emptyUsage();
	const resources = resourceQuery.data;
	const detailContentPadding = "px-3 pb-4";
	const providerOptions = useMemo(() => {
		const models = modelCatalogQuery.data?.models ?? [];
		const values = new Set(providersFromModels(models));
		if (draft.provider) {
			values.add(draft.provider);
		}
		return providersFromModels([...models, ...[...values].map((provider) => ({ provider, id: "", name: provider }))]);
	}, [draft.provider, modelCatalogQuery.data?.models]);
	const allModelOptions = modelCatalogQuery.data?.models ?? [];
	const modelOptions = useMemo<DesktopModelOption[]>(() => {
		const provider = draft.provider ?? "";
		const options = allModelOptions.filter((item) => item.provider === provider);
		if (draft.model && !options.some((item) => item.id === draft.model)) {
			return [{ id: draft.model, provider, name: t("currentConfiguration") }, ...options];
		}
		return options;
	}, [allModelOptions, draft.model, draft.provider, t]);
	const savedModelDraft = useMemo(() => ({
		provider: agent.model?.provider ?? "kimi-coding",
		model: agent.model?.model ?? "k2p6",
		thinkingLevel: agent.model?.thinkingLevel as DesktopThinkingLevel ?? "off",
		resumeSessions: agent.model?.resumeSessions ?? false,
		apiKey: agent.model?.apiKey ?? "",
	}), [agent.model?.apiKey, agent.model?.model, agent.model?.provider, agent.model?.resumeSessions, agent.model?.thinkingLevel]);
	const nextModelDraft = useMemo(() => ({
		provider: draft.provider,
		model: draft.model,
		thinkingLevel: draft.thinkingLevel,
		resumeSessions: draft.resumeSessions,
		apiKey: draft.apiKey,
	}), [draft.apiKey, draft.model, draft.provider, draft.resumeSessions, draft.thinkingLevel]);
	const savedChannelDraft = useMemo(() => ({
		appId: agent.appId ?? "",
		appSecret: agent.appSecret ?? "",
		brand: agent.brand ?? "feishu",
		feishuMessageOutputMode: agent.feishuMessageOutputMode ?? "bubble",
		imGroupResponseMode: agent.imGroupResponseMode ?? "owner_mention",
		wechatAccountId: agent.wechat?.accountId ?? "",
		wechatBaseUrl: agent.wechat?.baseUrl ?? "https://ilinkai.weixin.qq.com",
		wechatBotToken: agent.wechat?.botToken ?? "",
		slackBotToken: agent.slack?.botToken ?? "",
		slackAppToken: agent.slack?.appToken ?? "",
		discordBotToken: agent.discord?.botToken ?? "",
		discordApplicationId: agent.discord?.applicationId ?? "",
		discordGuildId: agent.discord?.guildId ?? "",
		telegramBotToken: agent.telegram?.botToken ?? "",
		telegramBotUsername: agent.telegram?.botUsername ?? "",
		outputToolCallsToIm: agent.model?.outputToolCallsToIm ?? true,
		outputToolCallImMaxLength: agent.model?.outputToolCallImMaxLength ?? 60,
		outputThinkingToIm: agent.model?.outputThinkingToIm ?? false,
		resumeSessions: agent.model?.resumeSessions ?? false,
	}), [
		agent.appId,
		agent.appSecret,
		agent.brand,
		agent.discord?.applicationId,
		agent.discord?.botToken,
		agent.discord?.guildId,
		agent.feishuMessageOutputMode,
		agent.imGroupResponseMode,
		agent.model?.outputThinkingToIm,
		agent.model?.resumeSessions,
		agent.model?.outputToolCallImMaxLength,
		agent.model?.outputToolCallsToIm,
		agent.slack?.appToken,
		agent.slack?.botToken,
		agent.telegram?.botToken,
		agent.telegram?.botUsername,
		agent.wechat?.accountId,
		agent.wechat?.baseUrl,
		agent.wechat?.botToken,
	]);
	const nextChannelDraft = useMemo(() => ({
		appId: channelDraft.appId,
		appSecret: channelDraft.appSecret,
		brand: channelDraft.brand,
		feishuMessageOutputMode: channelDraft.feishuMessageOutputMode,
		imGroupResponseMode: channelDraft.imGroupResponseMode,
		wechatAccountId: channelDraft.wechatAccountId,
		wechatBaseUrl: channelDraft.wechatBaseUrl,
		wechatBotToken: channelDraft.wechatBotToken,
		slackBotToken: channelDraft.slackBotToken,
		slackAppToken: channelDraft.slackAppToken,
		discordBotToken: channelDraft.discordBotToken,
		discordApplicationId: channelDraft.discordApplicationId,
		discordGuildId: channelDraft.discordGuildId,
		telegramBotToken: channelDraft.telegramBotToken,
		telegramBotUsername: channelDraft.telegramBotUsername,
		outputToolCallsToIm: channelDraft.outputToolCallsToIm,
		outputToolCallImMaxLength: channelDraft.outputToolCallImMaxLength,
		outputThinkingToIm: channelDraft.outputThinkingToIm,
		resumeSessions: channelDraft.resumeSessions,
	}), [channelDraft]);
	const hasUnsavedModelConfig = !sameDraftPart(nextModelDraft, savedModelDraft);
	const hasUnsavedChannelConfig = !sameDraftPart(nextChannelDraft, savedChannelDraft);

	useEffect(() => {
		setDraft({
			name: agent.name,
			provider: agent.model?.provider ?? "kimi-coding",
			model: agent.model?.model ?? "k2p6",
			thinkingLevel: agent.model?.thinkingLevel as DesktopThinkingLevel ?? "off",
			resumeSessions: agent.model?.resumeSessions ?? false,
			outputToolCallsToIm: agent.model?.outputToolCallsToIm ?? true,
			outputToolCallImMaxLength: agent.model?.outputToolCallImMaxLength ?? 60,
			outputThinkingToIm: agent.model?.outputThinkingToIm ?? false,
			apiKey: agent.model?.apiKey ?? "",
		});
		setChannelDraft({
			appId: agent.appId ?? "",
			appSecret: agent.appSecret ?? "",
			brand: agent.brand ?? "feishu",
			feishuMessageOutputMode: agent.feishuMessageOutputMode ?? "bubble",
			imGroupResponseMode: agent.imGroupResponseMode ?? "owner_mention",
			wechatAccountId: agent.wechat?.accountId ?? "",
			wechatBaseUrl: agent.wechat?.baseUrl ?? "https://ilinkai.weixin.qq.com",
			wechatBotToken: agent.wechat?.botToken ?? "",
			slackBotToken: agent.slack?.botToken ?? "",
			slackAppToken: agent.slack?.appToken ?? "",
			discordBotToken: agent.discord?.botToken ?? "",
			discordApplicationId: agent.discord?.applicationId ?? "",
			discordGuildId: agent.discord?.guildId ?? "",
			telegramBotToken: agent.telegram?.botToken ?? "",
			telegramBotUsername: agent.telegram?.botUsername ?? "",
			outputToolCallsToIm: agent.model?.outputToolCallsToIm ?? true,
			outputToolCallImMaxLength: agent.model?.outputToolCallImMaxLength ?? 60,
			outputThinkingToIm: agent.model?.outputThinkingToIm ?? false,
			resumeSessions: agent.model?.resumeSessions ?? false,
		});
	}, [agent]);

	useEffect(() => {
		setHasPendingRestartConfig(false);
		modelAutosaveReadyRef.current = false;
		channelAutosaveReadyRef.current = false;
	}, [agent.id]);

	useEffect(() => {
		setEnableOverviewMetrics(false);
		const timer = window.setTimeout(() => {
			setEnableOverviewMetrics(true);
		}, 900);
		return () => window.clearTimeout(timer);
	}, [agent.id]);

	useEffect(() => {
		setFeishuAuthStatus(undefined);
		setFeishuQrEvent(undefined);
		setFeishuQrExpiresAt(undefined);
		setFeishuQrExpired(false);
		setFeishuAuthPhase("preparing");
		setWechatAuthStatus(undefined);
		setWechatQrEvent(undefined);
		setWechatQrExpiresAt(undefined);
		setWechatQrExpired(false);
		setWechatAuthPhase("preparing");
		setAuthDialogKind(undefined);
	}, [agent.id]);

	useEffect(() => {
		return window.pie.onAgentOnboardEvent((event) => {
			if (event.sessionId !== agent.id) {
				return;
			}
			const isFeishuOnboardEvent = event.source === "feishu" || (!event.source && (event.type === "qr" || Boolean(event.feishu)));
			if (isFeishuOnboardEvent) {
				if (event.type === "qr") {
					setFeishuQrEvent(event);
					setFeishuQrExpiresAt(event.expiresIn ? Date.now() + event.expiresIn * 1000 : undefined);
					setFeishuQrExpired(false);
					setFeishuAuthPhase("qr");
				}
				if (event.message) {
					setFeishuAuthStatus(event.message);
				}
				if (event.type === "done") {
					setFeishuQrEvent(undefined);
					setFeishuQrExpiresAt(undefined);
					setFeishuQrExpired(false);
					setFeishuAuthPhase("done");
				}
				if (event.type === "done" || event.type === "error") {
					void queryClient.invalidateQueries({ queryKey: ["agents"] });
					void queryClient.invalidateQueries({ queryKey: ["agent", agent.id] });
				}
				return;
			}
			if (event.source !== "wechat") {
				return;
			}
			if (event.type === "qr") {
				setWechatQrEvent(event);
				setWechatQrExpiresAt(event.expiresIn ? Date.now() + event.expiresIn * 1000 : undefined);
				setWechatQrExpired(false);
				setWechatAuthPhase("qr");
			}
			if (event.message) {
				setWechatAuthStatus(event.message);
			}
			if (event.type === "done") {
				setWechatQrEvent(undefined);
				setWechatQrExpiresAt(undefined);
				setWechatQrExpired(false);
				setWechatAuthPhase("done");
			}
			if (event.type === "done" || event.type === "error") {
				void queryClient.invalidateQueries({ queryKey: ["agents"] });
				void queryClient.invalidateQueries({ queryKey: ["agent", agent.id] });
			}
		});
	}, [agent.id, queryClient]);

	useEffect(() => {
		if (!feishuQrExpiresAt) {
			setFeishuQrExpired(false);
			return;
		}
		const updateExpired = () => setFeishuQrExpired(Date.now() >= feishuQrExpiresAt);
		updateExpired();
		const timer = window.setInterval(updateExpired, 1000);
		return () => window.clearInterval(timer);
	}, [feishuQrExpiresAt]);

	useEffect(() => {
		if (!wechatQrExpiresAt) {
			setWechatQrExpired(false);
			return;
		}
		const updateExpired = () => setWechatQrExpired(Date.now() >= wechatQrExpiresAt);
		updateExpired();
		const timer = window.setInterval(updateExpired, 1000);
		return () => window.clearInterval(timer);
	}, [wechatQrExpiresAt]);

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
	const saveModel = useMutation({
		mutationFn: (newDraft: AgentDraft) => window.pie.updateAgent(agent.id, newDraft),
		onSuccess: async (updated) => {
			await queryClient.invalidateQueries({ queryKey: ["agents"] });
			queryClient.setQueryData(["agent", agent.id], updated);
			if (agent.status === "running" || agent.status === "starting") {
				setHasPendingRestartConfig(true);
			}
		},
		onError: (err: Error) => {
			void queryClient.invalidateQueries({ queryKey: ["agents"] });
			void queryClient.invalidateQueries({ queryKey: ["agent", agent.id] });
			onError(err.message);
		},
	});
	const saveChannel = useMutation({
		mutationFn: (newDraft: AgentDraft) => window.pie.updateAgent(agent.id, newDraft),
		onSuccess: async (updated) => {
			await queryClient.invalidateQueries({ queryKey: ["agents"] });
			queryClient.setQueryData(["agent", agent.id], updated);
			if (agent.status === "running" || agent.status === "starting") {
				setHasPendingRestartConfig(true);
			}
		},
		onError: (err: Error) => {
			void queryClient.invalidateQueries({ queryKey: ["agents"] });
			void queryClient.invalidateQueries({ queryKey: ["agent", agent.id] });
			onError(getFriendlyStartError(err.message, t));
		},
	});
	const reauthorizeWechat = useMutation({
		mutationFn: () => window.pie.reauthorizeWechat(agent.id),
		onMutate: () => {
			setAuthDialogKind("wechat");
			setWechatAuthStatus(t("preparingQr"));
			setWechatQrEvent(undefined);
			setWechatQrExpiresAt(undefined);
			setWechatQrExpired(false);
			setWechatAuthPhase("preparing");
		},
		onSuccess: async (updated) => {
			await queryClient.invalidateQueries({ queryKey: ["agents"] });
			queryClient.setQueryData(["agent", agent.id], updated);
			setChannelDraft((current) => ({
				...current,
				wechatAccountId: updated.wechat?.accountId ?? current.wechatAccountId,
				wechatBaseUrl: updated.wechat?.baseUrl ?? current.wechatBaseUrl,
				wechatBotToken: updated.wechat?.botToken ?? current.wechatBotToken,
			}));
			setWechatQrEvent(undefined);
			setWechatQrExpiresAt(undefined);
			setWechatQrExpired(false);
			setWechatAuthPhase("done");
			setHasPendingRestartConfig(false);
		},
		onError: (err: Error) => {
			if (err.message.includes("二维码已失效") || err.message.includes("expired")) {
				setWechatQrExpired(true);
				setWechatAuthStatus(t("qrExpiredRefresh"));
				setWechatAuthPhase(wechatQrEvent?.url ? "qr" : "preparing");
				return;
			}
			setWechatAuthStatus(undefined);
			setWechatAuthPhase("preparing");
			onError(err.message);
		},
	});
	const reauthorizeFeishu = useMutation({
		mutationFn: () => window.pie.reauthorizeFeishu(agent.id),
		onMutate: () => {
			setAuthDialogKind("feishu");
			setFeishuAuthStatus(t("preparingQr"));
			setFeishuQrEvent(undefined);
			setFeishuQrExpiresAt(undefined);
			setFeishuQrExpired(false);
			setFeishuAuthPhase("preparing");
		},
		onSuccess: async (updated) => {
			await queryClient.invalidateQueries({ queryKey: ["agents"] });
			queryClient.setQueryData(["agent", agent.id], updated);
			setChannelDraft((current) => ({
				...current,
				appId: updated.appId ?? current.appId,
				appSecret: updated.appSecret ?? current.appSecret,
				brand: updated.brand ?? current.brand,
			}));
			setDraft((current) => ({ ...current, name: updated.name }));
			setFeishuQrEvent(undefined);
			setFeishuQrExpiresAt(undefined);
			setFeishuQrExpired(false);
			setFeishuAuthPhase("done");
			setHasPendingRestartConfig(false);
		},
		onError: (err: Error) => {
			if (err.message.includes("二维码已失效") || err.message.includes("expired")) {
				setFeishuQrExpired(true);
				setFeishuAuthStatus(t("qrExpiredRefresh"));
				setFeishuAuthPhase(feishuQrEvent?.url ? "qr" : "preparing");
				return;
			}
			setFeishuAuthStatus(undefined);
			setFeishuAuthPhase("preparing");
			onError(err.message);
		},
	});
	const syncFeishuAppProfile = useMutation({
		mutationFn: () => window.pie.syncFeishuAppProfile(agent.id),
		onSuccess: async (updated) => {
			await queryClient.invalidateQueries({ queryKey: ["agents"] });
			queryClient.setQueryData(["agent", agent.id], updated);
			setDraft((current) => ({ ...current, name: updated.name }));
			if (agent.status === "running" || agent.status === "starting") {
				setHasPendingRestartConfig(true);
			}
		},
		onError: (err: Error) => {
			onError(err.message);
		},
	});
	const syncDiscordBotProfile = useMutation({
		mutationFn: () => window.pie.syncDiscordBotProfile(agent.id, channelDraft.discordBotToken),
		onSuccess: async (updated) => {
			await queryClient.invalidateQueries({ queryKey: ["agents"] });
			queryClient.setQueryData(["agent", agent.id], updated);
			setDraft((current) => ({ ...current, name: updated.name }));
			setChannelDraft((current) => ({
				...current,
				discordBotToken: updated.discord?.botToken ?? current.discordBotToken,
				discordApplicationId: updated.discord?.applicationId ?? current.discordApplicationId,
				discordGuildId: updated.discord?.guildId ?? current.discordGuildId,
			}));
			if (agent.status === "running" || agent.status === "starting") {
				setHasPendingRestartConfig(true);
			}
		},
		onError: (err: Error) => {
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
			setHasPendingRestartConfig(false);
		},
		onError: (err: Error) => {
			void queryClient.invalidateQueries({ queryKey: ["agents"] });
			void queryClient.invalidateQueries({ queryKey: ["agent", agent.id] });
			onError(getFriendlyStartError(err.message, t));
		},
	});
	const restart = useMutation({
		mutationFn: () => withMinimumDuration(() => window.pie.restartAgent(agent.id), MIN_PAUSE_LOADING_MS),
		onMutate: () => {
			setAgentStatusInCache(queryClient, agent.id, "starting", "stopping");
		},
		onSuccess: async (updated) => {
			await queryClient.invalidateQueries({ queryKey: ["agents"] });
			queryClient.setQueryData(["agent", agent.id], updated);
			setHasPendingRestartConfig(false);
		},
		onError: (err: Error) => {
			void queryClient.invalidateQueries({ queryKey: ["agents"] });
			void queryClient.invalidateQueries({ queryKey: ["agent", agent.id] });
			onError(getFriendlyStartError(err.message, t));
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
	const openSkillFolder = useMutation({
		mutationFn: async ({ sourceId, skillName }: { sourceId: string; skillName: string }) => {
			if (typeof window.pie.openAgentSkillFolder !== "function") {
				console.error("[desktop] openAgentSkillFolder is unavailable. Restart the Electron desktop process to load the updated preload API.");
				return undefined;
			}
			await window.pie.openAgentSkillFolder(agent.id, sourceId, skillName);
			return window.pie.getAgentSkillSources(agent.id);
		},
		onSuccess: (sources) => {
			if (!sources) {
				return;
			}
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
		const nextModel = defaultModelForProvider(allModelOptions, nextProvider) || draft.model || "";
		const nextApiKey = nextProvider === agent.model?.provider ? agent.model?.apiKey ?? "" : "";
		updateModelSelection({ ...draft, provider: nextProvider, model: nextModel, apiKey: nextApiKey });
		if (nextProvider !== agent.model?.provider) {
			void prefillProviderApiKey(nextProvider);
		}
	};

	const updateChannelField = (field: keyof AgentDraft, value: AgentDraft[keyof AgentDraft]) => {
		setChannelDraft((current) => ({ ...current, [field]: value }));
	};
	const hasWechatChannel = Boolean(agent.channelKinds?.includes("wechat") || agent.wechat);
	const isWechatDegraded = hasWechatChannel && agent.runtimeEnvironment?.lifecycle.state === "degraded";
	const isFeishuCredentialInvalidated = agent.feishuCredentialState === "invalidated";
	const isPreparingFeishuQr = reauthorizeFeishu.isPending && !feishuQrEvent?.url;
	const isPreparingWechatQr = reauthorizeWechat.isPending && !wechatQrEvent?.url;
	const openFeishuReauthorizeDialog = () => {
		setAuthDialogKind("feishu");
		if (!reauthorizeFeishu.isPending && !feishuQrEvent?.url) {
			reauthorizeFeishu.mutate();
		}
	};
	const openWechatReauthorizeDialog = () => {
		setAuthDialogKind("wechat");
		if (!reauthorizeWechat.isPending && !wechatQrEvent?.url) {
			reauthorizeWechat.mutate();
		}
	};
	const refreshFeishuQr = () => {
		setFeishuQrEvent(undefined);
		setFeishuQrExpiresAt(undefined);
		setFeishuQrExpired(false);
		setFeishuAuthStatus(t("preparingQr"));
		setFeishuAuthPhase("preparing");
		reauthorizeFeishu.mutate();
	};
	const refreshWechatQr = () => {
		setWechatQrEvent(undefined);
		setWechatQrExpiresAt(undefined);
		setWechatQrExpired(false);
		setWechatAuthStatus(t("preparingQr"));
		setWechatAuthPhase("preparing");
		reauthorizeWechat.mutate();
	};

	useEffect(() => {
		if (agent.status !== "running" && agent.status !== "starting") {
			setHasPendingRestartConfig(false);
		}
	}, [agent.status]);

	useEffect(() => {
		if (!hasUnsavedModelConfig) {
			modelAutosaveReadyRef.current = true;
			return;
		}
		if (!modelAutosaveReadyRef.current) {
			modelAutosaveReadyRef.current = true;
			return;
		}
		const timer = window.setTimeout(() => {
			saveModel.mutate(nextModelDraft);
		}, 600);
		return () => window.clearTimeout(timer);
	}, [hasUnsavedModelConfig, nextModelDraft, saveModel.mutate]);

	useEffect(() => {
		if (!hasUnsavedChannelConfig) {
			channelAutosaveReadyRef.current = true;
			return;
		}
		if (!channelAutosaveReadyRef.current) {
			channelAutosaveReadyRef.current = true;
			return;
		}
		const timer = window.setTimeout(() => {
			saveChannel.mutate(nextChannelDraft);
		}, 600);
		return () => window.clearTimeout(timer);
	}, [hasUnsavedChannelConfig, nextChannelDraft, saveChannel.mutate]);

	const isFeishuAuthDialog = authDialogKind === "feishu";
	const authQrEvent = isFeishuAuthDialog ? feishuQrEvent : wechatQrEvent;
	const authQrExpired = isFeishuAuthDialog ? feishuQrExpired : wechatQrExpired;
	const authPhase = isFeishuAuthDialog ? feishuAuthPhase : wechatAuthPhase;
	const authStatus = isFeishuAuthDialog ? feishuAuthStatus : wechatAuthStatus;
	const isAuthPending = isFeishuAuthDialog ? reauthorizeFeishu.isPending : reauthorizeWechat.isPending;
	const refreshAuthQr = isFeishuAuthDialog ? refreshFeishuQr : refreshWechatQr;

	return (
		<>
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
					showFeishuCredentialInvalidated={isFeishuCredentialInvalidated}
					showWechatReauthorize={isWechatDegraded}
					isReauthorizingFeishu={isPreparingFeishuQr}
					isReauthorizingWechat={isPreparingWechatQr}
					showRestartConfigHint={hasPendingRestartConfig}
					isRestartingConfig={restart.isPending}
					onOpenFeishuReauthorize={openFeishuReauthorizeDialog}
					onOpenWechatReauthorize={openWechatReauthorizeDialog}
					onRestartConfig={() => restart.mutate()}
					onReveal={() => revealFinder.mutate()}
					onDelete={() => remove.mutate()}
					deleteError={remove.error instanceof Error ? remove.error.message : undefined}
				/>
				<div className="bg-white px-7">
					<TabsList variant="line" className="-ml-2 h-8 justify-start gap-5">
						{tabs.map((tab) => (
							<TabsTrigger key={tab.id} value={tab.id} className="flex-none gap-2 px-2.5 text-sm">
								<AppIcon IconComponent={tab.icon} className="size-3.5" />
								{t(tab.labelKey)}
							</TabsTrigger>
						))}
					</TabsList>
				</div>
				<div
					className={cn(
						"flex-1 bg-white pt-2",
						"min-h-0 overflow-hidden",
						detailContentPadding,
					)}
				>
					<div
						className={cn(
							"h-full min-h-0",
							activeTab === "logs" || activeTab === "chat" ? "overflow-hidden px-4" : "overflow-y-auto px-4 [scrollbar-gutter:stable]",
						)}
					>
						<AgentContentPanels
							activeTab={activeTab}
							agent={agent}
							usage={usage}
							resources={resources}
							resourceHistory={resourceHistory}
							draft={draft}
							channelDraft={channelDraft}
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
							isSyncingFeishu={syncFeishuAppProfile.isPending}
							isSyncingDiscord={syncDiscordBotProfile.isPending}
							isReauthorizingFeishu={isPreparingFeishuQr}
							isReauthorizingWechat={isPreparingWechatQr}
							onUpdateField={updateField}
							onUpdateProviderSelection={updateProviderSelection}
							onOpenSystemPrompt={() => openSystemPrompt.mutate()}
							onOpenSkillSource={(sourceId) => openSkillSource.mutate(sourceId)}
							onOpenSkillFolder={(sourceId, skillName) => openSkillFolder.mutate({ sourceId, skillName })}
							onUpdateChannelField={updateChannelField}
							onSyncFeishu={() => syncFeishuAppProfile.mutate()}
							onSyncDiscord={() => syncDiscordBotProfile.mutate()}
							onReauthorizeFeishu={openFeishuReauthorizeDialog}
							onReauthorizeWechat={openWechatReauthorizeDialog}
						/>
					</div>
				</div>
			</Tabs>
			<Dialog open={Boolean(authDialogKind)} onOpenChange={(open) => setAuthDialogKind(open ? authDialogKind : undefined)}>
				<DialogContent className="pie-smooth-corner max-w-[360px] gap-5 p-7 text-center sm:max-w-[360px]">
					<DialogHeader className="items-center gap-2">
						<DialogTitle className="text-xl font-semibold leading-7 text-balance">
							{isFeishuAuthDialog ? t("feishuReauthTitle") : t("wechatReauthTitle")}
						</DialogTitle>
						<DialogDescription className="max-w-[260px] text-center leading-relaxed text-pretty">
							{isFeishuAuthDialog ? t("feishuReauthDesc") : t("wechatReauthDesc")}
						</DialogDescription>
					</DialogHeader>
					<div className="flex min-h-[220px] items-center justify-center">
						{authPhase === "done" ? (
							<div className="flex h-[220px] w-[220px] items-center justify-center">
								<AppIcon IconComponent={CheckCircleBoldDuotone} className="size-24 text-[var(--lime-10)]" />
							</div>
						) : authQrEvent?.url ? (
							<div className="relative flex h-[220px] w-[220px] items-center justify-center overflow-hidden">
								<QRCodeSVG value={authQrEvent.url} size={220} level="M" includeMargin={false} />
								{authQrExpired ? (
									<div className="absolute inset-0 flex flex-col items-center justify-center bg-white/88 text-center backdrop-blur-[1px]">
										<div className="text-xs font-medium text-foreground">{t("qrExpired")}</div>
										<Button
											variant="unstyled"
											size="inline"
											className="mt-2 h-5 px-1 text-[11px] font-medium text-[var(--lime-11)] transition-colors hover:text-[var(--lime-12)]"
											disabled={isAuthPending}
											onClick={refreshAuthQr}
										>
											{t("refreshQr")}
										</Button>
									</div>
								) : null}
							</div>
						) : (
							<div className="h-[220px] w-[220px] animate-pulse bg-muted" />
						)}
					</div>
					<div className="min-h-5 text-sm leading-relaxed text-muted-foreground">
						{authStatus ?? (isFeishuAuthDialog ? t("confirmInFeishu") : t("confirmInWechat"))}
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}
