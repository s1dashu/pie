import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { RestartCircleBoldDuotone } from "solar-icon-set";
import type {
	AgentCreationSession,
	AgentDetails,
	AgentOnboardEvent,
	BotAvatarOption,
	DesktopFeishuAppCredentials,
	DesktopThinkingLevel,
} from "../../../shared/types";
import { AppIcon } from "../../components/shared/app-icon";
import { Field } from "../../components/shared/field";
import { AceternityTooltip } from "../../components/shared/tooltip";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../../components/ui/dialog";
import { cn } from "../../lib/utils";
import { brandOptions, thinkingLevelOptions } from "./agent-display";
import { ProviderSelect } from "./ProviderSelect";

export function CreateAgentDialog({
	open,
	onClose,
	onCreated,
	onError,
}: {
	open: boolean;
	onClose: () => void;
	onCreated: (agent: AgentDetails) => void;
	onError: (message: string) => void;
}): JSX.Element | null {
	const [session, setSession] = useState<AgentCreationSession | undefined>();
	const [step, setStep] = useState<"config" | "auth" | "model">("config");
	const [name, setName] = useState("");
	const [avatarId, setAvatarId] = useState("");
	const [manualMode, setManualMode] = useState(false);
	const [feishu, setFeishu] = useState<DesktopFeishuAppCredentials | undefined>();
	const [qrEvent, setQrEvent] = useState<AgentOnboardEvent | undefined>();
	const [status, setStatus] = useState("");
	const [provider, setProvider] = useState("kimi-coding");
	const [model, setModel] = useState("k2p6");
	const [thinkingLevel, setThinkingLevel] = useState<DesktopThinkingLevel>("off");
	const [apiKey, setApiKey] = useState("");
	const queryClient = useQueryClient();
	const botAvatars = useQuery({
		queryKey: ["bot-avatars"],
		queryFn: () => window.pie.listBotAvatars(),
		enabled: open,
	});
	const applyFeishuApp = (created: DesktopFeishuAppCredentials) => {
		setFeishu(created);
		if (created.appName?.trim()) {
			setName(created.appName.trim());
		}
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
			setStep("config");
		},
		onError: (err: Error) => onError(err.message),
	});
	const createFeishu = useMutation({
		mutationFn: (sessionId: string) => window.pie.createFeishuApp(sessionId),
		onSuccess: (created) => {
			applyFeishuApp(created);
			setStep("model");
		},
		onError: (err: Error) => onError(err.message),
	});
	const complete = useMutation({
		mutationFn: () => {
			if (!session || !feishu) {
				throw new Error("创建流程尚未完成");
			}
			return window.pie.completeAgentCreation({
				sessionId: session.sessionId,
				name,
				avatarId,
				feishu,
				provider,
				model,
				thinkingLevel,
				apiKey,
			});
		},
		onSuccess: async (agent) => {
			await queryClient.invalidateQueries({ queryKey: ["agents"] });
			onCreated(agent);
			onClose();
		},
		onError: (err: Error) => onError(err.message),
	});

	useEffect(() => {
		if (open) {
			begin.mutate();
		} else {
			setStep("config");
			setSession(undefined);
			setFeishu(undefined);
			setQrEvent(undefined);
			setStatus("");
			setManualMode(false);
			setAvatarId("");
		}
	}, [open]);

	useEffect(() => {
		if (!avatarId && botAvatars.data?.[0]) {
			setAvatarId(botAvatars.data[0].id);
		}
	}, [avatarId, botAvatars.data]);

	useEffect(() => {
		return window.pie.onAgentOnboardEvent((event) => {
			if (event.sessionId !== session?.sessionId) {
				return;
			}
			if (event.type === "qr") {
				setQrEvent(event);
			}
			if (event.message) {
				setStatus(event.message);
			}
			if (event.feishu) {
				applyFeishuApp(event.feishu);
			}
		});
	}, [session?.sessionId]);

	const modelsForProvider = session?.models.filter((item) => item.provider === provider) ?? [];
	const providers = session?.providers.length ? session.providers : [provider];
	const updateProviderSelection = (nextProvider: string) => {
		setProvider(nextProvider);
		setModel(session?.models.find((item) => item.provider === nextProvider)?.id ?? "");
	};

	return (
		<Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
			<DialogContent className="sm:max-w-md pie-smooth-corner">
				<DialogHeader>
					<DialogTitle>创建 Agent</DialogTitle>
					<DialogDescription>
						{step === "config" && "配置 Agent 基础信息和框架。"}
						{step === "auth" && "扫码授权，创建飞书/Lark 应用。"}
						{step === "model" && "配置模型供应商和 API Key。"}
					</DialogDescription>
				</DialogHeader>

				<div>
					{begin.isPending || !session ? (
						<div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
							<AppIcon IconComponent={RestartCircleBoldDuotone} className="mr-2 h-4 w-4 animate-spin" /> 正在初始化配置...
						</div>
					) : step === "config" ? (
						<div className="space-y-4 rounded-3xl bg-[var(--slate-2)] p-5">
							<Field label="Agent 名称">
								<Input value={name} onChange={(event) => setName(event.target.value)} />
							</Field>
							<AvatarPicker
								avatars={botAvatars.data ?? []}
								isLoading={botAvatars.isLoading}
								selectedId={avatarId}
								onSelect={setAvatarId}
							/>
							<Field label="Agent 框架">
								<Select defaultValue="pi">
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="pi">Pi</SelectItem>
										<SelectItem value="claude-code" disabled>Claude Code</SelectItem>
										<SelectItem value="codex" disabled>Codex</SelectItem>
										<SelectItem value="openclaw" disabled>Openclaw</SelectItem>
										<SelectItem value="hermes" disabled>Hermes</SelectItem>
									</SelectContent>
								</Select>
							</Field>
						</div>
					) : step === "auth" ? (
						<div className="space-y-4 text-center">
							<div className="text-sm font-normal text-foreground">
								{status || "请使用飞书或 Lark 扫码授权创建 bot"}
							</div>
							<div className="flex justify-center py-2">
								{qrEvent?.url ? (
									<div className="flex h-[196px] w-[196px] items-center justify-center rounded-2xl bg-white">
										<QRCodeSVG value={qrEvent.url} size={180} level="M" includeMargin={false} />
									</div>
								) : (
									<div className="h-[196px] w-[196px] animate-pulse rounded-2xl bg-muted" />
								)}
							</div>
						</div>
					) : (
						<div className="space-y-4 rounded-3xl bg-[var(--slate-2)] p-5">
							<FeishuSyncPreview feishu={feishu} />
							<div className="grid grid-cols-2 gap-4">
								<Field label="供应商">
									<ProviderSelect
										value={provider}
										providers={providers}
										onValueChange={updateProviderSelection}
									/>
								</Field>
								<Field label="模型">
									{modelsForProvider.length ? (
										<Select value={model} onValueChange={setModel}>
											<SelectTrigger>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{modelsForProvider.map((item) => <SelectItem key={item.id} value={item.id}>{item.name || item.id}</SelectItem>)}
											</SelectContent>
										</Select>
									) : (
										<Input value={model} onChange={(event) => setModel(event.target.value)} placeholder="model id" />
									)}
								</Field>
							</div>
							<Field label="API Key">
								<Input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="留空则使用已有环境变量或稍后补充" />
							</Field>
							<Field label="Thinking Level">
								<Select value={thinkingLevel} onValueChange={(value) => setThinkingLevel(value as DesktopThinkingLevel)}>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{thinkingLevelOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
									</SelectContent>
								</Select>
							</Field>
						</div>
					)}
				</div>

				<DialogFooter>
					{step === "config" && session && (
						<Button
							onClick={() => {
								setStep("auth");
								setStatus("");
								setQrEvent(undefined);
								createFeishu.mutate(session.sessionId);
							}}
						>
							下一步：扫码授权
						</Button>
					)}
					{step === "model" && (
						<Button
							disabled={complete.isPending}
							onClick={() => complete.mutate()}
						>
							完成创建
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function FeishuSyncPreview({ feishu }: { feishu: DesktopFeishuAppCredentials | undefined }): JSX.Element {
	const hasAvatar = Boolean(feishu?.avatarUrl?.trim());
	return (
		<div className="flex items-center gap-3 rounded-2xl bg-white/70 p-3 ring-1 ring-foreground/5">
			<div
				className={cn(
					"grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full ring-1 ring-foreground/10",
					hasAvatar
						? "bg-white"
						: "bg-[linear-gradient(45deg,rgba(15,23,42,0.08)_25%,transparent_25%,transparent_75%,rgba(15,23,42,0.08)_75%),linear-gradient(45deg,rgba(15,23,42,0.08)_25%,transparent_25%,transparent_75%,rgba(15,23,42,0.08)_75%)] bg-[length:12px_12px] bg-[position:0_0,6px_6px]",
				)}
			>
				{hasAvatar ? (
					<img src={feishu?.avatarUrl} alt="" className="h-full w-full object-cover" draggable={false} />
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
