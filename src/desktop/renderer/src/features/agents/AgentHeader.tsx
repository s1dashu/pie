import type { MutableRefObject } from "react";
import {
	CheckCircleLineDuotone,
	FolderOpenBoldDuotone,
	PauseCircleBoldDuotone,
	PenLineDuotone,
	PlayCircleBoldDuotone,
	RestartCircleBoldDuotone,
	TrashBinMinimalisticBoldDuotone,
} from "solar-icon-set";
import type { AgentDetails } from "../../../shared/types";
import { AgentAvatar } from "../../components/shared/agent-avatar";
import { AppIcon } from "../../components/shared/app-icon";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";

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
	draftName,
	isEditingName,
	isSaving,
	nameInputRef,
	onDraftNameChange,
	onCommitName,
	onEditName,
	onCancelNameEdit,
	onStart,
	onPause,
	onReveal,
	onDelete,
}: {
	agent: AgentDetails;
	draftName: string;
	isEditingName: boolean;
	isSaving: boolean;
	nameInputRef: MutableRefObject<HTMLInputElement | null>;
	onDraftNameChange: (name: string) => void;
	onCommitName: () => void;
	onEditName: () => void;
	onCancelNameEdit: () => void;
	onStart: () => void;
	onPause: () => void;
	onReveal: () => void;
	onDelete: () => void;
}): JSX.Element {
	return (
		<div className="drag-region shrink-0 bg-white px-7 pb-2 pt-5">
			<div className="flex items-center justify-between gap-4">
				<div className="flex min-w-0 items-center gap-4">
					<AgentAvatar seed={agent.avatarSeed} size={40} />
					<div className="group/name no-drag flex min-w-0 items-center gap-1.5">
						{isEditingName ? (
							<div className="pie-smooth-corner flex h-9 min-w-0 items-center rounded-[18px] bg-[var(--lime-3)] ring-2 ring-[var(--lime-8)]">
								<Input
									ref={nameInputRef}
									variant="unstyled"
									className="h-full min-w-0 flex-1 bg-transparent px-3 text-xl font-semibold text-foreground caret-[var(--lime-11)] outline-none selection:bg-[var(--lime-6)]"
									value={draftName}
									onChange={(event) => onDraftNameChange(event.target.value)}
									onBlur={onCommitName}
									onKeyDown={(event) => {
										if (event.key === "Enter") {
											event.currentTarget.blur();
										}
										if (event.key === "Escape") {
											onCancelNameEdit();
										}
									}}
									aria-label="Agent Name"
								/>
								<Button
									variant="unstyled"
									size="inline"
									className="pie-smooth-corner flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--lime-11)] transition hover:bg-[var(--lime-5)] hover:text-[var(--lime-12)]"
									onMouseDown={(event) => event.preventDefault()}
									onClick={onCommitName}
									aria-label="保存 Agent 名称"
									title="保存"
								>
									<AppIcon IconComponent={CheckCircleLineDuotone} className="size-5" />
								</Button>
							</div>
						) : (
							<>
								<div className="min-w-0 truncate text-xl font-semibold text-foreground">{draftName}</div>
								<Button
									variant="unstyled"
									size="inline"
									className="pie-smooth-corner no-drag flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-0 transition hover:bg-[var(--slate-3)] hover:text-[var(--lime-11)] group-hover/name:opacity-100 focus:opacity-100"
									onClick={onEditName}
									aria-label="编辑 Agent 名称"
									title="编辑名称"
								>
									<AppIcon IconComponent={PenLineDuotone} className="size-4" />
								</Button>
							</>
						)}
						{isSaving && <AppIcon IconComponent={RestartCircleBoldDuotone} className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />}
					</div>
				</div>
				<div className="no-drag flex items-center gap-2">
					{agent.status === "running" ? (
						<Button
							variant="unstyled"
							size="inline"
							className="inline-flex h-8 w-8 items-center justify-center text-[var(--slate-11)] transition hover:text-[var(--slate-12)]"
							onClick={onPause}
							title="Pause Agent"
							aria-label="Pause Agent"
						>
							<AppIcon IconComponent={PauseCircleBoldDuotone} className="size-7" />
						</Button>
					) : (
						<Button
							variant="unstyled"
							size="inline"
							className="inline-flex h-8 w-8 items-center justify-center text-[var(--lime-11)] transition hover:text-[var(--lime-12)]"
							onClick={onStart}
							title="Start Agent"
							aria-label="Start Agent"
						>
							<AppIcon IconComponent={PlayCircleBoldDuotone} className="size-7" />
						</Button>
					)}
					<Button
						variant="unstyled"
						size="inline"
						className="inline-flex h-8 w-8 items-center justify-center text-[var(--lime-11)] transition hover:text-[var(--lime-12)]"
						onClick={onReveal}
						title="Open Agent Profile"
						aria-label="Open Agent Profile"
					>
						<AppIcon IconComponent={FolderOpenBoldDuotone} className="size-7" />
					</Button>
					<AlertDialog>
						<AlertDialogTrigger
							render={
								<Button
									variant="unstyled"
									size="inline"
									className="inline-flex h-8 w-8 items-center justify-center text-[var(--red-11)] transition hover:text-[var(--red-12)]"
									title="Delete Agent"
									aria-label="Delete Agent"
								>
									<AppIcon IconComponent={TrashBinMinimalisticBoldDuotone} className="size-7" color="var(--red-11)" />
								</Button>
							}
						/>
						<AlertDialogContent className="sm:max-w-md pie-smooth-corner">
							<AlertDialogHeader>
								<AlertDialogTitle>删除 Agent</AlertDialogTitle>
								<AlertDialogDescription>
									确定要删除 {agent.name} 吗？此操作无法撤销。
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>取消</AlertDialogCancel>
								<AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
									确认删除
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				</div>
			</div>
		</div>
	);
}
