import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { QRCodeSVG } from "qrcode.react";
import { GalleryAddLineDuotone, RestartCircleBoldDuotone } from "solar-icon-set";
import type {
	AgentAvatarUpload,
	AgentCreationSession,
	AgentDetails,
	AgentOnboardEvent,
	AgentSummary,
	DesktopAgentHarness,
	DesktopCodexDiagnostic,
	DesktopCodexWebSearchMode,
	DesktopChannelKind,
	DesktopDiscordBotProfile,
	DesktopFeishuAppCredentials,
	DesktopManagedRuntimeStatus,
	DesktopRuntimeDiagnostic,
	DesktopThinkingLevel,
	DesktopWechatCredentials,
	ImportableHarnessProfile,
} from "../../../shared/types";
import {
	DEFAULT_OPENAI_MODEL_ID,
	defaultModelForProvider,
	defaultProviderFromModels,
	HERMES_MODEL_OPTIONS,
	mergeModelOptions,
	providersFromModels,
} from "../../../../shared/model-catalog";
import { AppIcon } from "../../components/shared/app-icon";
import { AgentAvatar } from "../../components/shared/agent-avatar";
import { Field } from "../../components/shared/field";
import { AceternityTooltip } from "../../components/shared/tooltip";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Spinner } from "../../components/ui/spinner-1";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { thinkingLevelOptions } from "./agent-display";
import { ProviderSelect } from "./ProviderSelect";

const channelOptions = [
	{ value: "feishu", labelKey: "feishu", enabled: true, developerOnly: false },
	{ value: "wechat", labelKey: "wechat", enabled: true, developerOnly: false },
	{ value: "discord", label: "Discord", enabled: true, developerOnly: false },
	{ value: "dingtalk", labelKey: "dingtalk", enabled: true, developerOnly: false },
] as const;

const manualChannelKinds: DesktopChannelKind[] = ["discord", "dingtalk"];
const controlSurfaceClass = "border-transparent bg-[var(--slate-2)] hover:border-transparent focus-visible:border-transparent";
type CreateAgentStep = "config" | "identity" | "auth" | "credentials" | "model" | "runtime";
type AgentCreationMode = "create" | "import";
type InstallStepTone = "active" | "done" | "error";
type InstallStep = { id: number; message: string; tone: InstallStepTone };

function appendInstallStep(steps: InstallStep[], message: string, tone: InstallStepTone): InstallStep[] {
	const cleanMessage = message.trim();
	if (!cleanMessage) {
		return steps;
	}
	const lastStep = steps.at(-1);
	if (lastStep?.message === cleanMessage) {
		return [...steps.slice(0, -1), { ...lastStep, tone }];
	}
	return [...steps, { id: Date.now() + steps.length, message: cleanMessage, tone }].slice(-6);
}

const harnessOptions: Array<{ value: DesktopAgentHarness; label: string; enabled: boolean; developerOnly: boolean }> = [
	{ value: "openclaw", label: "OpenClaw", enabled: true, developerOnly: false },
	{ value: "hermes", label: "Hermes", enabled: true, developerOnly: false },
	{ value: "codex", label: "Codex", enabled: true, developerOnly: false },
	{ value: "pi", label: "Pi", enabled: true, developerOnly: false },
	{ value: "ousia", label: "Ousia", enabled: true, developerOnly: false },
];

const codexWebSearchOptions: Array<{ value: DesktopCodexWebSearchMode; label: string }> = [
	{ value: "cached", label: "Cached" },
	{ value: "disabled", label: "Disabled" },
	{ value: "live", label: "Live" },
];

const harnessModelConfig = {
	pi: {
		usesCodexCli: false,
		showsProvider: true,
		showsApiKey: true,
		showsCodexAccessMode: false,
		showsCodexWebSearch: false,
	},
	ousia: {
		usesCodexCli: false,
		showsProvider: true,
		showsApiKey: true,
		showsCodexAccessMode: false,
		showsCodexWebSearch: false,
	},
	codex: {
		usesCodexCli: true,
		showsProvider: false,
		showsApiKey: false,
		showsCodexAccessMode: true,
		showsCodexWebSearch: true,
	},
	"claude-code": {
		usesCodexCli: false,
		showsProvider: true,
		showsApiKey: true,
		showsCodexAccessMode: false,
		showsCodexWebSearch: false,
	},
	hermes: {
		usesCodexCli: false,
		showsProvider: true,
		showsApiKey: true,
		showsCodexAccessMode: false,
		showsCodexWebSearch: false,
	},
	openclaw: {
		usesCodexCli: false,
		showsProvider: true,
		showsApiKey: true,
		showsCodexAccessMode: false,
		showsCodexWebSearch: false,
	},
} satisfies Record<DesktopAgentHarness, {
	usesCodexCli: boolean;
	showsProvider: boolean;
	showsApiKey: boolean;
	showsCodexAccessMode: boolean;
	showsCodexWebSearch: boolean;
}>;

function getDefaultResumeSessionsForHarness(harness: DesktopAgentHarness): boolean {
	return harness === "hermes" || harness === "openclaw";
}

export function CreateAgentView({
	onCancel,
	onCreated,
	onError,
}: {
	onCancel: () => void;
	onCreated: (agent: AgentDetails) => void;
	onError: (message: string) => void;
}): JSX.Element {
	const { t } = useI18n();
	const [session, setSession] = useState<AgentCreationSession | undefined>();
	const [step, setStep] = useState<CreateAgentStep>("config");
	const [stepHistory, setStepHistory] = useState<CreateAgentStep[]>([]);
	const [name, setName] = useState("");
	const [avatarUpload, setAvatarUpload] = useState<AgentAvatarUpload | undefined>();
	const avatarFileInputRef = useRef<HTMLInputElement | null>(null);
	const [creationMode, setCreationMode] = useState<AgentCreationMode>("create");
	const [importedHarnessProfileId, setImportedHarnessProfileId] = useState("");
	const [feishu, setFeishu] = useState<DesktopFeishuAppCredentials | undefined>();
	const [wechat, setWechat] = useState<DesktopWechatCredentials | undefined>();
	const [channels, setChannels] = useState<DesktopChannelKind[]>(["feishu"]);
	const [discordBotToken, setDiscordBotToken] = useState("");
	const [discordApplicationId, setDiscordApplicationId] = useState("");
	const [discordGuildId, setDiscordGuildId] = useState("");
	const [discordProfile, setDiscordProfile] = useState<DesktopDiscordBotProfile | undefined>();
	const [discordSyncStatus, setDiscordSyncStatus] = useState("");
	const [dingtalkClientId, setDingTalkClientId] = useState("");
	const [dingtalkClientSecret, setDingTalkClientSecret] = useState("");
	const [qrEvent, setQrEvent] = useState<AgentOnboardEvent | undefined>();
	const [qrExpiresAt, setQrExpiresAt] = useState<number | undefined>();
	const [qrExpired, setQrExpired] = useState(false);
	const [status, setStatus] = useState("");
	const [codexLoginStatus, setCodexLoginStatus] = useState("");
	const [codexLoginUrl, setCodexLoginUrl] = useState("");
	const [hermesInstallStatus, setHermesInstallStatus] = useState("");
	const [hermesInstallSteps, setHermesInstallSteps] = useState<InstallStep[]>([]);
	const [hermesRuntimeReady, setHermesRuntimeReady] = useState(false);
	const [openClawInstallStatus, setOpenClawInstallStatus] = useState("");
	const [openClawInstallSteps, setOpenClawInstallSteps] = useState<InstallStep[]>([]);
	const [openClawRuntimeReady, setOpenClawRuntimeReady] = useState(false);
	const [harness, setHarness] = useState<DesktopAgentHarness>("pi");
	const [provider, setProvider] = useState("kimi-coding");
	const [model, setModel] = useState("k2p6");
	const [thinkingLevel, setThinkingLevel] = useState<DesktopThinkingLevel>("off");
	const [startFreshOnRestart, setStartFreshOnRestart] = useState(true);
	const [codexWebSearchMode, setCodexWebSearchMode] = useState<DesktopCodexWebSearchMode>("cached");
	const [apiKey, setApiKey] = useState("");
	const credentialRequestRef = useRef(0);
	const queryClient = useQueryClient();
	const settings = useQuery({
		queryKey: ["settings"],
		queryFn: () => window.pie.getSettings(),
	});
	const developerMode = settings.data?.developerMode === true;
	const importableOpenClawProfiles = useQuery({
		queryKey: ["importable-harness-profiles", "openclaw"],
		queryFn: () => window.pie.listImportableHarnessProfiles("openclaw"),
		enabled: creationMode === "import",
		refetchOnWindowFocus: false,
		retry: false,
	});
	const importableHermesProfiles = useQuery({
		queryKey: ["importable-harness-profiles", "hermes"],
		queryFn: () => window.pie.listImportableHarnessProfiles("hermes"),
		enabled: creationMode === "import",
		refetchOnWindowFocus: false,
		retry: false,
	});
	const codexDiagnostic = useQuery({
		queryKey: ["codex-diagnostic"],
		queryFn: () => window.pie.checkCodexEnvironment(),
		enabled: harness === "codex",
		refetchOnWindowFocus: false,
		retry: false,
	});
	const hermesDiagnostic = useQuery({
		queryKey: ["hermes-diagnostic"],
		queryFn: () => window.pie.checkHermesEnvironment(),
		enabled: harness === "hermes",
		refetchOnWindowFocus: false,
		retry: false,
	});
	const openClawCatalog = useQuery({
		queryKey: ["openclaw-model-catalog"],
		queryFn: () => window.pie.getOpenClawModelCatalog(),
		enabled: harness === "openclaw",
		refetchOnWindowFocus: false,
		retry: false,
		staleTime: 5 * 60_000,
	});
	const openClawDiagnostic = useQuery({
		queryKey: ["managed-runtime", "openclaw"],
		queryFn: () => window.pie.getManagedRuntimeStatus("openclaw"),
		enabled: harness === "openclaw",
		refetchOnWindowFocus: false,
		retry: false,
	});
	const applyFeishuApp = (created: DesktopFeishuAppCredentials) => {
		setFeishu(created);
		if (!importedHarnessProfileId || !requiresIdentity) {
			if (created.appName?.trim()) {
				setName(created.appName.trim());
			}
			return;
		}
		if (created.appName?.trim()) {
			setName(created.appName.trim());
		}
	};
	const prefillProviderApiKey = async (nextProvider: string, excludeAgentId: string | undefined, force = false) => {
		const requestId = ++credentialRequestRef.current;
		const reusable = await window.pie.findReusableProviderCredential(nextProvider, excludeAgentId);
		if (requestId !== credentialRequestRef.current) {
			return;
		}
		setApiKey((current) => {
			if (!force && current.trim()) {
				return current;
			}
			return reusable?.value ?? "";
		});
	};
	const goToStep = (nextStep: CreateAgentStep) => {
		setStepHistory((current) => [...current, step]);
		setStep(nextStep);
	};
	const goBack = () => {
		const previous = stepHistory.at(-1);
		if (!previous) {
			onCancel();
			return;
		}
		setStepHistory((current) => current.slice(0, -1));
		setStep(previous);
	};

	const begin = useMutation({
		mutationFn: () => window.pie.beginAgentCreation(),
		onSuccess: (created) => {
			setSession(created);
			setName(created.name);
			const defaultProvider = defaultProviderFromModels(created.models);
			const defaultModel = defaultModelForProvider(created.models, defaultProvider);
			setProvider(defaultProvider);
			setModel(defaultModel);
			void prefillProviderApiKey(defaultProvider, created.profileId, true);
			setStep("config");
			setStepHistory([]);
		},
		onError: (err: Error) => onError(err.message),
	});
	const authenticateChannels = useMutation({
		mutationFn: async () => {
			if (!session) {
				throw new Error(t("creationNotInitialized"));
			}
			let nextFeishu: DesktopFeishuAppCredentials | undefined;
			let nextWechat: DesktopWechatCredentials | undefined;
			if (channels.includes("feishu")) {
				nextFeishu = await window.pie.createFeishuApp(session.sessionId);
			}
			if (channels.includes("wechat")) {
				nextWechat = await window.pie.createWechatLogin(session.sessionId);
			}
			return { feishu: nextFeishu, wechat: nextWechat };
		},
		onSuccess: (created) => {
			if (created.feishu) {
				applyFeishuApp(created.feishu);
			}
			if (created.wechat) {
				setWechat(created.wechat);
			}
			setStepHistory((current) => current.at(-1) === "auth" ? current : [...current, "auth"]);
			setStep("model");
		},
		onError: (err: Error) => {
			if (
				step === "auth" &&
				(err.message.includes("expired_token") ||
					err.message.includes("Polling timed out") ||
					err.message.includes("二维码已失效"))
			) {
				setQrExpired(true);
				setStatus(t("qrExpiredRefresh"));
				return;
			}
			onError(err.message);
		},
	});
	const syncDiscordProfile = useMutation({
		mutationFn: async () => {
			if (!session) {
				throw new Error(t("creationNotInitialized"));
			}
			if (!discordBotToken.trim()) {
				throw new Error(t("discordTokenRequired"));
			}
			setDiscordSyncStatus(t("fetching"));
			return window.pie.fetchDiscordBotProfile(session.sessionId, discordBotToken);
		},
		onSuccess: (profile) => {
			setDiscordProfile(profile);
			setDiscordBotToken(profile.botToken);
			if (profile.applicationId) {
				setDiscordApplicationId(profile.applicationId);
			}
			if (!importedHarnessProfileId && profile.botName?.trim()) {
				setName(profile.botName.trim());
			}
			setDiscordSyncStatus(t("discordProfileFetched"));
		},
		onError: (err: Error) => {
			setDiscordSyncStatus(err.message);
			onError(err.message);
		},
	});
	const complete = useMutation({
		mutationFn: () => {
			if (!session) {
				throw new Error(t("creationNotCompleted"));
			}
			if (!channels.length) {
				throw new Error(t("selectOneChannel"));
			}
			if (channels.includes("feishu") && !feishu) {
				throw new Error(t("feishuAuthIncomplete"));
			}
			if (channels.includes("wechat") && !wechat) {
				throw new Error(t("wechatAuthIncomplete"));
			}
			if (channels.includes("discord") && !discordBotToken.trim()) {
				throw new Error(t("discordTokenRequired"));
			}
			if (channels.includes("dingtalk") && (!dingtalkClientId.trim() || !dingtalkClientSecret.trim())) {
				throw new Error(t("dingtalkCredentialsRequired"));
			}
			if (harness === "codex" && (!codexDiagnostic.data?.installed || !codexDiagnostic.data.authenticated)) {
				throw new Error(t("codexNeedInstalled"));
			}
			if (harness === "hermes" && !isHermesRuntimeReady) {
				throw new Error(t("hermesNeedInstalled"));
			}
			return window.pie.completeAgentCreation({
				sessionId: session.sessionId,
				harness,
				...(importedHarnessProfileId ? { importedHarnessProfileId } : {}),
				name,
				...(avatarUpload ? { avatarUpload } : {}),
				channels,
				...(feishu ? { feishu } : {}),
				...(wechat ? { wechat } : {}),
				...(channels.includes("discord")
					? {
							discord: {
								botToken: discordBotToken,
								applicationId: discordApplicationId,
								guildId: discordGuildId,
								botName: name,
								avatarUrl: discordProfile?.avatarUrl,
							},
						}
					: {}),
				...(channels.includes("dingtalk")
					? {
							dingtalk: {
								clientId: dingtalkClientId,
								clientSecret: dingtalkClientSecret,
							},
						}
					: {}),
				provider,
				model,
				thinkingLevel,
				resumeSessions: !startFreshOnRestart,
				apiKey,
				...(harness === "codex"
					? {
							codexSandboxMode: "danger-full-access" as const,
							codexWebSearchMode,
						}
					: {}),
			});
		},
		onMutate: async () => {
			if (!session) {
				return;
			}
			const optimisticAgent = createOptimisticStartingAgent({
				session,
				name,
				avatarUrl: avatarUpload?.dataUrl,
				harness,
				channels,
				feishu,
				wechat,
				discordProfile,
				provider,
				model,
				thinkingLevel,
				resumeSessions: !startFreshOnRestart,
				importedHarnessProfileId,
			});
			await queryClient.cancelQueries({ queryKey: ["agents"] });
			await queryClient.cancelQueries({ queryKey: ["agent", session.sessionId] });
			queryClient.setQueryData<AgentSummary[]>(["agents"], (current) => {
				const existing = current ?? [];
				return existing.some((agent) => agent.id === optimisticAgent.id)
					? existing.map((agent) => (agent.id === optimisticAgent.id ? { ...agent, ...optimisticAgent } : agent))
					: [optimisticAgent, ...existing];
			});
			queryClient.setQueryData(["agent", session.sessionId], optimisticAgent);
			onCreated(optimisticAgent);
		},
		onSuccess: async (agent) => {
			await queryClient.invalidateQueries({ queryKey: ["agents"] });
			queryClient.setQueryData(["agent", agent.id], agent);
			onCreated(agent);
		},
		onError: (err: Error) => {
			void queryClient.invalidateQueries({ queryKey: ["agents"] });
			if (session) {
				void queryClient.invalidateQueries({ queryKey: ["agent", session.sessionId] });
			}
			onError(err.message);
		},
	});
	const openCodexLogin = useMutation({
		mutationFn: () => {
			if (!session) {
				throw new Error(t("creationNotInitialized"));
			}
			setCodexLoginStatus(t("codexOpeningLogin"));
			return window.pie.openCodexLogin(session.sessionId);
		},
		onSuccess: async () => {
			await codexDiagnostic.refetch();
			setCodexLoginStatus(t("codexLoginUpdated"));
		},
		onError: (err: Error) => onError(err.message),
	});
	const installCodex = useMutation({
		mutationFn: () => {
			if (!session) {
				throw new Error(t("creationNotInitialized"));
			}
			setCodexLoginStatus(t("codexInstalling"));
			return window.pie.installCodex(session.sessionId);
		},
		onSuccess: async (diagnostic) => {
			await codexDiagnostic.refetch();
			if (diagnostic.installed && !diagnostic.authenticated) {
				openCodexLogin.mutate();
				return;
			}
			setCodexLoginStatus(diagnostic.authenticated ? t("codexLoginUpdated") : diagnostic.error || t("codexInstallDone"));
		},
		onError: (err: Error) => onError(err.message),
	});
	const installHermes = useMutation({
		mutationFn: () => {
			if (!session) {
				throw new Error(t("creationNotInitialized"));
			}
			setHermesInstallStatus(t("hermesInstalling"));
			setHermesInstallSteps([{ id: Date.now(), message: t("hermesPreparingInstall"), tone: "active" }]);
			return window.pie.installHermes(session.sessionId);
		},
		onSuccess: async (diagnostic) => {
			const refreshed = await hermesDiagnostic.refetch();
			const ready = diagnostic.ready || refreshed.data?.ready === true;
			setHermesRuntimeReady(ready);
			const message = ready ? t("hermesInstallDone") : diagnostic.error || refreshed.data?.error || t("hermesInstallFirst");
			setHermesInstallStatus(message);
			setHermesInstallSteps((steps) => appendInstallStep(steps, message, ready ? "done" : "error"));
		},
		onError: (err: Error) => {
			setHermesInstallSteps((steps) => appendInstallStep(steps, err.message, "error"));
			if (!err.message.includes(t("hermesInstallCancelled"))) {
				onError(err.message);
			}
		},
	});
	const installOpenClaw = useMutation({
		mutationFn: () => {
			setOpenClawInstallStatus(t("openclawInstallingOfficial"));
			setOpenClawInstallSteps([{ id: Date.now(), message: t("openclawPreparingInstall"), tone: "active" }]);
			return window.pie.upgradeManagedRuntime("openclaw");
		},
		onSuccess: async (diagnostic) => {
			const refreshed = await openClawDiagnostic.refetch();
			const ready = diagnostic.ready || refreshed.data?.ready === true;
			setOpenClawRuntimeReady(ready);
			const message = ready ? t("openclawInstallDone") : diagnostic.error || refreshed.data?.error || t("openclawInstallFirst");
			setOpenClawInstallStatus(message);
			setOpenClawInstallSteps((steps) => appendInstallStep(steps, message, ready ? "done" : "error"));
		},
		onError: (err: Error) => {
			setOpenClawInstallSteps((steps) => appendInstallStep(steps, err.message, "error"));
			onError(err.message);
		},
	});
	const cancelHermesInstall = useMutation({
		mutationFn: () => {
			if (!session) {
				throw new Error(t("creationNotInitialized"));
			}
			setHermesInstallStatus(t("hermesCancelingInstall"));
			setHermesInstallSteps((steps) => appendInstallStep(steps, t("hermesCancelingInstall"), "active"));
			return window.pie.cancelHermesInstall(session.sessionId);
		},
		onSuccess: () => {
			setHermesRuntimeReady(false);
			setHermesInstallStatus(t("hermesInstallCancelled"));
			setHermesInstallSteps((steps) => appendInstallStep(steps, t("hermesInstallCancelled"), "error"));
			void hermesDiagnostic.refetch();
		},
		onError: (err: Error) => onError(err.message),
	});

	useEffect(() => {
		begin.mutate();
	}, []);

	useEffect(() => {
		if (harness === "hermes" && hermesDiagnostic.data?.ready) {
			setHermesRuntimeReady(true);
		}
	}, [harness, hermesDiagnostic.data?.ready]);

	useEffect(() => {
		if (harness === "openclaw" && openClawDiagnostic.data?.ready) {
			setOpenClawRuntimeReady(true);
		}
	}, [harness, openClawDiagnostic.data?.ready]);

	useEffect(() => {
		if (harness !== "openclaw") {
			return;
		}
		const openClawModels = openClawCatalog.data?.models ?? [];
		if (!openClawModels.length) {
			return;
		}
		const currentStillAvailable = openClawModels.some((item) => item.provider === provider && item.id === model);
		if (currentStillAvailable) {
			return;
		}
		const openClawProviders = providersFromModels(openClawModels);
		const defaultProvider = openClawProviders.includes("kimi-coding") ? "kimi-coding" : openClawProviders[0] ?? "kimi-coding";
		setProvider(defaultProvider);
		setModel(openClawModels.find((item) => item.provider === defaultProvider)?.id ?? openClawModels[0]?.id ?? "");
		void prefillProviderApiKey(defaultProvider, session?.profileId, true);
	}, [harness, model, openClawCatalog.data?.models, provider, session?.profileId]);

	useEffect(() => {
		return window.pie.onAgentOnboardEvent((event) => {
			if (event.sessionId !== session?.sessionId) {
				return;
			}
			if (event.source === "codex-login" || event.source === "codex-install") {
				if (event.message) {
					setCodexLoginStatus(event.message);
				}
				if (event.url) {
					setCodexLoginUrl(event.url);
				}
				if (event.type === "done" || event.type === "error") {
					void queryClient.invalidateQueries({ queryKey: ["codex-diagnostic"] });
				}
				return;
			}
			if (event.source === "hermes-install") {
				if (event.message) {
					setHermesInstallStatus(event.message);
					setHermesInstallSteps((steps) =>
						appendInstallStep(steps, event.message ?? "", event.type === "error" ? "error" : event.type === "done" ? "done" : "active"),
					);
					if (event.type === "done") {
						setHermesRuntimeReady(true);
					}
				}
				if (event.type === "done" || event.type === "error") {
					void queryClient.invalidateQueries({ queryKey: ["hermes-diagnostic"] });
				}
				return;
			}
			if (event.type === "qr") {
				setQrEvent(event);
				setQrExpiresAt(event.expiresIn ? Date.now() + event.expiresIn * 1000 : undefined);
				setQrExpired(false);
			}
			if (event.message) {
				setStatus(event.message);
			}
			if (event.feishu) {
				applyFeishuApp(event.feishu);
			}
			if (event.wechat) {
				setWechat(event.wechat);
			}
			if (event.discord) {
				setDiscordProfile(event.discord);
				if (event.discord.applicationId) {
					setDiscordApplicationId(event.discord.applicationId);
				}
				if (!importedHarnessProfileId && event.discord.botName?.trim()) {
					setName(event.discord.botName.trim());
				}
			}
		});
	}, [importedHarnessProfileId, queryClient, session?.sessionId]);

	useEffect(() => {
		if (!qrExpiresAt) {
			setQrExpired(false);
			return;
		}
		const updateExpired = () => setQrExpired(Date.now() >= qrExpiresAt);
		updateExpired();
		const timer = window.setInterval(updateExpired, 1000);
		return () => window.clearInterval(timer);
	}, [qrExpiresAt]);

	const modelConfig = harnessModelConfig[harness];
	const usesCodexCli = modelConfig.usesCodexCli;
	const activeModelOptions = harness === "hermes"
		? mergeModelOptions(session?.models ?? [], HERMES_MODEL_OPTIONS)
		: harness === "openclaw"
			? openClawCatalog.data?.models ?? session?.openClawModels ?? []
		: session?.models ?? [];
	const modelsForProvider = activeModelOptions.filter((item) => item.provider === provider);
	const providers = activeModelOptions.length ? providersFromModels(activeModelOptions) : [provider];
	const codexModels = session?.codexModels ?? [];
	const hermesDefaultModel = HERMES_MODEL_OPTIONS[0];
	const importableProfiles = [
		...(importableOpenClawProfiles.data ?? []),
		...(importableHermesProfiles.data ?? []),
	];
	const selectedImportKey = importedHarnessProfileId ? `${harness}:${importedHarnessProfileId}` : "";
	const importProfilesLoading = importableOpenClawProfiles.isLoading ||
		importableOpenClawProfiles.isFetching ||
		importableHermesProfiles.isLoading ||
		importableHermesProfiles.isFetching;
	const selectedCodexModel = codexModels.find((item) => item.id === model);
	const codexThinkingOptions = (selectedCodexModel?.supportedThinkingLevels.length
		? selectedCodexModel.supportedThinkingLevels
		: (["low", "medium", "high", "xhigh"] as DesktopThinkingLevel[])
	).map((value) => ({ value, label: value }));
	const updateCodexModelSelection = (nextModel: string) => {
		setModel(nextModel);
		const next = codexModels.find((item) => item.id === nextModel);
		setThinkingLevel(next?.defaultThinkingLevel ?? next?.supportedThinkingLevels[0] ?? "medium");
	};
	const updateProviderSelection = (nextProvider: string) => {
		setProvider(nextProvider);
		setModel(defaultModelForProvider(activeModelOptions, nextProvider));
		void prefillProviderApiKey(nextProvider, session?.profileId, true);
	};
	const updateHarnessSelection = (nextHarness: DesktopAgentHarness) => {
		setHarness(nextHarness);
		setImportedHarnessProfileId("");
		setStartFreshOnRestart(!getDefaultResumeSessionsForHarness(nextHarness));
		setHermesRuntimeReady(nextHarness === "hermes" && hermesDiagnostic.data?.ready === true);
		if (nextHarness === "codex") {
			const defaultCodexModel = session?.codexModels[0];
			setProvider("codex-cli");
			setModel(defaultCodexModel?.id ?? DEFAULT_OPENAI_MODEL_ID);
			setThinkingLevel(defaultCodexModel?.defaultThinkingLevel ?? defaultCodexModel?.supportedThinkingLevels[0] ?? "medium");
			setApiKey("");
			return;
		}
		if (nextHarness === "hermes") {
			const hermesModels = mergeModelOptions(session?.models ?? [], HERMES_MODEL_OPTIONS);
			const hermesProviders = providersFromModels(hermesModels);
			const defaultProvider = hermesProviders.includes(hermesDefaultModel.provider)
				? hermesDefaultModel.provider
				: hermesProviders[0] ?? hermesDefaultModel.provider;
			setProvider(defaultProvider);
			setModel(hermesModels.find((item) => item.provider === defaultProvider)?.id ?? "");
			setThinkingLevel("off");
			void prefillProviderApiKey(defaultProvider, session?.profileId, true);
			return;
		}
		if (nextHarness === "openclaw") {
			const openClawModels = openClawCatalog.data?.models ?? session?.openClawModels ?? [];
			const openClawProviders = providersFromModels(openClawModels);
			const defaultProvider = openClawProviders.includes("kimi-coding") ? "kimi-coding" : openClawProviders[0] ?? "kimi-coding";
			setProvider(defaultProvider);
			setModel(openClawModels.find((item) => item.provider === defaultProvider)?.id ?? "");
			setThinkingLevel("off");
			void prefillProviderApiKey(defaultProvider, session?.profileId, true);
			return;
		}
		if (provider === "codex-cli") {
			const defaultProvider = session?.models ? defaultProviderFromModels(session.models) : "openai";
			setProvider(defaultProvider);
			setModel(defaultModelForProvider(session?.models ?? [], defaultProvider));
			void prefillProviderApiKey(defaultProvider, session?.profileId, true);
		}
	};
	const applyImportedHarnessProfile = (imported: ImportableHarnessProfile) => {
		setHarness(imported.harness);
		setImportedHarnessProfileId(imported.id);
		setStartFreshOnRestart(!getDefaultResumeSessionsForHarness(imported.harness));
		if (requiresIdentity) {
			setName(imported.id);
		}
		if (imported.provider) {
			setProvider(imported.provider);
		}
		if (imported.model) {
			setModel(imported.model);
		}
		if (imported.provider) {
			void prefillProviderApiKey(imported.provider, session?.profileId, true);
		}
	};
	const updateCreationMode = (nextMode: AgentCreationMode) => {
		setCreationMode(nextMode);
		setImportedHarnessProfileId("");
		if (nextMode === "create") {
			setHarness("pi");
			const defaultProvider = session?.models ? defaultProviderFromModels(session.models) : "kimi-coding";
			setProvider(defaultProvider);
			setModel(defaultModelForProvider(session?.models ?? [], defaultProvider));
			void prefillProviderApiKey(defaultProvider, session?.profileId, true);
		}
	};
	const selectChannel = (channel: DesktopChannelKind) => {
		setChannels([channel]);
		if (
			creationMode === "import" &&
			importedHarnessProfileId &&
			(channel === "wechat" || channel === "discord")
		) {
			setName((current) => current.trim() ? current : importedHarnessProfileId);
		}
	};
	const requiresQrAuth = channels.includes("feishu") || channels.includes("wechat");
	const requiresIdentity = (channels.includes("wechat") && !channels.some((channel) => channel === "feishu")) ||
		channels.includes("discord");
	const requiresManualCredentials = channels.some((channel) => manualChannelKinds.includes(channel));
	const authPrompt = channels.includes("wechat")
		? t("useWechatScan")
		: t("useFeishuScan");
	const isHermesRuntimeReady = harness === "hermes" && (hermesRuntimeReady || hermesDiagnostic.data?.ready === true);
	const isOpenClawRuntimeReady = harness === "openclaw" && (openClawRuntimeReady || openClawDiagnostic.data?.ready === true);
	const requiresRuntimeInstall = (harness === "hermes" && !isHermesRuntimeReady) || (harness === "openclaw" && !isOpenClawRuntimeReady);
	const visibleSteps = createAgentStepFlow({
		requiresIdentity,
		identityAfterCredentials: channels.includes("discord"),
		requiresQrAuth,
		requiresManualCredentials,
		requiresRuntimeInstall: requiresRuntimeInstall || step === "runtime",
	});
	const stepDescription = {
		config: creationMode === "import" ? t("chooseExistingAgent") : t("chooseHarnessAndChannel"),
		identity: channels.includes("discord") ? t("setDiscordNameAvatar") : t("setWechatNameAvatar"),
		auth: t("authSelectedChannels"),
		credentials: t("fillChannelCredentials"),
		model: t("configureModelAndKey"),
		runtime: t("installRuntimeDesc"),
	}[step];
	const stepTitle = {
		config: creationMode === "import" ? t("importMyAgent") : t("chooseAgentType"),
		identity: t("setAgentInfo"),
		auth: t("scanAuth"),
		credentials: t("connectChannel"),
		model: t("chooseModel"),
		runtime: t("installRuntime"),
	}[step];
	const handleNext = () => {
		if (step === "config") {
			setStatus("");
			setQrEvent(undefined);
			setQrExpiresAt(undefined);
			setQrExpired(false);
			if (creationMode === "import") {
				if (requiresManualCredentials) {
					goToStep("credentials");
				} else if (requiresIdentity) {
					goToStep("identity");
				} else if (requiresQrAuth) {
					goToStep("auth");
					authenticateChannels.mutate();
				} else {
					goToStep("model");
				}
				return;
			}
			if (channels.includes("discord") && requiresManualCredentials) {
				goToStep("credentials");
			} else if (requiresIdentity) {
				goToStep("identity");
			} else if (requiresQrAuth) {
				goToStep("auth");
				authenticateChannels.mutate();
			} else if (requiresManualCredentials) {
				goToStep("credentials");
			} else {
				goToStep("model");
			}
			return;
		}
		if (step === "identity") {
			setStatus("");
			setQrEvent(undefined);
			setQrExpiresAt(undefined);
			setQrExpired(false);
			if (channels.includes("discord")) {
				goToStep("model");
				return;
			}
			goToStep("auth");
			authenticateChannels.mutate();
			return;
		}
		if (step === "credentials") {
			if (requiresIdentity) {
				goToStep("identity");
				return;
			}
			goToStep("model");
			return;
		}
		if (step === "model" && requiresRuntimeInstall) {
			goToStep("runtime");
			return;
		}
		complete.mutate();
	};
	const nextDisabled = begin.isPending
		|| !session
		|| (step === "config" && (creationMode === "import" ? !importedHarnessProfileId : !channels.length))
		|| (step === "identity" && !name.trim())
		|| (step === "model" && harness === "openclaw" && openClawCatalog.isLoading)
		|| (step === "model" && (complete.isPending || installCodex.isPending))
		|| (step === "runtime" && (
			complete.isPending ||
			installHermes.isPending ||
			installOpenClaw.isPending ||
			(harness === "hermes" && !isHermesRuntimeReady) ||
			(harness === "openclaw" && !isOpenClawRuntimeReady)
		));
	const currentStepIndex = visibleSteps.indexOf(step);
	const canUploadCreationAvatar = step === "identity" && !channels.includes("feishu");

	return (
		<div className="flex h-full flex-col overflow-hidden bg-white">
			<header className="drag-region flex h-[72px] shrink-0 items-center justify-between gap-4 px-7 pt-3">
				<div className="min-w-0">
					<h1 className="text-xl font-semibold tracking-normal text-balance">{t("createAgent")}</h1>
					<p className="mt-1 text-sm text-muted-foreground text-pretty">{stepDescription}</p>
				</div>
				<div className="flex shrink-0 items-center gap-4">
					<div className="flex items-center gap-2">
						{visibleSteps.map((item, index) => (
							<span
								key={item}
								className={cn(
									"h-1.5 w-10 rounded-full transition-colors",
									index <= currentStepIndex ? "bg-[var(--lime-9)]" : "bg-[var(--slate-5)]",
								)}
							/>
						))}
					</div>
					<AceternityTooltip content={t("closeCreate")} side="bottom">
						<Button
							variant="unstyled"
							size="inline"
							className="no-drag inline-flex h-8 w-8 shrink-0 items-center justify-center text-[var(--slate-10)] transition hover:text-[var(--slate-12)]"
							onClick={() => {
								if (installHermes.isPending) {
									cancelHermesInstall.mutate();
								}
								onCancel();
							}}
							aria-label={t("closeCreate")}
						>
							<HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-5" />
						</Button>
					</AceternityTooltip>
				</div>
			</header>

			<div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
				<div className="flex min-h-full justify-center pt-8">
					<div className="w-full max-w-md">
						{begin.isPending || !session ? (
							<div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
								<AppIcon IconComponent={RestartCircleBoldDuotone} className="mr-2 h-4 w-4 animate-spin" /> {t("initializingConfig")}
							</div>
						) : (
							<div className="space-y-6">
								<h2 className="text-center text-lg font-semibold tracking-normal text-foreground">{stepTitle}</h2>
								{step === "config" ? (
									<div className="space-y-6">
										<CreationModeSwitch value={creationMode} onChange={updateCreationMode} />
										{creationMode === "import" ? (
											<>
												<ChannelPicker selected={channels[0]} developerMode={developerMode} onSelect={selectChannel} />
												<ImportHarnessProfileList
													profiles={importableProfiles}
													selectedKey={selectedImportKey}
													isLoading={importProfilesLoading}
													onRefresh={() => {
														void importableOpenClawProfiles.refetch();
														void importableHermesProfiles.refetch();
													}}
													onSelect={applyImportedHarnessProfile}
												/>
											</>
										) : (
											<>
												<HarnessPicker selected={harness} developerMode={developerMode} onSelect={updateHarnessSelection} />
												<ChannelPicker selected={channels[0]} developerMode={developerMode} onSelect={selectChannel} />
											</>
										)}
									</div>
								) : step === "identity" ? (
									<div className="space-y-6">
										<Field label={t("agentName")}>
											<Input className={controlSurfaceClass} value={name} onChange={(event) => setName(event.target.value)} />
										</Field>
										{canUploadCreationAvatar && (
											<DefaultAvatarUploader
												name={name}
												seed={session.sessionId}
												upload={avatarUpload}
												fileInputRef={avatarFileInputRef}
												onUpload={setAvatarUpload}
												onError={onError}
											/>
										)}
									</div>
								) : step === "auth" ? (
									<div className="space-y-4 text-center">
										<div className="text-sm font-normal text-foreground">
											{status || authPrompt}
										</div>
										<div className="flex justify-center pt-2">
											<div className="relative flex h-[196px] w-[196px] items-center justify-center overflow-hidden rounded-2xl bg-white">
												{qrEvent?.url ? (
													<QRCodeSVG value={qrEvent.url} size={180} level="M" includeMargin={false} />
												) : (
													<div className="h-[180px] w-[180px] animate-pulse bg-muted" />
												)}
												{qrExpired && (
													<div className="absolute inset-0 flex flex-col items-center justify-center bg-white/88 text-center backdrop-blur-[1px]">
														<div className="text-xs font-medium text-foreground">{t("qrExpired")}</div>
														<Button
															variant="unstyled"
															size="inline"
															className="mt-2 h-5 px-1 text-[11px] font-medium text-[var(--lime-11)] transition-colors hover:text-[var(--lime-12)]"
															disabled={authenticateChannels.isPending}
															onClick={() => {
																setQrEvent(undefined);
																setQrExpiresAt(undefined);
																setQrExpired(false);
																setStatus("");
																authenticateChannels.mutate();
															}}
														>
															{t("refreshQr")}
														</Button>
													</div>
												)}
											</div>
										</div>
									</div>
								) : step === "credentials" ? (
									<div className="space-y-4">
										<ManualChannelCredentials
											channels={channels}
											discordBotToken={discordBotToken}
											discordApplicationId={discordApplicationId}
											discordGuildId={discordGuildId}
											discordProfile={discordProfile}
											discordSyncStatus={discordSyncStatus}
											isSyncingDiscord={syncDiscordProfile.isPending}
											dingtalkClientId={dingtalkClientId}
											dingtalkClientSecret={dingtalkClientSecret}
											setDiscordBotToken={setDiscordBotToken}
											setDiscordApplicationId={setDiscordApplicationId}
											setDiscordGuildId={setDiscordGuildId}
											setDingTalkClientId={setDingTalkClientId}
											setDingTalkClientSecret={setDingTalkClientSecret}
											onSyncDiscordProfile={() => syncDiscordProfile.mutate()}
										/>
									</div>
								) : step === "runtime" && harness === "hermes" ? (
									<HermesDiagnosticPanel
										diagnostic={hermesDiagnostic.data}
										isRuntimeReady={isHermesRuntimeReady}
										isLoading={hermesDiagnostic.isFetching}
										error={hermesDiagnostic.error instanceof Error ? hermesDiagnostic.error.message : undefined}
										installStatus={hermesInstallStatus}
										installSteps={hermesInstallSteps}
										isInstalling={installHermes.isPending}
										onInstall={() => installHermes.mutate()}
										onCancelInstall={() => cancelHermesInstall.mutate()}
										onRefresh={async () => {
											const refreshed = await hermesDiagnostic.refetch();
											setHermesRuntimeReady(refreshed.data?.ready === true);
										}}
									/>
								) : step === "runtime" ? (
									<OpenClawDiagnosticPanel
										diagnostic={openClawDiagnostic.data}
										isRuntimeReady={isOpenClawRuntimeReady}
										isLoading={openClawDiagnostic.isFetching}
										error={openClawDiagnostic.error instanceof Error ? openClawDiagnostic.error.message : undefined}
										installStatus={openClawInstallStatus}
										installSteps={openClawInstallSteps}
										isInstalling={installOpenClaw.isPending}
										onInstall={() => installOpenClaw.mutate()}
										onRefresh={async () => {
											const refreshed = await openClawDiagnostic.refetch();
											setOpenClawRuntimeReady(refreshed.data?.ready === true);
										}}
									/>
								) : (
									<div className="space-y-6">
										{channels.includes("feishu") && <FeishuSyncPreview feishu={feishu} />}
										<div className={cn("grid gap-4", modelConfig.showsProvider ? "grid-cols-2" : "grid-cols-1")}>
											{modelConfig.showsProvider && (
											<Field label={t("provider")}>
													<ProviderSelect
														value={provider}
														providers={providers}
														triggerClassName={controlSurfaceClass}
														onValueChange={updateProviderSelection}
													/>
												</Field>
											)}
											<Field label={t("model")}>
												{harness === "openclaw" && openClawCatalog.isLoading ? (
													<div className={cn("flex h-9 items-center rounded-md px-3 text-sm text-muted-foreground", controlSurfaceClass)}>
														<AppIcon IconComponent={RestartCircleBoldDuotone} className="mr-2 h-4 w-4 animate-spin" />
														{t("loadingCatalog")}
													</div>
												) : usesCodexCli && codexModels.length ? (
													<Select value={model} onValueChange={updateCodexModelSelection}>
														<SelectTrigger className={controlSurfaceClass}>
															<SelectValue />
														</SelectTrigger>
														<SelectContent>
															{codexModels.map((item) => (
																<SelectItem key={item.id} value={item.id}>
																	{item.name || item.id}
																</SelectItem>
															))}
														</SelectContent>
													</Select>
												) : !usesCodexCli && modelsForProvider.length ? (
													<Select value={model} onValueChange={setModel}>
														<SelectTrigger className={controlSurfaceClass}>
															<SelectValue />
														</SelectTrigger>
														<SelectContent>
															{modelsForProvider.map((item) => <SelectItem key={item.id} value={item.id}>{item.name || item.id}</SelectItem>)}
														</SelectContent>
													</Select>
												) : (
													<Input className={controlSurfaceClass} value={model} onChange={(event) => setModel(event.target.value)} placeholder="model id" />
												)}
											</Field>
										</div>
										{!usesCodexCli && (
											<>
												{modelConfig.showsApiKey && (
												<Field label="API Key">
													<Input className={controlSurfaceClass} type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={t("apiKeyClearHint")} />
												</Field>
											)}
											<Field label={t("thinkingLevel")}>
													<Select value={thinkingLevel} onValueChange={(value) => setThinkingLevel(value as DesktopThinkingLevel)}>
														<SelectTrigger className={controlSurfaceClass}>
															<SelectValue />
														</SelectTrigger>
														<SelectContent>
															{thinkingLevelOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
														</SelectContent>
													</Select>
												</Field>
											</>
										)}
											{usesCodexCli && (
												<>
													<CodexDiagnosticPanel
													diagnostic={codexDiagnostic.data}
													isLoading={codexDiagnostic.isFetching}
													error={codexDiagnostic.error instanceof Error ? codexDiagnostic.error.message : undefined}
													loginStatus={codexLoginStatus}
													loginUrl={codexLoginUrl}
													isOpeningLogin={openCodexLogin.isPending}
													isInstalling={installCodex.isPending}
													onInstall={() => installCodex.mutate()}
													onOpenLogin={() => openCodexLogin.mutate()}
													onRefresh={() => void codexDiagnostic.refetch()}
												/>
												<Field label={t("thinkingLevel")}>
													<Select value={thinkingLevel} onValueChange={(value) => setThinkingLevel(value as DesktopThinkingLevel)}>
														<SelectTrigger className={controlSurfaceClass}>
															<SelectValue />
														</SelectTrigger>
														<SelectContent>
															{codexThinkingOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
														</SelectContent>
													</Select>
												</Field>
												{(modelConfig.showsCodexAccessMode || modelConfig.showsCodexWebSearch) && (
													<div className="grid grid-cols-2 gap-4">
														{modelConfig.showsCodexAccessMode && (
															<Field label={t("accessMode")}>
																<div className={cn("flex h-9 items-center rounded-md px-3 text-sm font-medium text-foreground", controlSurfaceClass)}>
																	{t("fullAccess")}
																</div>
															</Field>
														)}
														{modelConfig.showsCodexWebSearch && (
															<Field label={t("webSearch")}>
																<Select value={codexWebSearchMode} onValueChange={(value) => setCodexWebSearchMode(value as DesktopCodexWebSearchMode)}>
																	<SelectTrigger className={controlSurfaceClass}>
																		<SelectValue />
																	</SelectTrigger>
																	<SelectContent>
																		{codexWebSearchOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
																	</SelectContent>
																</Select>
															</Field>
														)}
													</div>
												)}
												</>
											)}
											<label className="flex cursor-pointer items-start gap-3 py-2.5">
												<Checkbox
													checked={startFreshOnRestart}
													onCheckedChange={(checked) => setStartFreshOnRestart(Boolean(checked))}
													className="mt-0.5"
												/>
												<span className="min-w-0 flex-1">
													<span className="block text-sm font-medium leading-snug text-foreground text-balance">{t("startFreshOnRestart")}</span>
													<span className="mt-0.5 block text-xs font-normal leading-5 text-muted-foreground text-pretty">{t("startFreshOnRestartDesc")}</span>
												</span>
											</label>
										</div>
									)}
							</div>
						)}
					</div>
				</div>
			</div>

			<footer className={cn("no-drag flex shrink-0 items-center border-t border-foreground/5 px-8 py-5", step === "config" ? "justify-end" : "justify-between")}>
				{step !== "config" && (
					<Button
						variant="secondary"
						onClick={() => {
							if (installHermes.isPending) {
								cancelHermesInstall.mutate();
							}
							goBack();
						}}
						disabled={complete.isPending}
					>
						{t("previous")}
					</Button>
				)}
				<div className="flex items-center gap-3">
					{step !== "auth" && (
						<Button disabled={nextDisabled} onClick={handleNext}>
							{complete.isPending ? (
								<>
									<Spinner size={18} color="currentColor" />
									{t("creating")}
								</>
							) : step === "model" ? (
								requiresRuntimeInstall ? t("next") : t("finishCreate")
							) : step === "runtime" ? (
								t("finishCreate")
							) : (
								t("next")
							)}
						</Button>
					)}
				</div>
			</footer>
		</div>
	);
}

function createAgentStepFlow({
	requiresIdentity,
	identityAfterCredentials,
	requiresQrAuth,
	requiresManualCredentials,
	requiresRuntimeInstall,
}: {
	requiresIdentity: boolean;
	identityAfterCredentials: boolean;
	requiresQrAuth: boolean;
	requiresManualCredentials: boolean;
	requiresRuntimeInstall: boolean;
}): CreateAgentStep[] {
	return [
		"config",
		...(requiresIdentity && !identityAfterCredentials ? ["identity" as const] : []),
		...(requiresQrAuth ? ["auth" as const] : []),
		...(requiresManualCredentials ? ["credentials" as const] : []),
		...(requiresIdentity && identityAfterCredentials ? ["identity" as const] : []),
		"model",
		...(requiresRuntimeInstall ? ["runtime" as const] : []),
	];
}

function createOptimisticStartingAgent({
	session,
	name,
	avatarUrl,
	harness,
	channels,
	feishu,
	wechat,
	discordProfile,
	provider,
	model,
	thinkingLevel,
	resumeSessions,
	importedHarnessProfileId,
}: {
	session: AgentCreationSession;
	name: string;
	avatarUrl: string | undefined;
	harness: DesktopAgentHarness;
	channels: DesktopChannelKind[];
	feishu: DesktopFeishuAppCredentials | undefined;
	wechat: DesktopWechatCredentials | undefined;
	discordProfile: DesktopDiscordBotProfile | undefined;
	provider: string;
	model: string;
	thinkingLevel: DesktopThinkingLevel;
	resumeSessions: boolean;
	importedHarnessProfileId: string;
}): AgentDetails {
	const now = new Date().toISOString();
	const displayName = importedHarnessProfileId
		? channels.includes("wechat") || channels.includes("discord")
			? name.trim() || importedHarnessProfileId
			: feishu?.appName?.trim() || importedHarnessProfileId
		: feishu?.appName?.trim() || name.trim() || session.name;
	return {
		id: session.sessionId,
		name: displayName,
		status: "starting",
		avatarSeed: session.sessionId,
		...(feishu?.avatarUrl || avatarUrl || discordProfile?.avatarUrl ? { avatarUrl: feishu?.avatarUrl || avatarUrl || discordProfile?.avatarUrl } : {}),
		desiredState: "running",
		selected: true,
		home: session.home,
		createdAt: now,
		updatedAt: now,
		harnessKind: harness,
		channelKinds: channels,
		modelLabel: model,
		...(feishu ? { appId: feishu.appId, brand: feishu.brand, feishuMessageOutputMode: "bubble" as const, appSecret: feishu.appSecret } : {}),
		...(wechat ? { wechat } : {}),
		model: {
			provider,
				model,
				thinkingLevel,
				resumeSessions,
				outputToolCallsToIm: true,
			outputToolCallImMaxLength: 60,
			outputThinkingToIm: false,
		},
		runtimeEnvironment: {
			homeDir: session.home,
			workDir: session.home,
			lifecycle: {
				state: "starting",
				updatedAt: now,
				reason: "creating",
			},
		},
	};
}

function CodexDiagnosticPanel({
	diagnostic,
	isLoading,
	error,
	loginStatus,
	loginUrl,
	isOpeningLogin,
	isInstalling,
	onInstall,
	onOpenLogin,
	onRefresh,
}: {
	diagnostic: DesktopCodexDiagnostic | undefined;
	isLoading: boolean;
	error?: string;
	loginStatus?: string;
	loginUrl?: string;
	isOpeningLogin: boolean;
	isInstalling: boolean;
	onInstall: () => void;
	onOpenLogin: () => void;
	onRefresh: () => void;
}): JSX.Element {
	const { t } = useI18n();
	const status = error
		? { label: t("codexDiagnosticFailed"), tone: "text-[var(--red-11)]", detail: error }
		: !diagnostic
		? { label: isLoading ? t("codexChecking") : t("codexNotChecked"), tone: "text-muted-foreground", detail: t("codexNeedInstalled") }
		: !diagnostic.installed
			? { label: t("codexMissing"), tone: "text-[var(--red-11)]", detail: diagnostic.error || t("codexInstallFirst") }
			: diagnostic.authenticated
				? { label: t("codexReady"), tone: "text-[var(--lime-11)]", detail: diagnostic.version || t("codexAuthenticated") }
				: { label: t("codexLoginRequired"), tone: "text-[var(--amber-11)]", detail: diagnostic.error || t("codexNeedLogin") };

	return (
		<div className="pie-smooth-corner rounded-2xl bg-[var(--slate-2)] px-3 py-3">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<div className={cn("text-sm font-medium", status.tone)}>{status.label}</div>
					<div className="mt-1 text-xs leading-5 text-muted-foreground">{loginStatus || status.detail}</div>
					{loginUrl && !diagnostic?.authenticated && (
						<a
							className="mt-1 block truncate text-xs font-medium text-[var(--lime-11)] hover:text-[var(--lime-12)]"
							href={loginUrl}
							target="_blank"
							rel="noreferrer"
						>
							{t("openLoginLink")}
						</a>
					)}
					{diagnostic?.executablePath && (
						<div className="mt-1 truncate text-[11px] text-muted-foreground">{diagnostic.executablePath}</div>
					)}
				</div>
				<div className="flex shrink-0 flex-col gap-2">
					<Button
						variant="secondary"
						size="xs"
						className="h-6 px-2.5 text-[11px] leading-4 font-medium text-[var(--slate-11)] hover:text-[var(--slate-12)]"
						onClick={onRefresh}
						disabled={isLoading}
					>
						{isLoading ? t("codexRefreshing") : t("codexRefresh")}
					</Button>
					{diagnostic && !diagnostic.installed && (
						<Button onClick={onInstall} disabled={isInstalling}>
							{isInstalling ? t("codexInstalling") : t("codexInstall")}
						</Button>
					)}
					{diagnostic?.installed && !diagnostic.authenticated && (
						<Button onClick={onOpenLogin} disabled={isOpeningLogin}>
							{isOpeningLogin ? t("codexOpening") : t("codexGoLogin")}
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}

function HermesDiagnosticPanel({
	diagnostic,
	isRuntimeReady,
	isLoading,
	error,
	installStatus,
	installSteps,
	isInstalling,
	onInstall,
	onCancelInstall,
	onRefresh,
}: {
	diagnostic: DesktopRuntimeDiagnostic | undefined;
	isRuntimeReady: boolean;
	isLoading: boolean;
	error?: string;
	installStatus?: string;
	installSteps: InstallStep[];
	isInstalling: boolean;
	onInstall: () => void;
	onCancelInstall: () => void;
	onRefresh: () => void;
}): JSX.Element {
	const { t } = useI18n();
	const ready = isRuntimeReady || diagnostic?.ready === true;
	const status = error
		? { label: t("hermesDiagnosticFailed"), tone: "text-[var(--red-11)]", detail: error }
		: ready
			? { label: t("hermesReady"), tone: "text-[var(--lime-11)]", detail: diagnostic?.version || t("hermesInstalled") }
		: !diagnostic
		? { label: isLoading ? t("hermesChecking") : t("hermesNotChecked"), tone: "text-muted-foreground", detail: t("hermesNeedInstalled") }
		: diagnostic.installed
				? { label: t("hermesUpgradeRequired"), tone: "text-[var(--amber-11)]", detail: diagnostic.error || diagnostic.version || t("hermesUpgradeFirst") }
			: { label: t("hermesMissing"), tone: "text-[var(--red-11)]", detail: diagnostic.error || t("hermesInstallFirst") };

	return (
		<div className="pie-smooth-corner rounded-2xl bg-[var(--slate-2)] px-3 py-3">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<div className={cn("text-sm font-medium", status.tone)}>{status.label}</div>
					<div className="mt-1 text-xs leading-5 text-muted-foreground">{installStatus || status.detail}</div>
					{diagnostic?.executablePath && (
						<div className="mt-1 truncate text-[11px] text-muted-foreground">{diagnostic.executablePath}</div>
					)}
				</div>
				<div className="flex shrink-0 flex-col gap-2">
					<Button
						variant="secondary"
						size="small"
						className="text-muted-foreground hover:text-[var(--slate-12)]"
						onClick={onRefresh}
						disabled={isLoading || isInstalling}
					>
						{isLoading ? t("hermesRefreshing") : t("hermesRefresh")}
					</Button>
					{!ready && (
						<Button
							variant={isInstalling ? "destructive" : "default"}
							size="small"
							onClick={isInstalling ? onCancelInstall : onInstall}
						>
							{isInstalling ? t("cancelInstall") : t("hermesInstall")}
						</Button>
					)}
				</div>
			</div>
			{installSteps.length > 0 && (
				<div className="mt-3 space-y-1.5 rounded-xl bg-white/70 p-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
					{installSteps.map((step, index) => {
						const isLatest = index === installSteps.length - 1;
						const dotClass = step.tone === "error" ? "bg-[var(--red-9)]" : "bg-[var(--lime-9)]";
						return (
							<div key={step.id} className="flex min-w-0 items-start gap-2 text-[11px] leading-5 text-muted-foreground">
								<span className={cn("mt-2 size-1.5 shrink-0 rounded-full", dotClass, isLatest && step.tone === "active" ? "animate-pulse" : "")} />
								<span className={cn("min-w-0 flex-1 truncate", isLatest ? "text-[var(--slate-12)]" : "")} title={step.message}>
									{step.message}
								</span>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

function OpenClawDiagnosticPanel({
	diagnostic,
	isRuntimeReady,
	isLoading,
	error,
	installStatus,
	installSteps,
	isInstalling,
	onInstall,
	onRefresh,
}: {
	diagnostic: DesktopManagedRuntimeStatus | undefined;
	isRuntimeReady: boolean;
	isLoading: boolean;
	error?: string;
	installStatus?: string;
	installSteps: InstallStep[];
	isInstalling: boolean;
	onInstall: () => void;
	onRefresh: () => void;
}): JSX.Element {
	const { t } = useI18n();
	const ready = isRuntimeReady || diagnostic?.ready === true;
	const status = error
		? { label: t("openclawDiagnosticFailed"), tone: "text-[var(--red-11)]", detail: error }
		: ready
			? { label: t("openclawReady"), tone: "text-[var(--lime-11)]", detail: diagnostic?.version || t("openclawInstalled") }
		: !diagnostic
		? { label: isLoading ? t("openclawChecking") : t("openclawNotChecked"), tone: "text-muted-foreground", detail: t("openclawNeedInstalled") }
		: diagnostic.installed
				? { label: t("openclawUpgradeRequired"), tone: "text-[var(--amber-11)]", detail: diagnostic.error || diagnostic.version || t("openclawUpgradeFirst") }
			: { label: t("openclawMissing"), tone: "text-[var(--red-11)]", detail: diagnostic.error || t("openclawInstallFirst") };

	return (
		<div className="pie-smooth-corner rounded-2xl bg-[var(--slate-2)] px-3 py-3">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<div className={cn("text-sm font-medium", status.tone)}>{status.label}</div>
					<div className="mt-1 text-xs leading-5 text-muted-foreground">{installStatus || status.detail}</div>
					<div className="mt-1 text-xs leading-5 text-muted-foreground">{t("openclawOfficialInstallDesc")}</div>
					{diagnostic?.executablePath && (
						<div className="mt-1 truncate text-[11px] text-muted-foreground">{diagnostic.executablePath}</div>
					)}
				</div>
				<div className="flex shrink-0 flex-col gap-2">
					<Button
						variant="secondary"
						size="small"
						className="text-muted-foreground hover:text-[var(--slate-12)]"
						onClick={onRefresh}
						disabled={isLoading || isInstalling}
					>
						{isLoading ? t("openclawRefreshing") : t("openclawRefresh")}
					</Button>
					{!ready && (
						<Button
							variant="default"
							size="small"
							onClick={onInstall}
							disabled={isInstalling}
						>
							{isInstalling ? t("openclawInstallingOfficial") : t("installOfficial")}
						</Button>
					)}
				</div>
			</div>
			{installSteps.length > 0 && (
				<div className="mt-3 space-y-1.5 rounded-xl bg-white/70 p-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
					{installSteps.map((step, index) => {
						const isLatest = index === installSteps.length - 1;
						const dotClass = step.tone === "error" ? "bg-[var(--red-9)]" : "bg-[var(--lime-9)]";
						return (
							<div key={step.id} className="flex min-w-0 items-start gap-2 text-[11px] leading-5 text-muted-foreground">
								<span className={cn("mt-2 size-1.5 shrink-0 rounded-full", dotClass, isLatest && step.tone === "active" ? "animate-pulse" : "")} />
								<span className={cn("min-w-0 flex-1 truncate", isLatest ? "text-[var(--slate-12)]" : "")} title={step.message}>
									{step.message}
								</span>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

function HarnessPicker({
	selected,
	developerMode,
	onSelect,
}: {
	selected: DesktopAgentHarness;
	developerMode: boolean;
	onSelect: (harness: DesktopAgentHarness) => void;
}): JSX.Element {
	const { t } = useI18n();
	return (
		<Field label={t("harness")}>
			<div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t("harness")}>
				{harnessOptions.map((option) => {
					const isSelected = selected === option.value;
					const isEnabled = option.enabled || (developerMode && option.developerOnly);
					return (
						<button
							key={option.value}
							type="button"
							role="radio"
							aria-checked={isSelected}
							disabled={!isEnabled}
							onClick={() => isEnabled && onSelect(option.value as DesktopAgentHarness)}
							className={cn(
								"pie-smooth-corner flex h-14 min-w-0 items-center justify-center rounded-2xl border px-2 text-center text-xs font-medium leading-tight transition-[background-color,border-color,box-shadow,color]",
								isSelected
									? "border-[var(--slate-8)] bg-[var(--slate-2)] text-foreground shadow-[0_0_0_3px_var(--slate-a4),inset_0_1px_0_rgba(255,255,255,0.65)]"
									: "border-transparent bg-[var(--slate-2)] text-foreground shadow-none",
								isEnabled ? "cursor-pointer hover:bg-[var(--slate-3)]" : "cursor-not-allowed text-muted-foreground opacity-60",
							)}
						>
							<span className="flex min-w-0 flex-col items-center gap-0.5">
								<span className="line-clamp-1 min-w-0">{option.label}</span>
							</span>
						</button>
					);
				})}
			</div>
		</Field>
	);
}

function ChannelPicker({
	selected,
	developerMode,
	onSelect,
}: {
	selected: DesktopChannelKind | undefined;
	developerMode: boolean;
	onSelect: (channel: DesktopChannelKind) => void;
}): JSX.Element {
	const { t } = useI18n();
	return (
		<Field label={t("imChannel")}>
			<div className="space-y-2">
				<div className="grid grid-cols-3 gap-2">
					{channelOptions.map((channel) => {
						const isSelected = selected === channel.value;
						const isEnabled = channel.enabled || (developerMode && channel.developerOnly);
						return (
							<button
								key={channel.value}
								type="button"
								disabled={!isEnabled}
								onClick={() => isEnabled && onSelect(channel.value as DesktopChannelKind)}
								className={cn(
									"pie-smooth-corner flex h-14 min-w-0 items-center justify-center rounded-2xl border px-2 text-center text-xs font-medium leading-tight transition-[background-color,border-color,box-shadow,color]",
									isSelected
										? "border-[var(--slate-8)] bg-[var(--slate-2)] text-foreground shadow-[0_0_0_3px_var(--slate-a4),inset_0_1px_0_rgba(255,255,255,0.65)]"
										: "border-transparent bg-[var(--slate-2)] text-foreground shadow-none",
									isEnabled ? "cursor-pointer hover:bg-[var(--slate-3)]" : "cursor-not-allowed text-muted-foreground opacity-60",
								)}
							>
								<span className="flex min-w-0 flex-col items-center gap-0.5">
									<span className="line-clamp-1 min-w-0">{"labelKey" in channel ? t(channel.labelKey) : channel.label}</span>
								</span>
							</button>
						);
					})}
				</div>
				<div className="px-1 text-[10px] leading-4 text-muted-foreground">
					{t("singleChannelHint")}
				</div>
			</div>
		</Field>
	);
}

function ManualChannelCredentials(props: {
	channels: DesktopChannelKind[];
	discordBotToken: string;
	discordApplicationId: string;
	discordGuildId: string;
	discordProfile: DesktopDiscordBotProfile | undefined;
	discordSyncStatus: string;
	isSyncingDiscord: boolean;
	dingtalkClientId: string;
	dingtalkClientSecret: string;
	setDiscordBotToken: (value: string) => void;
	setDiscordApplicationId: (value: string) => void;
	setDiscordGuildId: (value: string) => void;
	setDingTalkClientId: (value: string) => void;
	setDingTalkClientSecret: (value: string) => void;
	onSyncDiscordProfile: () => void;
}): JSX.Element {
	const { t } = useI18n();
	return (
		<div className="space-y-3">
			{props.channels.includes("discord") ? (
				<div className="space-y-3 rounded-2xl bg-white/70 p-3 ring-1 ring-foreground/5">
					<div className="flex items-center justify-between gap-3">
						<div className="text-sm font-semibold leading-snug text-foreground">Discord</div>
						<Button
							variant="secondary"
							size="xs"
							className="h-7 px-2.5 text-[11px]"
							disabled={props.isSyncingDiscord || !props.discordBotToken.trim()}
							onClick={props.onSyncDiscordProfile}
						>
							{props.isSyncingDiscord ? <Spinner size={14} color="currentColor" /> : null}
							{props.isSyncingDiscord ? t("fetching") : t("fetch")}
						</Button>
					</div>
					<Field label="Bot Token">
						<Input className={controlSurfaceClass} type="password" value={props.discordBotToken} onChange={(event) => props.setDiscordBotToken(event.target.value)} />
					</Field>
					<div className="grid grid-cols-2 gap-3">
						<Field label="Application ID">
							<Input className={controlSurfaceClass} value={props.discordApplicationId} onChange={(event) => props.setDiscordApplicationId(event.target.value)} />
						</Field>
						<Field label="Guild ID">
							<Input className={controlSurfaceClass} value={props.discordGuildId} onChange={(event) => props.setDiscordGuildId(event.target.value)} />
						</Field>
					</div>
					{props.discordProfile?.botName || props.discordSyncStatus ? (
						<div className="flex min-w-0 items-center gap-3 rounded-xl bg-[var(--slate-2)] px-3 py-2">
							{props.discordProfile?.avatarUrl ? (
								<img src={props.discordProfile.avatarUrl} alt="" className="size-9 rounded-full object-cover" draggable={false} />
							) : (
								<div className="size-9 rounded-full bg-[var(--slate-5)]" />
							)}
							<div className="min-w-0">
								<div className="truncate text-xs font-medium text-foreground">
									{props.discordProfile?.botName || "Discord Bot"}
								</div>
								<div className="truncate text-[11px] leading-4 text-muted-foreground">
									{props.discordSyncStatus || props.discordProfile?.applicationId}
								</div>
							</div>
						</div>
					) : null}
				</div>
			) : null}
			{props.channels.includes("dingtalk") ? (
				<div className="space-y-3 rounded-2xl bg-white/70 p-3 ring-1 ring-foreground/5">
					<div className="text-sm font-semibold leading-snug text-foreground">{t("dingtalk")}</div>
					<div className="text-xs leading-5 text-muted-foreground">{t("dingtalkDesc")}</div>
					<Field label="Client ID">
						<Input className={controlSurfaceClass} value={props.dingtalkClientId} onChange={(event) => props.setDingTalkClientId(event.target.value)} />
					</Field>
					<Field label="Client Secret">
						<Input className={controlSurfaceClass} type="password" value={props.dingtalkClientSecret} onChange={(event) => props.setDingTalkClientSecret(event.target.value)} />
					</Field>
				</div>
			) : null}
		</div>
	);
}

function FeishuSyncPreview({ feishu }: { feishu: DesktopFeishuAppCredentials | undefined }): JSX.Element {
	const { t } = useI18n();
	const avatarUrl = feishu?.avatarUrl?.trim() ?? "";
	const hasAvatar = Boolean(avatarUrl);
	const [avatarState, setAvatarState] = useState<"idle" | "loading" | "loaded" | "error">(hasAvatar ? "loading" : "idle");

	useEffect(() => {
		setAvatarState(hasAvatar ? "loading" : "idle");
	}, [hasAvatar, avatarUrl]);

	return (
		<div className="flex items-center gap-3 rounded-2xl bg-white/70 p-3 ring-1 ring-foreground/5">
			<div
				className={cn(
					"relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full ring-1 ring-foreground/10",
					hasAvatar && avatarState !== "error"
						? "bg-white"
						: "bg-[linear-gradient(45deg,rgba(15,23,42,0.08)_25%,transparent_25%,transparent_75%,rgba(15,23,42,0.08)_75%),linear-gradient(45deg,rgba(15,23,42,0.08)_25%,transparent_25%,transparent_75%,rgba(15,23,42,0.08)_75%)] bg-[length:12px_12px] bg-[position:0_0,6px_6px]",
				)}
			>
				{hasAvatar && avatarState !== "error" ? (
					<>
						{avatarState === "loading" && <span className="absolute inset-0 animate-pulse rounded-full bg-[var(--slate-4)]" />}
						<img
							src={avatarUrl}
							alt=""
							className={cn("h-full w-full object-cover transition-opacity duration-200", avatarState === "loaded" ? "opacity-100" : "opacity-0")}
							draggable={false}
							onLoad={() => setAvatarState("loaded")}
							onError={() => setAvatarState("error")}
						/>
					</>
				) : (
					<span className="h-5 w-5 rounded-full border border-dashed border-muted-foreground/60" />
				)}
			</div>
			<div className="min-w-0 text-left">
				<div className="truncate text-sm font-medium text-foreground">
					{feishu?.appName?.trim() || t("feishuNameMissing")}
				</div>
				<div className="mt-0.5 text-xs text-muted-foreground">
					{hasAvatar ? t("feishuAvatarLoaded") : t("feishuAvatarMissing")}
				</div>
			</div>
		</div>
	);
}

function CreationModeSwitch({
	value,
	onChange,
}: {
	value: AgentCreationMode;
	onChange: (value: AgentCreationMode) => void;
}): JSX.Element {
	const { t } = useI18n();
	return (
		<div className="grid grid-cols-2 gap-1 rounded-2xl bg-[var(--slate-3)] p-1">
			{([
				["create", t("createNewAgent")],
				["import", t("importMyAgent")],
			] as const).map(([mode, label]) => (
				<button
					key={mode}
					type="button"
					className={cn(
						"h-10 rounded-xl px-3 text-sm font-medium transition-[background-color,color,box-shadow,transform] active:scale-[0.96]",
						value === mode
							? "bg-white text-foreground shadow-none"
							: "text-muted-foreground hover:text-foreground",
					)}
					onClick={() => onChange(mode)}
				>
					{label}
				</button>
			))}
		</div>
	);
}

function ImportHarnessProfileList({
	profiles,
	selectedKey,
	isLoading,
	onRefresh,
	onSelect,
}: {
	profiles: ImportableHarnessProfile[];
	selectedKey: string;
	isLoading: boolean;
	onRefresh: () => void;
	onSelect: (profile: ImportableHarnessProfile) => void;
}): JSX.Element {
	const { t } = useI18n();
	return (
		<Field label={t("importExistingProfile")}>
			<div className="space-y-3">
				<div className="flex items-center justify-between gap-3">
					<div className="min-w-0 text-xs leading-5 text-muted-foreground text-pretty">
						{t("importExistingProfileDesc")}
					</div>
					<Button type="button" variant="secondary" onClick={onRefresh} disabled={isLoading}>
						{isLoading ? t("checking") : t("refresh")}
					</Button>
				</div>
				{isLoading ? (
					<div className="space-y-2">
						{Array.from({ length: 3 }).map((_, index) => (
							<div key={index} className="h-[68px] animate-pulse rounded-2xl bg-[var(--slate-3)]" />
						))}
					</div>
				) : profiles.length ? (
					<div className="space-y-2">
						{profiles.map((profile) => {
							const key = `${profile.harness}:${profile.id}`;
							const selected = key === selectedKey;
							return (
								<button
									key={key}
									type="button"
									className={cn(
										"flex min-h-[68px] w-full items-center gap-3 rounded-2xl px-3 text-left transition-[background-color,box-shadow,transform] active:scale-[0.96]",
										selected
											? "bg-[var(--slate-3)] shadow-none"
											: "bg-[var(--slate-2)] shadow-none hover:bg-[var(--slate-3)]",
									)}
									onClick={() => onSelect(profile)}
								>
									<AgentAvatar seed={key} size={42} label={profile.id} />
									<div className="min-w-0 flex-1">
										<div className="truncate text-sm font-medium text-foreground">{profile.label || profile.id}</div>
										<div className="mt-0.5 truncate text-xs text-muted-foreground">
											{profile.harness === "openclaw" ? "OpenClaw" : "Hermes"}
											{profile.model ? ` · ${profile.model}` : ""}
										</div>
									</div>
								</button>
							);
						})}
					</div>
				) : (
					<div className="rounded-2xl bg-[var(--slate-2)] px-3 py-4 text-center text-sm text-muted-foreground">
						{t("noImportableProfiles")}
					</div>
				)}
			</div>
		</Field>
	);
}

function readAvatarUpload(file: File): Promise<AgentAvatarUpload> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const dataUrl = typeof reader.result === "string" ? reader.result : "";
			if (!dataUrl.startsWith("data:image/")) {
				reject(new Error("请选择图片文件"));
				return;
			}
			resolve({ fileName: file.name, dataUrl });
		};
		reader.onerror = () => reject(new Error("读取图片失败"));
		reader.readAsDataURL(file);
	});
}

function DefaultAvatarUploader({
	name,
	seed,
	upload,
	fileInputRef,
	onUpload,
	onError,
}: {
	name: string;
	seed: string;
	upload: AgentAvatarUpload | undefined;
	fileInputRef: RefObject<HTMLInputElement | null>;
	onUpload: (upload: AgentAvatarUpload | undefined) => void;
	onError: (message: string) => void;
}): JSX.Element {
	const { t } = useI18n();
	const previewUrl = upload?.dataUrl;
	const handleFile = async (file: File | undefined) => {
		if (!file) {
			return;
		}
		try {
			onUpload(await readAvatarUpload(file));
		} catch (error) {
			onError(error instanceof Error ? error.message : String(error));
		}
	};
	return (
		<Field label={t("agentAvatar")}>
			<div className="flex items-center gap-4 rounded-2xl bg-white/70 p-3 ring-1 ring-foreground/5">
				<button
					type="button"
					className="group/avatar-upload relative rounded-full outline-none transition-transform active:scale-[0.96] focus-visible:ring-[3px] focus-visible:ring-ring/50"
					onClick={() => fileInputRef.current?.click()}
					aria-label={t("changeAvatar")}
				>
					<AgentAvatar seed={seed} src={previewUrl} size={64} label={name} />
					<span className="pointer-events-none absolute inset-0 grid place-items-center rounded-full bg-black/35 text-white opacity-0 transition-opacity group-hover/avatar-upload:opacity-100 group-focus-visible/avatar-upload:opacity-100">
						<AppIcon IconComponent={GalleryAddLineDuotone} className="size-6" />
					</span>
				</button>
				<div className="min-w-0 flex-1">
					<div className="text-sm font-medium text-foreground">{previewUrl ? t("customAvatarSelected") : t("defaultAvatarReady")}</div>
					<div className="mt-0.5 text-xs leading-5 text-muted-foreground text-pretty">{t("uploadAvatarHint")}</div>
					{previewUrl ? (
						<Button type="button" variant="secondary" size="small" className="mt-2" onClick={() => onUpload(undefined)}>
							{t("reset")}
						</Button>
					) : null}
				</div>
				<input
					ref={fileInputRef}
					type="file"
					accept="image/png,image/jpeg,image/webp"
					className="hidden"
					onChange={(event) => {
						void handleFile(event.currentTarget.files?.[0]);
						event.currentTarget.value = "";
					}}
				/>
			</div>
		</Field>
	);
}
