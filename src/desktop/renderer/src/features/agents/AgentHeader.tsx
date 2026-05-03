import { useEffect, useRef, useState } from "react";
import {
	AltArrowDownLineDuotone,
	CheckCircleBoldDuotone,
	FolderOpenBoldDuotone,
	GalleryAddLineDuotone,
	PauseBold,
	PlayBold,
	RestartCircleBoldDuotone,
	TrashBinMinimalisticBoldDuotone,
} from "solar-icon-set";
import type { AgentDetails } from "../../../shared/types";
import { AgentAvatar } from "../../components/shared/agent-avatar";
import { AppIcon } from "../../components/shared/app-icon";
import { AceternityTooltip } from "../../components/shared/tooltip";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "../../components/ui/popover";
import { Spinner } from "../../components/ui/spinner-1";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "../../components/ui/alert-dialog";

export function AgentHeader({
	agent,
	isSaving,
	onSaveName,
	isUploadingAvatar,
	onUploadAvatar,
	isStarting,
	isPausing,
	onStart,
	onPause,
	onReveal,
	onDelete,
	deleteError,
}: {
	agent: AgentDetails;
	isSaving: boolean;
	onSaveName: (name: string) => void;
	isUploadingAvatar: boolean;
	onUploadAvatar: (upload: { fileName: string; dataUrl: string }) => void;
	isStarting: boolean;
	isPausing: boolean;
	onStart: () => void;
	onPause: () => void;
	onReveal: () => void;
	onDelete: () => void;
	deleteError?: string;
}): JSX.Element {
	const [open, setOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [deleteStep, setDeleteStep] = useState<"idle" | "stop" | "files" | "done">("idle");
	const [nameDraft, setNameDraft] = useState(agent.name);
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const triggerRef = useRef<HTMLElement | null>(null);
	const contentRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		setNameDraft(agent.name);
	}, [agent.id, agent.name]);

	useEffect(() => {
		return window.pie.onAgentDeleteEvent((event) => {
			if (event.agentId !== agent.id) {
				return;
			}
			setDeleteStep(event.step);
		});
	}, [agent.id]);

	useEffect(() => {
		if (deleteError && deleteStep !== "idle") {
			setDeleteStep("idle");
		}
	}, [deleteError, deleteStep]);

	useEffect(() => {
		if (!open) {
			return;
		}
		const closeOnOutsideInteraction = (event: PointerEvent | MouseEvent | FocusEvent) => {
			const target = event.target as Node | null;
			if (!target) {
				return;
			}
			if (triggerRef.current?.contains(target) || contentRef.current?.contains(target)) {
				return;
			}
			setOpen(false);
		};
		window.addEventListener("pointerdown", closeOnOutsideInteraction, true);
		window.addEventListener("click", closeOnOutsideInteraction, true);
		window.addEventListener("focusin", closeOnOutsideInteraction, true);
		return () => {
			window.removeEventListener("pointerdown", closeOnOutsideInteraction, true);
			window.removeEventListener("click", closeOnOutsideInteraction, true);
			window.removeEventListener("focusin", closeOnOutsideInteraction, true);
		};
	}, [open]);

	const saveName = () => {
		const nextName = nameDraft.trim();
		if (!nextName) {
			setNameDraft(agent.name);
			return;
		}
		if (nextName !== agent.name) {
			onSaveName(nextName);
		}
		setOpen(false);
	};
	const handleAvatarFile = (file: File | undefined) => {
		if (!file) {
			return;
		}
		const reader = new FileReader();
		reader.addEventListener("load", () => {
			if (typeof reader.result === "string") {
				onUploadAvatar({ fileName: file.name, dataUrl: reader.result });
			}
		});
		reader.readAsDataURL(file);
	};

	return (
		<div className={`${open ? "no-drag" : "drag-region"} shrink-0 bg-white px-7 pb-2 pt-5`}>
			<input
				ref={fileInputRef}
				type="file"
				accept="image/png,image/jpeg,image/webp"
				className="sr-only no-drag"
				onChange={(event) => {
					handleAvatarFile(event.target.files?.[0]);
					event.currentTarget.value = "";
				}}
			/>
			<div className="flex items-center justify-between gap-4">
				<Popover open={open} onOpenChange={setOpen}>
					<PopoverTrigger
						render={
							<Button
								ref={triggerRef}
								variant="unstyled"
								size="inline"
								className="pie-smooth-corner no-drag flex h-12 min-w-0 max-w-[420px] items-center gap-3 rounded-[24px] px-1.5 pr-3 text-left transition-[background-color,transform] hover:bg-[var(--slate-2)] aria-expanded:bg-[var(--slate-2)]"
								aria-label="编辑 Agent 信息"
							/>
						}
					>
						<AgentAvatar seed={agent.avatarSeed} src={agent.avatarUrl} size={40} />
						<span className="min-w-0 truncate text-xl font-bold text-foreground">{agent.name}</span>
						{isSaving ? (
							<AppIcon IconComponent={RestartCircleBoldDuotone} className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
						) : (
							<AppIcon
								IconComponent={AltArrowDownLineDuotone}
								className="size-4 shrink-0 text-muted-foreground transition-transform duration-100 group-aria-expanded/button:rotate-180"
							/>
						)}
					</PopoverTrigger>
					<PopoverContent ref={contentRef} className="no-drag" align="start" sideOffset={10}>
						<div className="space-y-4">
							<div>
								<PopoverTitle>Agent 信息</PopoverTitle>
								<PopoverDescription className="mt-1">编辑头像和显示名称。</PopoverDescription>
							</div>
								<div className="pie-smooth-corner space-y-5 rounded-[24px] bg-[var(--slate-2)] p-4">
									<div>
										<div className="mb-3.5 text-xs font-medium text-muted-foreground">Agent 头像</div>
										<div className="flex justify-center">
											<button
												type="button"
												className="group/avatar-upload relative rounded-full outline-none transition-transform active:scale-[0.96] focus-visible:ring-[3px] focus-visible:ring-ring/50"
												onClick={() => fileInputRef.current?.click()}
												disabled={isUploadingAvatar}
												aria-label="更换头像"
											>
												<AgentAvatar seed={agent.avatarSeed} src={agent.avatarUrl} size={72} />
												<span className="pointer-events-none absolute inset-0 grid place-items-center rounded-full bg-black/35 text-white opacity-0 transition-opacity group-hover/avatar-upload:opacity-100 group-focus-visible/avatar-upload:opacity-100">
													<AppIcon IconComponent={isUploadingAvatar ? RestartCircleBoldDuotone : GalleryAddLineDuotone} className={isUploadingAvatar ? "size-6 animate-spin" : "size-6"} />
												</span>
											</button>
										</div>
									</div>
									<label className="block">
										<span className="mb-4 block text-xs font-medium text-muted-foreground">Agent 名称</span>
										<Input
											className="bg-white"
											value={nameDraft}
											onChange={(event) => setNameDraft(event.target.value)}
											onKeyDown={(event) => {
												if (event.key === "Enter") {
													saveName();
												}
												if (event.key === "Escape") {
													setNameDraft(agent.name);
												}
											}}
											aria-label="Agent 名称"
										/>
									</label>
								</div>
							<div className="flex justify-end">
								<Button
									size="sm"
									className="rounded-2xl"
									onClick={saveName}
									disabled={isSaving || !nameDraft.trim()}
								>
									{isSaving && <AppIcon IconComponent={RestartCircleBoldDuotone} className="size-4 animate-spin" />}
									保存名称
								</Button>
							</div>
						</div>
					</PopoverContent>
				</Popover>
				<div className="no-drag flex items-center gap-2">
					{isStarting || isPausing || agent.status === "starting" ? (
						<AceternityTooltip content={isPausing ? "暂停中" : "启动中"} side="bottom">
							<Button
								variant="unstyled"
								size="inline"
								className="inline-flex h-8 w-8 cursor-default items-center justify-center"
								disabled
								aria-label={isPausing ? "Agent pausing" : "Agent starting"}
							>
								<Spinner size={18} color="var(--slate-11)" />
							</Button>
						</AceternityTooltip>
					) : agent.status === "running" ? (
						<AceternityTooltip content="暂停 Agent" side="bottom">
							<Button
								variant="unstyled"
								size="inline"
								className="inline-flex h-8 w-8 items-center justify-center"
								onClick={onPause}
								aria-label="Pause Agent"
							>
								<span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--lime-9)] text-[var(--lime-12)] transition-colors group-hover/button:bg-[var(--lime-10)]">
									<AppIcon IconComponent={PauseBold} className="size-4" />
								</span>
							</Button>
						</AceternityTooltip>
					) : (
						<AceternityTooltip content="启动 Agent" side="bottom">
							<Button
								variant="unstyled"
								size="inline"
								className="inline-flex h-8 w-8 items-center justify-center"
								onClick={onStart}
								aria-label="Start Agent"
							>
								<span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--slate-12)] text-white transition-colors group-hover/button:bg-[var(--slate-11)]">
									<AppIcon IconComponent={PlayBold} className="size-4" />
								</span>
							</Button>
						</AceternityTooltip>
					)}
					<AceternityTooltip content="打开 Agent Profile" side="bottom">
						<Button
							variant="unstyled"
							size="inline"
							className="inline-flex h-8 w-8 items-center justify-center text-[var(--slate-10)] transition hover:text-[var(--slate-12)]"
							onClick={onReveal}
							aria-label="Open Agent Profile"
						>
							<AppIcon IconComponent={FolderOpenBoldDuotone} className="size-7" />
						</Button>
					</AceternityTooltip>
					<AlertDialog
						open={deleteOpen}
						onOpenChange={(nextOpen) => {
							if (deleteStep !== "idle" && deleteStep !== "done") {
								return;
							}
							setDeleteOpen(nextOpen);
							if (!nextOpen) {
								setDeleteStep("idle");
							}
						}}
					>
						<AlertDialogTrigger
							render={
								<Button
									variant="unstyled"
									size="inline"
									className="inline-flex h-8 w-8 items-center justify-center text-[var(--slate-10)] transition hover:text-[var(--red-11)]"
									aria-label="Delete Agent"
								>
									<AceternityTooltip content="删除 Agent" side="bottom" className="h-full w-full items-center justify-center">
										<AppIcon IconComponent={TrashBinMinimalisticBoldDuotone} className="size-7" />
									</AceternityTooltip>
								</Button>
							}
						/>
						<AlertDialogContent className="sm:max-w-md pie-smooth-corner">
							<AlertDialogHeader>
								<AlertDialogTitle>删除 Agent</AlertDialogTitle>
								<AlertDialogDescription>
									{deleteStep === "idle"
										? `确定要删除 ${agent.name} 吗？此操作无法撤销。`
										: "正在删除 Agent，请等待当前步骤完成。"}
								</AlertDialogDescription>
							</AlertDialogHeader>
							{deleteError && <p className="rounded-2xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{deleteError}</p>}
							{deleteStep !== "idle" && <DeleteProgress step={deleteStep} />}
							{deleteStep === "idle" ? (
								<AlertDialogFooter>
									<AlertDialogCancel>取消</AlertDialogCancel>
									<AlertDialogAction
										onClick={(event) => {
											event.preventDefault();
											setDeleteStep("stop");
											onDelete();
										}}
										className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
									>
										确认删除
									</AlertDialogAction>
								</AlertDialogFooter>
							) : null}
						</AlertDialogContent>
					</AlertDialog>
				</div>
			</div>
		</div>
	);
}

const deleteSteps = [
	{ id: "stop", label: "停止运行中的实例" },
	{ id: "files", label: "清除 Agent 文件" },
	{ id: "done", label: "删除完成" },
] as const;

function DeleteProgress({ step }: { step: "stop" | "files" | "done" }): JSX.Element {
	const currentIndex = deleteSteps.findIndex((item) => item.id === step);
	return (
		<div className="space-y-2 rounded-2xl bg-[var(--slate-2)] p-3">
			{deleteSteps.map((item, index) => {
				const done = index < currentIndex || step === "done";
				const active = index === currentIndex && step !== "done";
				return (
					<div key={item.id} className="flex min-h-8 items-center gap-3 text-sm">
						<span className="grid h-5 w-5 shrink-0 place-items-center">
							{done ? (
								<AppIcon IconComponent={CheckCircleBoldDuotone} className="size-5 text-[var(--lime-10)]" />
							) : active ? (
								<span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--lime-4)] border-t-[var(--lime-10)]" />
							) : (
								<span className="h-2 w-2 rounded-full bg-border" />
							)}
						</span>
						<span className={active || done ? "text-foreground" : "text-muted-foreground"}>{item.label}</span>
					</div>
				);
			})}
		</div>
	);
}
