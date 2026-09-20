import { useEffect, useRef } from "react";
import { useT } from "../../i18n";
import { SubagentAvatar } from "../chat/SubagentAvatar";
import { type AtAgentAvailability, type AtMenuItem, atAgentAvailability } from "./at-subagents";

const SOURCE_KEYS = {
	builtin: "panel.subagents.source.builtin",
	user: "panel.subagents.source.user",
	project: "panel.subagents.source.project",
} as const;

/**
 * @ 补全面板：纯展示（已过滤 + 合并的扁平列表），受控选中与回调由 Composer 驱动。
 * 消息开头的 @ 会先列子智能体（带头像 / 来源角标，S9），再列项目文件；两组共用一个键盘下标。
 */
export function AtMenu({
	items,
	selectedIndex,
	onSelectedIndexChange,
	onPick,
	agentsOffered = false,
}: {
	items: AtMenuItem[];
	/** 当前选中项下标（跨组连续） */
	selectedIndex: number;
	onSelectedIndexChange: (index: number) => void;
	onPick: (item: AtMenuItem) => void;
	/** 本次 @ 是否提供子智能体候选（决定空态文案 / 文件分组标题） */
	agentsOffered?: boolean;
}) {
	const t = useT();
	const listRef = useRef<HTMLDivElement>(null);
	const active = Math.min(selectedIndex, Math.max(items.length - 1, 0));
	const agentCount = items.filter((item) => item.kind === "agent").length;

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

	if (items.length === 0) {
		return (
			<div className="mb-1.5 rounded-lg border border-border bg-surface py-2 text-center text-xs text-ink-faint shadow-pop">
				{agentsOffered ? t("at.noMatchAny") : t("at.noMatch")}
			</div>
		);
	}

	return (
		<div
			ref={listRef}
			className="mb-1.5 max-h-64 overflow-y-auto rounded-lg border border-border bg-surface shadow-pop"
			data-testid="at-menu"
		>
			{items.map((item, index) => {
				const selected = index === active;
				const header =
					item.kind === "agent" && index === 0 ? (
						<p
							className="px-3 pt-2 pb-1 text-[11px] font-medium text-ink-faint"
							data-testid="at-menu-agents-header"
						>
							{t("at.subagentsHeader")}
						</p>
					) : item.kind === "file" && index === agentCount && agentCount > 0 ? (
						<p className="px-3 pt-2 pb-1 text-[11px] font-medium text-ink-faint">{t("at.filesHeader")}</p>
					) : null;
				return (
					<div key={item.key}>
						{header}
						{item.kind === "agent" ? (
							<AgentRow
								item={item}
								index={index}
								selected={selected}
								availability={atAgentAvailability(item.agent)}
								onHover={() => onSelectedIndexChange(index)}
								onPick={() => onPick(item)}
							/>
						) : (
							<FileRow
								path={item.path}
								index={index}
								selected={selected}
								onHover={() => onSelectedIndexChange(index)}
								onPick={() => onPick(item)}
							/>
						)}
					</div>
				);
			})}
		</div>
	);
}

function AgentRow({
	item,
	index,
	selected,
	availability,
	onHover,
	onPick,
}: {
	item: Extract<AtMenuItem, { kind: "agent" }>;
	index: number;
	selected: boolean;
	availability: AtAgentAvailability;
	onHover: () => void;
	onPick: () => void;
}) {
	const t = useT();
	const { agent } = item;
	const untrusted = availability === "untrusted";
	return (
		<button
			type="button"
			data-index={index}
			data-testid="at-menu-agent"
			data-agent={agent.name}
			data-availability={availability}
			disabled={untrusted}
			onMouseDown={(event) => event.preventDefault()}
			className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors ${
				selected ? "bg-hover text-ink" : "text-ink-2 hover:bg-hover"
			} ${untrusted ? "cursor-not-allowed opacity-60" : ""}`}
			onMouseEnter={onHover}
			onClick={onPick}
			title={untrusted ? t("panel.subagents.errors.untrusted", { agent: agent.name }) : undefined}
		>
			<SubagentAvatar name={agent.name} source={agent.source} size="md" state="idle" />
			<span className="min-w-0 flex-1">
				<span className="block truncate font-semibold text-ink">{agent.name}</span>
				<span className="block truncate text-[11px] text-ink-dim">
					{agent.description}
					{availability === "needs_panel" ? ` · ${t("at.subagentNeedsPanel")}` : ""}
				</span>
			</span>
			<span
				className={`shrink-0 rounded-full border px-1.5 text-[10px] leading-4 ${
					untrusted ? "border-warn/50 text-warn" : "border-border text-ink-dim"
				}`}
			>
				{untrusted ? t("panel.subagents.untrusted") : t(SOURCE_KEYS[agent.source])}
			</span>
		</button>
	);
}

function FileRow({
	path,
	index,
	selected,
	onHover,
	onPick,
}: {
	path: string;
	index: number;
	selected: boolean;
	onHover: () => void;
	onPick: () => void;
}) {
	const isDir = path.endsWith("/");
	const slash = path.lastIndexOf("/", path.length - 2);
	const base = isDir ? path.slice(slash + 1, -1) : path.slice(slash + 1);
	const dir = isDir ? path.slice(0, slash + 1) : slash === -1 ? "" : path.slice(0, slash + 1);
	return (
		<button
			type="button"
			data-index={index}
			data-testid="at-menu-file"
			onMouseDown={(event) => event.preventDefault()}
			className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors ${
				selected ? "bg-hover text-ink" : "text-ink-2 hover:bg-hover"
			}`}
			onMouseEnter={onHover}
			onClick={onPick}
		>
			<span className="shrink-0 font-mono text-ink-faint">{isDir ? "▸" : "·"}</span>
			<span className="min-w-0 flex-1 truncate font-mono">
				<span className="text-ink-faint">{dir}</span>
				<span className="text-ink-2">{base}</span>
				{isDir && <span className="text-ink-faint">/</span>}
			</span>
		</button>
	);
}
