import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { RestartCircleBoldDuotone } from "solar-icon-set";
import type {
	AgentCreationSession,
	AgentDetails,
	AgentOnboardEvent,
	DesktopFeishuAppCredentials,
	DesktopThinkingLevel,
} from "../../../shared/types";
import { AppIcon } from "../../components/shared/app-icon";
import { Field } from "../../components/shared/field";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../../components/ui/dialog";
import { cn } from "../../lib/utils";
import { brandOptions, thinkingLevelOptions } from "./agent-display";

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
	const [manualMode, setManualMode] = useState(false);
	const [feishu, setFeishu] = useState<DesktopFeishuAppCredentials | undefined>();
	const [qrEvent, setQrEvent] = useState<AgentOnboardEvent | undefined>();
	const [status, setStatus] = useState("");
	const [provider, setProvider] = useState("kimi-coding");
	const [model, setModel] = useState("k2p6");
	const [thinkingLevel, setThinkingLevel] = useState<DesktopThinkingLevel>("off");
	const [apiKey, setApiKey] = useState("");
	const queryClient = useQueryClient();

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
			setFeishu(created);
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
		}
	}, [open]);

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
				setFeishu(event.feishu);
			}
		});
	}, [session?.sessionId]);

	const modelsForProvider = session?.models.filter((item) => item.provider === provider) ?? [];
	const providers = session?.providers.length ? session.providers : [provider];

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

				<div className="py-4">
					{begin.isPending || !session ? (
						<div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
							<AppIcon IconComponent={RestartCircleBoldDuotone} className="mr-2 h-4 w-4 animate-spin" /> 正在初始化配置...
						</div>
					) : step === "config" ? (
						<div className="space-y-4">
							<Field label="Agent 名称">
								<Input value={name} onChange={(event) => setName(event.target.value)} />
							</Field>
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
							<div className="rounded-2xl bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
								配置将保存在本地 <code className="rounded bg-background px-1 py-0.5 font-mono text-[10px]">{session.home}</code>
							</div>
						</div>
					) : step === "auth" ? (
						<div className="space-y-5 text-left">
							<div className="text-sm font-medium text-foreground">
								{status || "请选择以下任意一种方式完成授权："}
							</div>
							
							<div className="space-y-5">
								{/* 1. 扫码 */}
								<div className="flex gap-3">
									<div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--slate-2)] text-xs font-medium text-foreground ring-1 ring-border">1</div>
									<div className="space-y-3">
										<div className="text-sm font-medium text-foreground">使用飞书或 Lark 扫码</div>
										<div className="flex">
											{qrEvent?.url ? (
												<div className="rounded-2xl bg-white p-2 ring-1 ring-border">
													<QRCodeSVG value={qrEvent.url} size={120} level="M" includeMargin={false} />
												</div>
											) : (
												<div className="flex h-[136px] w-[136px] items-center justify-center rounded-2xl bg-muted text-sm text-muted-foreground ring-1 ring-border">
													<AppIcon IconComponent={RestartCircleBoldDuotone} className="mr-2 h-4 w-4 animate-spin" /> 等待...
												</div>
											)}
										</div>
									</div>
								</div>

								{/* 2. 链接 */}
								<div className="flex gap-3">
									<div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--slate-2)] text-xs font-medium text-foreground ring-1 ring-border">2</div>
									<div className="space-y-1">
										<div className="text-sm font-medium text-foreground">点击链接授权</div>
										<div className="text-sm text-muted-foreground">
											{qrEvent?.url ? (
												<>点击<a href={qrEvent.url} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">此链接</a>进行授权</>
											) : (
												"等待链接生成..."
											)}
										</div>
									</div>
								</div>

								{/* 3. 手动 */}
								<div className="flex gap-3">
									<div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--slate-2)] text-xs font-medium text-foreground ring-1 ring-border">3</div>
									<div className="w-full space-y-2">
										<div className="text-sm font-medium text-foreground">手动填写飞书应用 AppID 和 App Secret</div>
										{!manualMode ? (
											<Button variant="outline" size="sm" onClick={() => setManualMode(true)}>
												展开填写表单
											</Button>
										) : (
											<div className="grid grid-cols-2 gap-3 rounded-2xl bg-muted p-3">
												<Input placeholder="App ID" onChange={(event) => setFeishu((old) => ({ appId: event.target.value, appSecret: old?.appSecret ?? "", brand: old?.brand ?? "feishu" }))} />
												<Input placeholder="App Secret" type="password" onChange={(event) => setFeishu((old) => ({ appId: old?.appId ?? "", appSecret: event.target.value, brand: old?.brand ?? "feishu" }))} />
												<Select
													value={feishu?.brand ?? "feishu"}
													onValueChange={(value) => setFeishu((old) => ({ appId: old?.appId ?? "", appSecret: old?.appSecret ?? "", brand: value as "feishu" | "lark" }))}
												>
													<SelectTrigger>
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														{brandOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
													</SelectContent>
												</Select>
												<Button onClick={() => feishu?.appId && feishu.appSecret ? setStep("model") : onError("请填写 App ID 和 App Secret")}>
													继续
												</Button>
											</div>
										)}
									</div>
								</div>
							</div>
						</div>
					) : (
						<div className="space-y-4">
							<div className="grid grid-cols-2 gap-4">
								<Field label="供应商">
									<Select
										value={provider}
										onValueChange={(nextProvider) => {
											setProvider(nextProvider);
											setModel(session.models.find((item) => item.provider === nextProvider)?.id ?? "");
										}}
									>
										<SelectTrigger>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{providers.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
										</SelectContent>
									</Select>
								</Field>
								<Field label="模型">
									{modelsForProvider.length ? (
										<Select value={model} onValueChange={setModel}>
											<SelectTrigger>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{modelsForProvider.map((item) => <SelectItem key={item.id} value={item.id}>{item.name && item.name !== item.id ? `${item.id} · ${item.name}` : item.id}</SelectItem>)}
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
