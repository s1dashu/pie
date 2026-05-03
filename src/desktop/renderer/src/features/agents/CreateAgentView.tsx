import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { RestartCircleBoldDuotone } from "solar-icon-set";
import type {
	AgentCreationSession,
	AgentDetails,
	AgentOnboardEvent,
	AgentSummary,
	BotAvatarOption,
	DesktopAgentFramework,
	DesktopCodexDiagnostic,
	DesktopCodexWebSearchMode,
	DesktopChannelKind,
	DesktopFeishuAppCredentials,
	DesktopThinkingLevel,
	DesktopWechatCredentials,
} from "../../../shared/types";
import { AppIcon } from "../../components/shared/app-icon";
import { Field } from "../../components/shared/field";
import { AceternityTooltip } from "../../components/shared/tooltip";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Spinner } from "../../components/ui/spinner-1";
import { cn } from "../../lib/utils";
import { thinkingLevelOptions } from "./agent-display";
import { ProviderSelect } from "./ProviderSelect";

const channelOptions = [
	{ value: "feishu", label: "飞书", enabled: true },
	{ value: "wechat", label: "微信", enabled: true },
	{ value: "telegram", label: "Telegram", enabled: true },
	{ value: "discord", label: "Discord", enabled: true },
	{ value: "slack", label: "Slack", enabled: true },
] as const;

const manualChannelKinds: DesktopChannelKind[] = ["discord", "telegram", "slack"];
const controlSurfaceClass = "border-transparent bg-[var(--slate-2)] hover:border-transparent focus-visible:border-transparent";
type CreateAgentStep = "config" | "identity" | "auth" | "credentials" | "model";

const frameworkOptions: Array<{ value: DesktopAgentFramework; label: string; enabled: boolean }> = [
	{ value: "pi", label: "Pi", enabled: true },
	{ value: "codex", label: "Codex", enabled: true },
	{ value: "ousia", label: "Ousia", enabled: true },
];

const codexWebSearchOptions: Array<{ value: DesktopCodexWebSearchMode; label: string }> = [
	{ value: "cached", label: "Cached" },
	{ value: "disabled", label: "Disabled" },
	{ value: "live", label: "Live" },
];

export function CreateAgentView({
	onCancel,
	onCreated,
	onError,
}: {
	onCancel: () => void;
	onCreated: (agent: AgentDetails) => void;
	onError: (message: string) => void;
}): JSX.Element {
	const [session, setSession] = useState<AgentCreationSession | undefined>();
	const [step, setStep] = useState<CreateAgentStep>("config");
	const [stepHistory, setStepHistory] = useState<CreateAgentStep[]>([]);
	const [name, setName] = useState("");
	const [avatarId, setAvatarId] = useState("");
	const [feishu, setFeishu] = useState<DesktopFeishuAppCredentials | undefined>();
	const [wechat, setWechat] = useState<DesktopWechatCredentials | undefined>();
	const [channels, setChannels] = useState<DesktopChannelKind[]>(["feishu"]);
	const [slackBotToken, setSlackBotToken] = useState("");
	const [slackAppToken, setSlackAppToken] = useState("");
	const [slackSigningSecret, setSlackSigningSecret] = useState("");
	const [slackTeamId, setSlackTeamId] = useState("");
	const [slackAppId, setSlackAppId] = useState("");
	const [slackBotUserId, setSlackBotUserId] = useState("");
	const [discordBotToken, setDiscordBotToken] = useState("");
	const [discordApplicationId, setDiscordApplicationId] = useState("");
	const [discordGuildId, setDiscordGuildId] = useState("");
	const [telegramBotToken, setTelegramBotToken] = useState("");
	const [telegramBotUsername, setTelegramBotUsername] = useState("");
	const [qrEvent, setQrEvent] = useState<AgentOnboardEvent | undefined>();
	const [qrExpiresAt, setQrExpiresAt] = useState<number | undefined>();
	const [qrExpired, setQrExpired] = useState(false);
	const [status, setStatus] = useState("");
	const [codexLoginStatus, setCodexLoginStatus] = useState("");
	const [codexLoginUrl, setCodexLoginUrl] = useState("");
	const [framework, setFramework] = useState<DesktopAgentFramework>("pi");
	const [provider, setProvider] = useState("kimi-coding");
	const [model, setModel] = useState("k2p6");
	const [thinkingLevel, setThinkingLevel] = useState<DesktopThinkingLevel>("off");
	const [codexWebSearchMode, setCodexWebSearchMode] = useState<DesktopCodexWebSearchMode>("cached");
	const [apiKey, setApiKey] = useState("");
	const credentialRequestRef = useRef(0);
	const queryClient = useQueryClient();
	const botAvatars = useQuery({
		queryKey: ["bot-avatars"],
		queryFn: () => window.pie.listBotAvatars(),
		enabled: channels.includes("wechat"),
	});
	const codexDiagnostic = useQuery({
		queryKey: ["codex-diagnostic"],
		queryFn: () => window.pie.checkCodexEnvironment(),
		enabled: framework === "codex",
		refetchOnWindowFocus: false,
		retry: false,
	});
	const applyFeishuApp = (created: DesktopFeishuAppCredentials) => {
		setFeishu(created);
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
			const defaultProvider = created.providers.includes("kimi-coding") ? "kimi-coding" : created.providers[0] ?? "kimi-coding";
			const defaultModel = defaultProvider === "kimi-coding"
				? "k2p6"
				: created.models.find((item) => item.provider === defaultProvider)?.id ?? "";
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
				throw new Error("创建流程尚未初始化");
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
				setStatus("二维码已失效，请刷新二维码");
				return;
			}
			onError(err.message);
		},
	});
	const complete = useMutation({
		mutationFn: () => {
			if (!session) {
				throw new Error("创建流程尚未完成");
			}
			if (!channels.length) {
				throw new Error("请至少选择一个 IM 渠道");
			}
			if (channels.includes("feishu") && !feishu) {
				throw new Error("飞书渠道尚未完成授权");
			}
			if (channels.includes("wechat") && !wechat) {
				throw new Error("微信渠道尚未完成授权");
			}
			if (channels.includes("slack") && (!slackBotToken.trim() || !slackAppToken.trim())) {
				throw new Error("Slack Bot Token 和 App Token 必填");
			}
			if (channels.includes("discord") && !discordBotToken.trim()) {
				throw new Error("Discord Bot Token 必填");
			}
			if (channels.includes("telegram") && !telegramBotToken.trim()) {
				throw new Error("Telegram Bot Token 必填");
			}
			return window.pie.completeAgentCreation({
				sessionId: session.sessionId,
				framework,
				name,
				avatarId: channels.includes("wechat") ? avatarId : undefined,
				channels,
				...(feishu ? { feishu } : {}),
				...(wechat ? { wechat } : {}),
				...(channels.includes("slack")
					? {
							slack: {
								botToken: slackBotToken,
								appToken: slackAppToken,
								signingSecret: slackSigningSecret,
								teamId: slackTeamId,
								appId: slackAppId,
								botUserId: slackBotUserId,
							},
						}
					: {}),
				...(channels.includes("discord")
					? { discord: { botToken: discordBotToken, applicationId: discordApplicationId, guildId: discordGuildId } }
					: {}),
				...(channels.includes("telegram")
					? { telegram: { botToken: telegramBotToken, botUsername: telegramBotUsername } }
					: {}),
				provider,
				model,
				thinkingLevel,
				apiKey,
				codexSandboxMode: "danger-full-access",
				codexWebSearchMode,
			});
		},
		onMutate: async () => {
			if (!session) {
				return;
			}
			const optimisticAgent = createOptimisticStartingAgent({
				session,
				name,
				framework,
				channels,
				feishu,
				wechat,
				provider,
				model,
				thinkingLevel,
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
				throw new Error("创建流程尚未初始化");
			}
			setCodexLoginStatus("正在打开 Codex 登录...");
			return window.pie.openCodexLogin(session.sessionId);
		},
		onSuccess: async () => {
			await codexDiagnostic.refetch();
			setCodexLoginStatus("Codex 登录状态已更新");
		},
		onError: (err: Error) => onError(err.message),
	});

	useEffect(() => {
		begin.mutate();
	}, []);

	useEffect(() => {
		if (channels.includes("wechat") && !avatarId && botAvatars.data?.[0]) {
			setAvatarId(botAvatars.data[0].id);
		}
	}, [avatarId, botAvatars.data, channels]);

	useEffect(() => {
		return window.pie.onAgentOnboardEvent((event) => {
			if (event.sessionId !== session?.sessionId) {
				return;
			}
			if (event.source === "codex-login") {
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
		});
	}, [queryClient, session?.sessionId]);

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

	const modelsForProvider = session?.models.filter((item) => item.provider === provider) ?? [];
	const providers = session?.providers.length ? session.providers : [provider];
	const usesCodexCli = framework === "codex";
	const codexModels = session?.codexModels ?? [];
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
		setModel(session?.models.find((item) => item.provider === nextProvider)?.id ?? "");
		void prefillProviderApiKey(nextProvider, session?.profileId, true);
	};
	const updateFrameworkSelection = (nextFramework: DesktopAgentFramework) => {
		setFramework(nextFramework);
		if (nextFramework === "codex") {
			const defaultCodexModel = session?.codexModels[0];
			setProvider("codex-cli");
			setModel(defaultCodexModel?.id ?? "gpt-5.5");
			setThinkingLevel(defaultCodexModel?.defaultThinkingLevel ?? defaultCodexModel?.supportedThinkingLevels[0] ?? "medium");
			setApiKey("");
			return;
		}
		if (provider === "codex-cli") {
			const defaultProvider = session?.providers.includes("kimi-coding") ? "kimi-coding" : session?.providers[0] ?? "kimi-coding";
			setProvider(defaultProvider);
			setModel(defaultProvider === "kimi-coding"
				? "k2p6"
				: session?.models.find((item) => item.provider === defaultProvider)?.id ?? "");
			void prefillProviderApiKey(defaultProvider, session?.profileId, true);
		}
	};
	const selectChannel = (channel: DesktopChannelKind) => {
		setChannels([channel]);
	};
	const requiresQrAuth = channels.includes("feishu") || channels.includes("wechat");
	const requiresIdentity = channels.includes("wechat") && !channels.some((channel) => channel === "feishu");
	const requiresManualCredentials = channels.some((channel) => manualChannelKinds.includes(channel));
	const authPrompt = channels.includes("wechat")
		? "请使用微信扫码连接 bot"
		: "请使用飞书或 Lark 扫码授权创建 bot";
	const visibleSteps = createAgentStepFlow({
		requiresIdentity,
		requiresQrAuth,
		requiresManualCredentials,
	});
	const stepDescription = {
		config: "选择框架和 IM 渠道",
		identity: "设置微信里的名称和头像",
		auth: "授权已选择的 IM 渠道",
		credentials: "填写渠道连接凭证",
		model: "配置模型和 API Key",
	}[step];
	const stepTitle = {
		config: "选择 Agent 类型",
		identity: "设置 Agent 信息",
		auth: "扫码授权",
		credentials: "连接渠道",
		model: "选择模型",
	}[step];
	const handleNext = () => {
		if (step === "config") {
			setStatus("");
			setQrEvent(undefined);
			setQrExpiresAt(undefined);
			setQrExpired(false);
			if (requiresIdentity) {
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
			goToStep("auth");
			authenticateChannels.mutate();
			return;
		}
		if (step === "credentials") {
			goToStep("model");
			return;
		}
		complete.mutate();
	};
	const nextDisabled = begin.isPending
		|| !session
		|| (step === "config" && !channels.length)
		|| (step === "identity" && (!name.trim() || botAvatars.isLoading))
		|| (step === "model" && complete.isPending);
	const currentStepIndex = visibleSteps.indexOf(step);

	return (
		<div className="flex h-full flex-col overflow-hidden bg-white">
			<header className="drag-region flex h-[72px] shrink-0 items-center justify-between gap-4 px-7 pt-3">
				<div className="min-w-0">
					<h1 className="text-xl font-semibold tracking-normal text-balance">创建 Agent</h1>
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
					<AceternityTooltip content="关闭创建" side="bottom">
						<Button
							variant="unstyled"
							size="inline"
							className="no-drag inline-flex h-8 w-8 shrink-0 items-center justify-center text-[var(--slate-10)] transition hover:text-[var(--slate-12)]"
							onClick={onCancel}
							aria-label="关闭创建 Agent"
						>
							<HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-5" />
						</Button>
					</AceternityTooltip>
				</div>
			</header>

			<div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
				<div className="flex min-h-full items-center justify-center">
					<div className="w-full max-w-md">
						{begin.isPending || !session ? (
							<div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
								<AppIcon IconComponent={RestartCircleBoldDuotone} className="mr-2 h-4 w-4 animate-spin" /> 正在初始化配置...
							</div>
						) : (
							<div className="space-y-6">
								<h2 className="text-center text-lg font-semibold tracking-normal text-foreground">{stepTitle}</h2>
								{step === "config" ? (
									<div className="space-y-6">
										<FrameworkPicker selected={framework} onSelect={updateFrameworkSelection} />
										<ChannelPicker selected={channels[0]} onSelect={selectChannel} />
									</div>
								) : step === "identity" ? (
									<div className="space-y-6">
										<Field label="Agent 名称">
											<Input className={controlSurfaceClass} value={name} onChange={(event) => setName(event.target.value)} />
										</Field>
										<AvatarPicker
											avatars={botAvatars.data ?? []}
											isLoading={botAvatars.isLoading}
											selectedId={avatarId}
											onSelect={setAvatarId}
										/>
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
														<div className="text-xs font-medium text-foreground">二维码已失效</div>
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
															刷新二维码
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
											slackBotToken={slackBotToken}
											slackAppToken={slackAppToken}
											slackSigningSecret={slackSigningSecret}
											slackTeamId={slackTeamId}
											slackAppId={slackAppId}
											slackBotUserId={slackBotUserId}
											discordBotToken={discordBotToken}
											discordApplicationId={discordApplicationId}
											discordGuildId={discordGuildId}
											telegramBotToken={telegramBotToken}
											telegramBotUsername={telegramBotUsername}
											setSlackBotToken={setSlackBotToken}
											setSlackAppToken={setSlackAppToken}
											setSlackSigningSecret={setSlackSigningSecret}
											setSlackTeamId={setSlackTeamId}
											setSlackAppId={setSlackAppId}
											setSlackBotUserId={setSlackBotUserId}
											setDiscordBotToken={setDiscordBotToken}
											setDiscordApplicationId={setDiscordApplicationId}
											setDiscordGuildId={setDiscordGuildId}
											setTelegramBotToken={setTelegramBotToken}
											setTelegramBotUsername={setTelegramBotUsername}
										/>
									</div>
								) : (
									<div className="space-y-6">
										{channels.includes("feishu") && <FeishuSyncPreview feishu={feishu} />}
										<div className={cn("grid gap-4", usesCodexCli ? "grid-cols-1" : "grid-cols-2")}>
											{!usesCodexCli && (
												<Field label="供应商">
													<ProviderSelect
														value={provider}
														providers={providers}
														triggerClassName={controlSurfaceClass}
														onValueChange={updateProviderSelection}
													/>
												</Field>
											)}
											<Field label="模型">
												{usesCodexCli && codexModels.length ? (
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
												<Field label="API Key">
													<Input className={controlSurfaceClass} type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="留空则使用已有环境变量或稍后补充" />
												</Field>
												<Field label="Thinking Level">
													<Select value={thinkingLevel} onValueChange={(value) => setThinkingLevel(value as DesktopThinkingLevel)}>
														<SelectTrigger className={controlSurfaceClass}>
															<SelectValue />
														</SelectTrigger>
														<SelectContent>
															{thinkingLevelOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
														</SelectContent>
													</Select>
												</Field>
												<div className="grid grid-cols-2 gap-4">
													<Field label="Access Mode">
														<div className={cn("flex h-9 items-center rounded-md px-3 text-sm font-medium text-foreground", controlSurfaceClass)}>
															Full Access
														</div>
													</Field>
													<Field label="Web Search">
														<Select value={codexWebSearchMode} onValueChange={(value) => setCodexWebSearchMode(value as DesktopCodexWebSearchMode)}>
															<SelectTrigger className={controlSurfaceClass}>
																<SelectValue />
															</SelectTrigger>
															<SelectContent>
																{codexWebSearchOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
															</SelectContent>
														</Select>
													</Field>
												</div>
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
													onOpenLogin={() => openCodexLogin.mutate()}
													onRefresh={() => void codexDiagnostic.refetch()}
												/>
												<Field label="Thinking Level">
													<Select value={thinkingLevel} onValueChange={(value) => setThinkingLevel(value as DesktopThinkingLevel)}>
														<SelectTrigger className={controlSurfaceClass}>
															<SelectValue />
														</SelectTrigger>
														<SelectContent>
															{codexThinkingOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
														</SelectContent>
													</Select>
												</Field>
											</>
										)}
									</div>
								)}
							</div>
						)}
					</div>
				</div>
			</div>

			<footer className={cn("no-drag flex shrink-0 items-center border-t border-foreground/5 px-8 py-5", step === "config" ? "justify-end" : "justify-between")}>
				{step !== "config" && (
					<Button variant="secondary" onClick={goBack} disabled={complete.isPending}>
						上一步
					</Button>
				)}
				<div className="flex items-center gap-3">
					{step !== "auth" && (
						<Button disabled={nextDisabled} onClick={handleNext}>
							{complete.isPending ? (
								<>
									<Spinner size={18} color="currentColor" />
									正在创建
								</>
							) : step === "model" ? (
								"完成创建"
							) : (
								"下一步"
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
	requiresQrAuth,
	requiresManualCredentials,
}: {
	requiresIdentity: boolean;
	requiresQrAuth: boolean;
	requiresManualCredentials: boolean;
}): CreateAgentStep[] {
	return [
		"config",
		...(requiresIdentity ? ["identity" as const] : []),
		...(requiresQrAuth ? ["auth" as const] : []),
		...(requiresManualCredentials ? ["credentials" as const] : []),
		"model",
	];
}

function createOptimisticStartingAgent({
	session,
	name,
	framework,
	channels,
	feishu,
	wechat,
	provider,
	model,
	thinkingLevel,
}: {
	session: AgentCreationSession;
	name: string;
	framework: DesktopAgentFramework;
	channels: DesktopChannelKind[];
	feishu: DesktopFeishuAppCredentials | undefined;
	wechat: DesktopWechatCredentials | undefined;
	provider: string;
	model: string;
	thinkingLevel: DesktopThinkingLevel;
}): AgentDetails {
	const now = new Date().toISOString();
	const displayName = feishu?.appName?.trim() || name.trim() || session.name;
	return {
		id: session.sessionId,
		name: displayName,
		status: "starting",
		avatarSeed: session.sessionId,
		...(feishu?.avatarUrl ? { avatarUrl: feishu.avatarUrl } : {}),
		desiredState: "running",
		selected: true,
		home: session.home,
		createdAt: now,
		updatedAt: now,
		frameworkKind: framework,
		channelKinds: channels,
		modelLabel: model,
		...(feishu ? { appId: feishu.appId, brand: feishu.brand, appSecret: feishu.appSecret } : {}),
		...(wechat ? { wechat } : {}),
		model: {
			provider,
			model,
			thinkingLevel,
			outputToolCallsToIm: true,
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
	onOpenLogin,
	onRefresh,
}: {
	diagnostic: DesktopCodexDiagnostic | undefined;
	isLoading: boolean;
	error?: string;
	loginStatus?: string;
	loginUrl?: string;
	isOpeningLogin: boolean;
	onOpenLogin: () => void;
	onRefresh: () => void;
}): JSX.Element {
	const status = error
		? { label: "诊断失败", tone: "text-[var(--red-11)]", detail: error }
		: !diagnostic
		? { label: isLoading ? "正在检测 Codex CLI" : "尚未检测", tone: "text-muted-foreground", detail: "需要已安装并登录 Codex CLI" }
		: !diagnostic.installed
			? { label: "未检测到 Codex CLI", tone: "text-[var(--red-11)]", detail: diagnostic.error || "请先安装 Codex CLI" }
			: diagnostic.authenticated
				? { label: "Codex CLI 已就绪", tone: "text-[var(--lime-11)]", detail: diagnostic.version || "已检测到 Codex 登录态" }
				: { label: "Codex CLI 未登录", tone: "text-[var(--amber-11)]", detail: diagnostic.error || "需要先登录 Codex" };

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
							打开登录链接
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
						{isLoading ? "检测中" : "重新检测"}
					</Button>
					{!diagnostic?.authenticated && (
						<Button onClick={onOpenLogin} disabled={isOpeningLogin}>
							{isOpeningLogin ? "打开中" : "前往登录"}
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}

function FrameworkPicker({
	selected,
	onSelect,
}: {
	selected: DesktopAgentFramework;
	onSelect: (framework: DesktopAgentFramework) => void;
}): JSX.Element {
	return (
		<Field label="框架">
			<div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="框架">
				{frameworkOptions.map((option) => {
					const isSelected = selected === option.value;
					return (
						<button
							key={option.value}
							type="button"
							role="radio"
							aria-checked={isSelected}
							disabled={!option.enabled}
							onClick={() => option.enabled && onSelect(option.value as DesktopAgentFramework)}
							className={cn(
								"pie-smooth-corner flex h-14 min-w-0 items-center justify-center rounded-2xl border px-2 text-center text-xs font-medium leading-tight transition-[background-color,border-color,box-shadow,color]",
								isSelected
									? "border-[var(--slate-8)] bg-[var(--slate-3)] text-foreground shadow-[0_0_0_3px_var(--slate-a4),inset_0_1px_0_rgba(255,255,255,0.65)]"
									: "border-transparent bg-[var(--slate-2)] text-foreground shadow-none",
								option.enabled ? "cursor-pointer hover:bg-[var(--slate-3)]" : "cursor-not-allowed text-muted-foreground opacity-60",
							)}
						>
							<span className="line-clamp-2 min-w-0">{option.label}</span>
							{!option.enabled && <span className="shrink-0 text-[11px] text-muted-foreground">开发中</span>}
						</button>
					);
				})}
			</div>
		</Field>
	);
}

function ChannelPicker({
	selected,
	onSelect,
}: {
	selected: DesktopChannelKind | undefined;
	onSelect: (channel: DesktopChannelKind) => void;
}): JSX.Element {
	return (
		<Field label="IM 渠道">
			<div className="space-y-2">
				<div className="grid grid-cols-3 gap-2">
					{channelOptions.map((channel) => {
						const isSelected = selected === channel.value;
						return (
							<button
								key={channel.value}
								type="button"
								disabled={!channel.enabled}
								onClick={() => channel.enabled && onSelect(channel.value as DesktopChannelKind)}
								className={cn(
									"pie-smooth-corner flex h-14 min-w-0 items-center justify-center rounded-2xl border px-2 text-center text-xs font-medium leading-tight transition-[background-color,border-color,box-shadow,color]",
									isSelected
										? "border-[var(--slate-8)] bg-[var(--slate-3)] text-foreground shadow-[0_0_0_3px_var(--slate-a4),inset_0_1px_0_rgba(255,255,255,0.65)]"
										: "border-transparent bg-[var(--slate-2)] text-foreground shadow-none",
									channel.enabled ? "cursor-pointer hover:bg-[var(--slate-3)]" : "cursor-not-allowed text-muted-foreground opacity-60",
								)}
							>
								<span className="line-clamp-2 min-w-0">{channel.label}</span>
								{!channel.enabled && <span className="shrink-0 text-[11px] text-muted-foreground">开发中</span>}
							</button>
						);
					})}
				</div>
				<div className="px-1 text-[10px] leading-4 text-muted-foreground">
					单 Agent 暂时只支持配置一个渠道，多渠道支持中
				</div>
			</div>
		</Field>
	);
}

function ManualChannelCredentials(props: {
	channels: DesktopChannelKind[];
	slackBotToken: string;
	slackAppToken: string;
	slackSigningSecret: string;
	slackTeamId: string;
	slackAppId: string;
	slackBotUserId: string;
	discordBotToken: string;
	discordApplicationId: string;
	discordGuildId: string;
	telegramBotToken: string;
	telegramBotUsername: string;
	setSlackBotToken: (value: string) => void;
	setSlackAppToken: (value: string) => void;
	setSlackSigningSecret: (value: string) => void;
	setSlackTeamId: (value: string) => void;
	setSlackAppId: (value: string) => void;
	setSlackBotUserId: (value: string) => void;
	setDiscordBotToken: (value: string) => void;
	setDiscordApplicationId: (value: string) => void;
	setDiscordGuildId: (value: string) => void;
	setTelegramBotToken: (value: string) => void;
	setTelegramBotUsername: (value: string) => void;
}): JSX.Element {
	return (
		<div className="space-y-3">
			{props.channels.includes("slack") ? (
				<div className="space-y-3 rounded-2xl bg-white/70 p-3 ring-1 ring-foreground/5">
					<div className="text-sm font-semibold leading-snug text-foreground">Slack</div>
					<Field label="Bot Token">
						<Input className={controlSurfaceClass} type="password" value={props.slackBotToken} onChange={(event) => props.setSlackBotToken(event.target.value)} placeholder="xoxb-..." />
					</Field>
					<Field label="App Token">
						<Input className={controlSurfaceClass} type="password" value={props.slackAppToken} onChange={(event) => props.setSlackAppToken(event.target.value)} placeholder="xapp-..." />
					</Field>
					<div className="grid grid-cols-2 gap-3">
						<Field label="Team ID">
							<Input className={controlSurfaceClass} value={props.slackTeamId} onChange={(event) => props.setSlackTeamId(event.target.value)} />
						</Field>
						<Field label="Bot User ID">
							<Input className={controlSurfaceClass} value={props.slackBotUserId} onChange={(event) => props.setSlackBotUserId(event.target.value)} />
						</Field>
					</div>
					<Field label="Signing Secret">
						<Input className={controlSurfaceClass} type="password" value={props.slackSigningSecret} onChange={(event) => props.setSlackSigningSecret(event.target.value)} />
					</Field>
				</div>
			) : null}
			{props.channels.includes("discord") ? (
				<div className="space-y-3 rounded-2xl bg-white/70 p-3 ring-1 ring-foreground/5">
					<div className="text-sm font-semibold leading-snug text-foreground">Discord</div>
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
				</div>
			) : null}
			{props.channels.includes("telegram") ? (
				<div className="space-y-3 rounded-2xl bg-white/70 p-3 ring-1 ring-foreground/5">
					<div className="text-sm font-semibold leading-snug text-foreground">Telegram</div>
					<Field label="Bot Token">
						<Input className={controlSurfaceClass} type="password" value={props.telegramBotToken} onChange={(event) => props.setTelegramBotToken(event.target.value)} />
					</Field>
					<Field label="Bot Username">
						<Input className={controlSurfaceClass} value={props.telegramBotUsername} onChange={(event) => props.setTelegramBotUsername(event.target.value)} placeholder="@your_bot" />
					</Field>
				</div>
			) : null}
		</div>
	);
}

function FeishuSyncPreview({ feishu }: { feishu: DesktopFeishuAppCredentials | undefined }): JSX.Element {
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
					{feishu?.appName?.trim() || "未读取到开放平台应用名称"}
				</div>
				<div className="mt-0.5 text-xs text-muted-foreground">
					{hasAvatar ? "已读取开放平台头像" : "未读取到开放平台头像，创建后不会使用本地头像兜底"}
				</div>
			</div>
		</div>
	);
}

function AvatarPicker({
	avatars,
	isLoading,
	selectedId,
	onSelect,
}: {
	avatars: BotAvatarOption[];
	isLoading: boolean;
	selectedId: string;
	onSelect: (id: string) => void;
}): JSX.Element | null {
	if (isLoading) {
		return (
			<Field label="Agent 头像">
				<div className="grid grid-cols-8 gap-2">
					{Array.from({ length: 8 }).map((_, index) => (
						<div key={index} className="aspect-square animate-pulse rounded-full bg-muted" />
					))}
				</div>
			</Field>
		);
	}
	if (!avatars.length) {
		return null;
	}
	return (
		<Field label="Agent 头像">
			<div className="grid grid-cols-8 gap-2">
				{avatars.map((avatar) => {
					const selected = avatar.id === selectedId;
					return (
						<div
							key={avatar.id}
							className={cn(
								"group/avatar relative aspect-square rounded-full ring-2 ring-offset-2 ring-offset-[var(--slate-2)] transition-[transform]",
								selected ? "ring-[var(--lime-8)]" : "ring-transparent",
							)}
						>
							<AceternityTooltip content={avatar.label} className="block h-full w-full">
								<button
									type="button"
									className="block h-full w-full overflow-hidden rounded-full transition-[opacity,transform] active:scale-[0.96]"
									onClick={() => onSelect(avatar.id)}
									aria-label={avatar.label}
								>
									<img src={avatar.dataUrl} alt={avatar.label} className="h-full w-full object-cover" draggable={false} />
								</button>
							</AceternityTooltip>
						</div>
					);
				})}
			</div>
		</Field>
	);
}
