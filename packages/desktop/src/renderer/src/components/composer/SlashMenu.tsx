import {
	type SlashCommandInfo,
	skillDisplayName,
	WORKFLOW_DIRECTIONS,
	type WorkflowDirection,
	workflowStage,
} from "@drone/shared";
import { useEffect, useRef } from "react";
import { useI18nStore, useT } from "../../i18n";
import { groupCommands, isSpecializedCommand, type WorkflowMenuCommand } from "./slash-filter";

/** 斜杠命令补全面板：纯展示，分组（内置/模板/skill/扩展），受控选中与回调由 Composer 驱动 */
export function SlashMenu({
	commands,
	query,
	selectedIndex,
	onSelectedIndexChange,
	onPick,
	showSpecialized = false,
	onToggleSpecialized,
	workflowDirection,
	onBackToWorkflows,
}: {
	commands: SlashCommandInfo[];
	query: string;
	/** 当前选中项在过滤后列表中的下标 */
	selectedIndex: number;
	onSelectedIndexChange: (index: number) => void;
	onPick: (command: WorkflowMenuCommand) => void;
	showSpecialized?: boolean;
	onToggleSpecialized?: () => void;
	workflowDirection?: WorkflowDirection | null;
	onBackToWorkflows?: () => void;
}) {
	const t = useT();
	const listRef = useRef<HTMLDivElement>(null);
	const language = useI18nStore((s) => s.language);
	const groups = groupCommands(commands, query, showSpecialized, workflowDirection);
	const flat = groups.flatMap((group) => group.items);
	const indexes = new Map(flat.map((command, index) => [command, index]));
	const specializedCount = commands.filter(isSpecializedCommand).length;
	const active = Math.max(0, Math.min(selectedIndex, Math.max(flat.length - 1, 0)));

	// 选中项超出可视区域时跟随滚动（键盘上下移动/鼠标悬停均生效）
	useEffect(() => {
		const container = listRef.current;
		if (!container) return;
		const item = container.querySelector<HTMLElement>(`[data-index="${active}"]`);
		if (!item) return;
		const cRect = container.getBoundingClientRect();
		const iRect = item.getBoundingClientRect();
		if (iRect.top < cRect.top) {
			container.scrollTop -= cRect.top - iRect.top;
		} else if (iRect.bottom > cRect.bottom) {
			container.scrollTop += iRect.bottom - cRect.bottom;
		}
	}, [active]);

	if (flat.length === 0 && (query || !specializedCount)) {
		return (
			<div className="mb-1.5 rounded-lg border border-border bg-surface py-2 text-center text-xs text-ink-faint shadow-pop">
				{t("slash.noMatch")}
			</div>
		);
	}

	return (
		<div
			ref={listRef}
			className="mb-1.5 max-h-64 overflow-y-auto rounded-lg border border-border bg-surface shadow-pop"
		>
			{!query && workflowDirection && !showSpecialized && onBackToWorkflows && (
				<button
					type="button"
					className="sticky top-0 z-10 w-full border-b border-border bg-surface px-3 py-2 text-left text-xs text-accent"
					onMouseDown={(event) => event.preventDefault()}
					onClick={onBackToWorkflows}
				>
					{t("workflows.back")} ·{" "}
					{WORKFLOW_DIRECTIONS.find((d) => d.id === workflowDirection)?.label[language]}
				</button>
			)}
			{!query && specializedCount > 0 && onToggleSpecialized && (
				<button
					type="button"
					className="sticky top-0 z-10 w-full border-b border-border bg-surface px-3 py-2 text-left text-[11px] text-ink-dim hover:bg-hover"
					aria-expanded={showSpecialized}
					onMouseDown={(event) => event.preventDefault()}
					onClick={onToggleSpecialized}
				>
					{t(showSpecialized ? "workflows.compact" : "workflows.advanced", {
						count: specializedCount,
					})}
				</button>
			)}
			{groups.map((group) => (
				<div key={group.source} data-command-group={group.source}>
					<p className="px-3 pt-2 pb-1 text-[11px] font-medium text-ink-faint">
						{group.source === "workflow" ? t("workflows.title") : t(`slash.group.${group.source}`)}
					</p>
					{group.items.map((command) => {
						const index = indexes.get(command) ?? 0;
						const unsupported = !command.supported;
						const stage = command.workflowStage ? workflowStage(command.workflowStage) : undefined;
						const direction = command.workflowNavigation
							? WORKFLOW_DIRECTIONS.find((d) => d.id === command.workflowNavigation)
							: undefined;
						const title = direction?.label[language] ?? stage?.label[language];
						return (
							<button
								key={`${command.source}:${command.name}:${command.workflowStage ?? ""}`}
								type="button"
								data-index={index}
								data-command={command.name}
								disabled={unsupported}
								onMouseDown={(event) => event.preventDefault()}
								className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors ${
									index === active ? "bg-hover text-ink" : "text-ink-2 hover:bg-hover"
								} ${unsupported ? "cursor-not-allowed opacity-50" : ""}`}
								onMouseEnter={() => onSelectedIndexChange(index)}
								onClick={() => onPick(command)}
							>
								<span className="min-w-0 max-w-[65%] shrink-0">
									<span className="block truncate font-mono text-ink-dim">
										{title ??
											(isSpecializedCommand(command)
												? skillDisplayName(command.name, language)
												: `/${command.name}`)}
									</span>
									{!direction && !unsupported && (isSpecializedCommand(command) || !!stage) && (
										<span className="block truncate font-mono text-[11px] text-ink-faint">
											/{command.name}
										</span>
									)}
									{command.aliases?.length ? (
										<span className="block truncate text-[11px] text-ink-faint">
											{t("skillsCatalog.aliases")} {command.aliases.map((alias) => `/${alias}`).join(" · ")}
										</span>
									) : null}
								</span>
								<span className="min-w-0 flex-1 truncate text-ink-faint">
									{unsupported
										? t("workflows.unavailable")
										: direction
											? t("workflows.chooseStage")
											: command.description}
								</span>
								{command.argumentHint && (
									<span className="shrink-0 font-mono text-[11px] text-border-strong">
										{command.argumentHint}
									</span>
								)}
							</button>
						);
					})}
				</div>
			))}
		</div>
	);
}
