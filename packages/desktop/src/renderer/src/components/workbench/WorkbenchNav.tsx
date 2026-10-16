import { groupRunningFirst } from "@drone/shared";
import { useEffect, useMemo, useState } from "react";
import { useT } from "../../i18n";
import { usePluginEntries } from "../../plugins/PluginRegions";
import { UI_REGIONS } from "../../plugins/slots";
import { useAskCountsStore } from "../../stores/ask-counts";
import { useKnowledgeStore } from "../../stores/knowledge";
import { useProjectsStore } from "../../stores/projects";
import { useSessionsStore } from "../../stores/sessions";
import { useSettingsStore } from "../../stores/settings";
import { useTranscriptStore } from "../../stores/transcript";
import { type AppView, useUiStore } from "../../stores/ui";
import {
	ComposeIcon,
	GearIcon,
	HelpIcon,
	ObsidianIcon,
	PanelLeftIcon,
	ProjectsIcon,
	PuzzleIcon,
	SearchIcon,
	SubagentIcon,
} from "../icons";
import { SessionRow } from "../projects/SessionRow";

type NavKey = AppView | "extensions";

const VIEW_ITEMS: {
	key: AppView;
	icon: typeof ComposeIcon;
	label: "chat" | "projects" | "research" | "knowledge";
}[] = [
	{ key: "chat", icon: ComposeIcon, label: "chat" },
	{ key: "projects", icon: ProjectsIcon, label: "projects" },
	{ key: "research", icon: SearchIcon, label: "research" },
	{ key: "knowledge", icon: ObsidianIcon, label: "knowledge" },
];

/**
 * 左侧导航栏（56px 图标栏）：导航即状态——高亮永远等于当前 view（读 store，不再自持 selected）。
 * 聊天 / 空间 / 知识库 是三个全屏视图（原「研究工作台」与知识库打开同一视图，已合并）；扩展 / 设置 / 帮助 走设置弹窗。
 */
const COLLAPSE_KEY = "drone.sidebar.collapsed";
const RECENT_LIMIT = 8;

/** 侧栏「进行中 / 最近」：跨项目，最近活动在前；运行中 / 等待输入置顶 */
function SidebarSessions() {
	const t = useT();
	const allSessions = useProjectsStore((s) => s.allSessions);
	const loaded = useProjectsStore((s) => s.loaded);
	const load = useProjectsStore((s) => s.load);
	useEffect(() => {
		if (!loaded) void load();
	}, [loaded, load]);
	const activeIds = useTranscriptStore((s) =>
		Object.entries(s.bySession)
			.filter(([, e]) => e?.agentActive)
			.map(([id]) => id)
			.sort()
			.join("|"),
	);
	const askCounts = useAskCountsStore((s) => s.bySession);
	const { running, rest } = useMemo(() => {
		const active = new Set(activeIds ? activeIds.split("|") : []);
		const sorted = [...allSessions]
			.filter((m) => m.sessionFile)
			.sort((a, b) => (b.modifiedAt ?? b.createdAt) - (a.modifiedAt ?? a.createdAt));
		return groupRunningFirst(sorted, (m) => active.has(m.sessionId) || (askCounts[m.sessionId] ?? 0) > 0);
	}, [allSessions, activeIds, askCounts]);
	if (running.length === 0 && rest.length === 0) return null;
	return (
		<div className="workbench-nav-sessions" data-testid="sidebar-sessions">
			{running.length > 0 && (
				<>
					<h3 className="workbench-nav-group">{t("projects.running")}</h3>
					<ul>
						{running.map((s) => (
							<SessionRow
								key={s.sessionId}
								session={s}
								showDir
								live={(askCounts[s.sessionId] ?? 0) > 0 ? "awaiting" : "running"}
							/>
						))}
					</ul>
				</>
			)}
			{rest.length > 0 && (
				<>
					<h3 className="workbench-nav-group">{t("workbench.nav.recent")}</h3>
					<ul>
						{rest.slice(0, RECENT_LIMIT).map((s) => (
							<SessionRow key={s.sessionId} session={s} showDir />
						))}
					</ul>
				</>
			)}
		</div>
	);
}

export function WorkbenchNav() {
	const t = useT();
	const [collapsed, setCollapsed] = useState(() => {
		try {
			return localStorage.getItem(COLLAPSE_KEY) === "1";
		} catch {
			return false;
		}
	});
	const toggleCollapsed = () =>
		setCollapsed((v) => {
			try {
				localStorage.setItem(COLLAPSE_KEY, v ? "0" : "1");
			} catch {
				// 存储不可用：只在本次会话生效
			}
			return !v;
		});
	const view = useUiStore((s) => s.view);
	const setView = useUiStore((s) => s.setView);
	const cwd = useSessionsStore((s) => s.cwd);
	const activeSessionId = useSessionsStore((s) => s.activeSessionId);
	const closeKnowledge = useKnowledgeStore((s) => s.close);
	const openKnowledge = useKnowledgeStore((s) => s.open);
	// 插件贡献的全屏视图（rail.view 区域，挂钩 4）
	const pluginViews = usePluginEntries(UI_REGIONS.RailView);

	const select = (key: NavKey) => {
		if (key === "extensions") {
			useSettingsStore.getState().openWith("extensions");
			return;
		}
		if (key === "knowledge") {
			openKnowledge({ cwd, sessionId: activeSessionId, tab: "reviews" });
			return;
		}
		closeKnowledge();
		setView(key);
	};

	return (
		<aside
			className={`workbench-nav${collapsed ? "" : " is-wide"}`}
			aria-label={t("workbench.nav.title")}
			data-testid="workbench-nav"
		>
			<button
				type="button"
				className="workbench-nav-collapse"
				onClick={toggleCollapsed}
				title={collapsed ? t("workbench.nav.expand") : t("workbench.nav.collapse")}
				aria-label={collapsed ? t("workbench.nav.expand") : t("workbench.nav.collapse")}
				aria-expanded={!collapsed}
			>
				<PanelLeftIcon size={16} />
			</button>
			<nav className="workbench-nav-list" aria-label={t("workbench.nav.title")}>
				{VIEW_ITEMS.map(({ key, icon: Icon, label }) => (
					<button
						key={key}
						type="button"
						className={`workbench-nav-item${view === key ? " is-active" : ""}`}
						onClick={() => select(key)}
						aria-current={view === key ? "page" : undefined}
						title={t(`workbench.nav.${label}`)}
					>
						<Icon size={17} />
						<span>{t(`workbench.nav.${label}`)}</span>
					</button>
				))}
				{pluginViews.map((entry) => (
					<button
						key={entry.id}
						type="button"
						className={`workbench-nav-item${view === entry.id ? " is-active" : ""}`}
						onClick={() => {
							closeKnowledge();
							setView(entry.id as AppView);
						}}
						aria-current={view === entry.id ? "page" : undefined}
						title={entry.title}
						data-plugin={entry.pluginName}
					>
						<PuzzleIcon size={17} />
						<span>{entry.title}</span>
					</button>
				))}
			</nav>
			{!collapsed && <SidebarSessions />}
			<div className="workbench-nav-list mt-auto">
				<button
					type="button"
					className="workbench-nav-item"
					onClick={() => select("extensions")}
					title={t("workbench.nav.extensions")}
				>
					<SubagentIcon size={17} />
					<span>{t("workbench.nav.extensions")}</span>
				</button>
				<button
					type="button"
					className="workbench-nav-item"
					onClick={() => useSettingsStore.getState().openWith("general")}
					title={t("workbench.nav.settings")}
				>
					<GearIcon size={17} />
					<span>{t("workbench.nav.settings")}</span>
				</button>
				<button
					type="button"
					className="workbench-nav-item"
					onClick={() => useSettingsStore.getState().openWith("about")}
					title={t("workbench.nav.help")}
				>
					<HelpIcon size={17} />
					<span>{t("workbench.nav.help")}</span>
				</button>
			</div>
		</aside>
	);
}
