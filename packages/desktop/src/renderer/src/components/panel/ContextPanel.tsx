import { deriveTurnChanges } from "@drone/shared";
import { useEffect, useMemo, useRef } from "react";
import { useT } from "../../i18n";
import { isPluginEntryId, PluginEntryHost, usePluginEntries } from "../../plugins/PluginRegions";
import { UI_REGIONS } from "../../plugins/slots";
import { useKnowledgeStore } from "../../stores/knowledge";
import { useSessionsStore } from "../../stores/sessions";
import { EMPTY_TODOS, selectTranscript, useTranscriptStore } from "../../stores/transcript";
import { PANEL_TABS, type PanelTab, useUiStore } from "../../stores/ui";
import { PanelRightIcon } from "../icons";
import { mergeKnowledgeArtifacts } from "../knowledge/artifacts";
import { useSessionStatus } from "../session/session-status";
import { ArtifactsPane } from "./ArtifactsPane";
import { ChangesPane } from "./ChangesPane";
import { ProcessPane } from "./ProcessPane";
import { TasksPane } from "./TasksPane";

/** 面板宽度（CSS 变量同步 globals.css .context-panel） */
export const CONTEXT_PANEL_WIDTH = 372;

/**
 * 右侧上下文面板：任务 / 过程 / 变更 / 产物 四页签，替代原 DiffSidebar + TaskSidebar + Todo 悬浮胶囊 +
 * 知识流横条。固定栏位、push 式收展（聊天列自然压缩），永远只有一个右栏。
 *
 * 展开规则（用户确认）：运行开始自动展开；运行结束回到空闲选择；空闲时的手动开关被记住。
 */
export function ContextPanel() {
	const t = useT();
	const activeSessionId = useSessionsStore((s) => s.activeSessionId);
	const open = useUiStore((s) => s.panelOpen);
	const tab = useUiStore((s) => s.panelTab);
	const setTab = useUiStore((s) => s.setPanelTab);
	const setPanelOpen = useUiStore((s) => s.setPanelOpen);
	const onRunStart = useUiStore((s) => s.onRunStart);
	const onRunEnd = useUiStore((s) => s.onRunEnd);
	const agentActive = useTranscriptStore((s) => selectTranscript(s, activeSessionId).agentActive);
	// 插件页签（panel.tab 区域贡献，挂钩 4）：被禁用/卸载后若仍选中，回到「任务」
	const pluginTabs = usePluginEntries(UI_REGIONS.PanelTab);
	const pluginTab = pluginTabs.find((entry) => entry.id === tab);
	useEffect(() => {
		if (isPluginEntryId(tab) && !pluginTab) setTab("tasks");
	}, [tab, pluginTab, setTab]);

	// 运行边界驱动自动展开/回落；切会话时重置基线（不把别的会话的状态翻转当成边界）
	const activeRef = useRef<{ sid: string | null; active: boolean }>({
		sid: activeSessionId,
		active: agentActive,
	});
	useEffect(() => {
		const prev = activeRef.current;
		activeRef.current = { sid: activeSessionId, active: agentActive };
		if (prev.sid !== activeSessionId) return;
		if (!prev.active && agentActive) onRunStart();
		else if (prev.active && !agentActive) onRunEnd();
	}, [activeSessionId, agentActive, onRunStart, onRunEnd]);

	return (
		<aside className={`context-panel${open ? " open" : ""}`} aria-hidden={!open} data-testid="context-panel">
			<div className="context-panel-in">
				<PanelHeader
					sessionId={activeSessionId}
					tab={tab}
					onTab={setTab}
					onCollapse={() => setPanelOpen(false, agentActive)}
					collapseLabel={t("panel.collapse")}
				/>
				<div className="context-panel-body">
					{tab === "tasks" && <TasksPane sessionId={activeSessionId} />}
					{tab === "process" && <ProcessPane sessionId={activeSessionId} />}
					{tab === "changes" && <ChangesPane sessionId={activeSessionId} />}
					{tab === "artifacts" && <ArtifactsPane sessionId={activeSessionId} />}
					{pluginTab && <PluginEntryHost entry={pluginTab} />}
				</div>
				<PanelFooter />
			</div>
		</aside>
	);
}

/** 页签计数：任务 done/total、变更文件数、产物数（过程页不计数） */
function useTabBadges(sessionId: string | null): Partial<Record<PanelTab, string>> {
	const todos =
		useTranscriptStore((s) => (sessionId ? s.bySession[sessionId]?.todos : undefined)) ?? EMPTY_TODOS;
	const messages = useTranscriptStore((s) => selectTranscript(s, sessionId).messages);
	const cwd = useSessionsStore((s) => s.cwd);
	const flow = useKnowledgeStore((s) => (sessionId ? s.flows[sessionId] : undefined));
	return useMemo(() => {
		const badges: Partial<Record<PanelTab, string>> = {};
		const latestTask = [...messages].reverse().find((m) => m.kind === "assistant" && m.taskView);
		const tasks = latestTask?.kind === "assistant" ? (latestTask.taskView?.tasks ?? []) : [];
		if (todos.length > 0) {
			const done = todos.filter((x) => x.status === "completed").length;
			badges.tasks = `${done}/${todos.length}`;
		} else if (tasks.length > 0) {
			badges.tasks = String(tasks.length);
		}
		const files = deriveTurnChanges(messages).reduce((sum, tc) => sum + tc.files.length, 0);
		if (files > 0) badges.changes = String(files);
		const artifacts = mergeKnowledgeArtifacts(flow?.cards || [], tasks, cwd || "");
		if (artifacts.length > 0) badges.artifacts = String(artifacts.length);
		return badges;
	}, [todos, messages, flow, cwd]);
}

function PanelHeader({
	sessionId,
	tab,
	onTab,
	onCollapse,
	collapseLabel,
}: {
	sessionId: string | null;
	tab: PanelTab;
	onTab: (tab: PanelTab) => void;
	onCollapse: () => void;
	collapseLabel: string;
}) {
	const t = useT();
	const badges = useTabBadges(sessionId);
	const pluginTabs = usePluginEntries(UI_REGIONS.PanelTab);
	return (
		<div className="context-panel-head">
			<div className="flex items-center gap-2">
				<StatusLine sessionId={sessionId} />
				<button
					type="button"
					className="context-panel-collapse"
					onClick={onCollapse}
					aria-label={collapseLabel}
				>
					<PanelRightIcon size={14} />
				</button>
			</div>
			<div className="context-panel-tabs" role="tablist" aria-label={t("panel.title")}>
				{PANEL_TABS.map((key) => (
					<button
						key={key}
						type="button"
						role="tab"
						aria-selected={tab === key}
						className={tab === key ? "on" : ""}
						onClick={() => onTab(key)}
					>
						<span>{t(`panel.tabs.${key}`)}</span>
						{badges[key] && <span className="context-panel-badge">{badges[key]}</span>}
					</button>
				))}
				{pluginTabs.map((entry) => (
					<button
						key={entry.id}
						type="button"
						role="tab"
						aria-selected={tab === entry.id}
						className={tab === entry.id ? "on" : ""}
						onClick={() => onTab(entry.id as PanelTab)}
						data-plugin={entry.pluginName}
					>
						<span>{entry.title}</span>
					</button>
				))}
			</div>
		</div>
	);
}

/** 状态行：等待确认 > 运行中 · 实时活动 > 已完成 > 空闲（导航即状态：面板头永远能看出 agent 在干嘛） */
function StatusLine({ sessionId }: { sessionId: string | null }) {
	const t = useT();
	const status = useSessionStatus(sessionId ?? "");
	const liveText = useTranscriptStore((s) => {
		if (!sessionId) return undefined;
		const entry = s.bySession[sessionId];
		return entry?.researchStatus.host?.text ?? entry?.researchStatus.agent?.text;
	});
	const tone =
		status === "attention"
			? "bg-amber-500"
			: status === "working"
				? "bg-violet-500 animate-pulse"
				: status === "done"
					? "bg-emerald-500"
					: "bg-ink-faint";
	return (
		<div className="flex min-w-0 flex-1 items-center gap-2 text-[12px] text-ink-2">
			<span className={`h-2 w-2 shrink-0 rounded-full ${tone}`} aria-hidden="true" />
			<span className="shrink-0 font-medium">{t(`panel.status.${status}`)}</span>
			{status === "working" && liveText && (
				<span className="min-w-0 truncate text-ink-dim" title={liveText}>
					· {liveText}
				</span>
			)}
		</div>
	);
}

/** 面板脚：模型 · 思考档 · 工作目录（只读信息，不放控件——控件在输入框） */
function PanelFooter() {
	const t = useT();
	const activeSession = useSessionsStore((s) => s.sessions.find((x) => x.sessionId === s.activeSessionId));
	const currentModel = useSessionsStore((s) => s.currentModel);
	const models = useSessionsStore((s) => s.models);
	const cwd = useSessionsStore((s) => s.cwd);
	const effective = activeSession?.model ?? currentModel;
	const modelLabel = effective
		? (models.find((m) => m.provider === effective.provider && m.id === effective.modelId)?.label ??
			effective.modelId)
		: t("workbench.modelNotSelected");
	const dir = (activeSession?.cwd ?? cwd ?? "").split(/[\\/]/).filter(Boolean).pop() ?? "";
	return (
		<div className="context-panel-foot" title={activeSession?.cwd ?? cwd ?? undefined}>
			<span className="truncate">{modelLabel}</span>
			{dir && (
				<>
					<span className="text-ink-faint">·</span>
					<span className="truncate">{dir}</span>
				</>
			)}
		</div>
	);
}
