import { groupRunningFirst } from "@drone/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../i18n";
import { usePluginEntries } from "../../plugins/PluginRegions";
import { UI_REGIONS } from "../../plugins/slots";
import { useAskCountsStore } from "../../stores/ask-counts";
import { selectHosts, useComputeStore } from "../../stores/compute";
import { useKnowledgeStore } from "../../stores/knowledge";
import { deriveProjects, useProjectsStore } from "../../stores/projects";
import { useSessionsStore } from "../../stores/sessions";
import { type SettingsCategory, useSettingsStore } from "../../stores/settings";
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
	TaskBoardIcon,
	TestIcon,
} from "../icons";
import { SessionRow } from "../projects/SessionRow";

type PrimaryNavKey = "newTask" | "knowledge" | "skills" | "hosts";
const SKILLS_SETTINGS_CATEGORIES: readonly string[] = ["skills", "mcp", "zotero", "extensions"];
const HOST_SETTINGS_CATEGORIES: readonly string[] = ["compute", "workflows"];

/**
 * Sidebar labels: the folder name, "根目录" for "/", and `parent/name` when two projects share a name
 * (two "workspace" rows are otherwise indistinguishable).
 */
export function projectDisplayNames(
	projects: readonly { cwd: string; name: string }[],
	rootLabel: string,
): Map<string, string> {
	const base = (project: { cwd: string; name: string }) => {
		const trimmed = project.cwd.replace(/[\\/]+$/u, "");
		return trimmed === "" ? rootLabel : project.name || trimmed.split(/[\\/]/u).pop() || rootLabel;
	};
	const counts = new Map<string, number>();
	for (const project of projects) counts.set(base(project), (counts.get(base(project)) ?? 0) + 1);
	return new Map(
		projects.map((project) => {
			const name = base(project);
			if ((counts.get(name) ?? 0) < 2) return [project.cwd, name];
			const parts = project.cwd.replace(/[\\/]+$/u, "").split(/[\\/]/u);
			const parent = parts.length >= 2 ? parts[parts.length - 2] : "";
			return [project.cwd, parent ? `${parent}/${name}` : name];
		}),
	);
}

export function isPrimaryNavActive(
	key: PrimaryNavKey,
	state: { view: AppView; settingsOpen: boolean; settingsCategory: SettingsCategory },
): boolean {
	if (key === "newTask") return state.view === "chat" && !state.settingsOpen;
	if (key === "knowledge") return state.view === "knowledge";
	if (key === "skills")
		return (
			state.view === "skills" ||
			(state.settingsOpen && SKILLS_SETTINGS_CATEGORIES.includes(state.settingsCategory))
		);
	return (
		state.view === "hosts" ||
		(state.settingsOpen && HOST_SETTINGS_CATEGORIES.includes(state.settingsCategory))
	);
}

const PRIMARY_ITEMS: ReadonlyArray<{
	key: PrimaryNavKey;
	icon: typeof ComposeIcon;
	label: PrimaryNavKey;
}> = [
	{ key: "newTask", icon: ComposeIcon, label: "newTask" },
	{ key: "knowledge", icon: ObsidianIcon, label: "knowledge" },
	{ key: "skills", icon: TaskBoardIcon, label: "skills" },
	{ key: "hosts", icon: TestIcon, label: "hosts" },
];

export const WORKBENCH_NAV_ORDER: readonly PrimaryNavKey[] = Object.freeze(
	PRIMARY_ITEMS.map(({ key }) => key),
);

/**
 * 左侧研究工作台导航：一级入口保持稳定，项目和最近会话沿用真实会话数据。
 * 旧的设置和帮助入口收进头像菜单，但仍使用现有 SettingsStore 兼容跳转。
 */
const COLLAPSE_KEY = "drone.sidebar.collapsed";
const RECENT_LIMIT = 8;

/** 侧栏「项目 / 最近」：数据来自真实历史会话；运行中 / 等待输入的会话排在最近分组顶部。 */
function SidebarSessions() {
	const t = useT();
	const allSessions = useProjectsStore((s) => s.allSessions);
	const addedProjects = useProjectsStore((s) => s.addedProjects);
	const selectProject = useProjectsStore((s) => s.select);
	const setView = useUiStore((s) => s.setView);
	const closeKnowledge = useKnowledgeStore((s) => s.close);
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
	const projects = useMemo(
		() => deriveProjects({ allSessions, addedProjects }),
		[allSessions, addedProjects],
	);
	const { running, rest } = useMemo(() => {
		const active = new Set(activeIds ? activeIds.split("|") : []);
		const sorted = [...allSessions]
			.filter((m) => m.sessionFile)
			.sort((a, b) => (b.modifiedAt ?? b.createdAt) - (a.modifiedAt ?? a.createdAt));
		return groupRunningFirst(sorted, (m) => active.has(m.sessionId) || (askCounts[m.sessionId] ?? 0) > 0);
	}, [allSessions, activeIds, askCounts]);
	const projectLabels = useMemo(
		() => projectDisplayNames(projects, t("workbench.nav.rootProject")),
		[projects, t],
	);
	return (
		<div className="workbench-nav-sessions" data-testid="sidebar-sessions">
			<div className="flex items-center justify-between pr-2">
				<h3 className="workbench-nav-group">{t("workbench.nav.projectsGroup")}</h3>
				{/* The projects page is reached from its group header instead of a duplicate nav item. */}
				<button
					type="button"
					className="rounded px-1.5 text-[11px] text-ink-faint hover:bg-hover hover:text-ink"
					onClick={() => {
						closeKnowledge();
						setView("projects");
					}}
				>
					{t("workbench.nav.projectsAll")}
				</button>
			</div>
			<ul>
				{projects.length > 0 ? (
					projects.map((project) => (
						<li key={project.cwd}>
							<button
								type="button"
								className="workbench-nav-project"
								title={project.cwd}
								onClick={() => {
									selectProject(project.cwd);
									closeKnowledge();
									setView("projects");
								}}
							>
								<ProjectsIcon size={14} />
								<span className="min-w-0 flex-1 truncate">
									{projectLabels.get(project.cwd) ?? project.name}
								</span>
								<span className="workbench-nav-project-count">{project.sessionCount}</span>
							</button>
						</li>
					))
				) : (
					<li>
						<p className="px-2 py-2 text-[11px] leading-relaxed text-ink-faint">
							{t("workbench.nav.projectsEmpty")}
						</p>
					</li>
				)}
			</ul>
			<h3 className="workbench-nav-group">{t("workbench.nav.recent")}</h3>
			<ul>
				{running.length > 0 || rest.length > 0 ? (
					<>
						{running.map((s) => (
							<SessionRow
								key={s.sessionId}
								session={s}
								showDir
								live={(askCounts[s.sessionId] ?? 0) > 0 ? "awaiting" : "running"}
							/>
						))}
						{rest.slice(0, RECENT_LIMIT).map((s) => (
							<SessionRow key={s.sessionId} session={s} showDir />
						))}
					</>
				) : (
					<li>
						<p className="px-2 py-2 text-[11px] leading-relaxed text-ink-faint">
							{t("workbench.nav.recentEmpty")}
						</p>
					</li>
				)}
			</ul>
		</div>
	);
}

export function WorkbenchNav() {
	const t = useT();
	const [accountOpen, setAccountOpen] = useState(false);
	const accountRef = useRef<HTMLDivElement>(null);
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
	const createDraftSession = useSessionsStore((s) => s.createDraftSession);
	const closeKnowledge = useKnowledgeStore((s) => s.close);
	const openKnowledge = useKnowledgeStore((s) => s.open);
	const settingsOpen = useSettingsStore((s) => s.open);
	const settingsCategory = useSettingsStore((s) => s.category);
	const hostCount = useComputeStore(selectHosts).length;
	const skillAttentionCount = useSettingsStore((s) => s.skillDiagnostics.length);
	// 插件贡献的全屏视图（rail.view 区域，挂钩 4）
	const pluginViews = usePluginEntries(UI_REGIONS.RailView);

	const selectPrimary = (key: PrimaryNavKey) => {
		if (key === "newTask") {
			closeKnowledge();
			setView("chat");
			createDraftSession(cwd ?? undefined);
			return;
		}
		if (key === "knowledge") {
			useUiStore.getState().setKnowledgeTab("home");
			openKnowledge({ cwd, sessionId: activeSessionId, tab: "reviews" });
			return;
		}
		closeKnowledge();
		if (key === "skills") {
			useSettingsStore.getState().setOpen(false);
			setView("skills");
			return;
		}
		useUiStore.getState().setView("hosts");
	};
	useEffect(() => {
		if (!accountOpen) return;
		const onPointerDown = (event: PointerEvent) => {
			if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setAccountOpen(false);
		};
		window.addEventListener("pointerdown", onPointerDown);
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [accountOpen]);

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
				{PRIMARY_ITEMS.map(({ key, icon: Icon, label }) => {
					const active = isPrimaryNavActive(key, { view, settingsOpen, settingsCategory });
					return (
						<button
							key={key}
							type="button"
							className={`workbench-nav-item${active ? " is-active" : ""}`}
							onClick={() => selectPrimary(key)}
							aria-current={active ? "page" : undefined}
							title={t(`workbench.nav.${label}`)}
							aria-label={t(`workbench.nav.${label}`)}
						>
							<Icon size={17} />
							<span>{t(`workbench.nav.${label}`)}</span>
							{key === "skills" && skillAttentionCount > 0 && (
								<span className="workbench-nav-badge" aria-hidden="true">
									{skillAttentionCount}
								</span>
							)}
							{key === "hosts" && hostCount > 0 && (
								<span className="workbench-nav-count" aria-hidden="true">
									{hostCount}
								</span>
							)}
						</button>
					);
				})}
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
			<div className="workbench-nav-account" ref={accountRef}>
				<button
					type="button"
					className={`workbench-nav-account-button${accountOpen ? " is-open" : ""}`}
					onClick={() => setAccountOpen((open) => !open)}
					aria-label={t("workbench.nav.account")}
					aria-haspopup="menu"
					aria-expanded={accountOpen}
					title={t("workbench.nav.account")}
				>
					<span className="workbench-nav-avatar" aria-hidden="true">
						D
					</span>
					<span>{t("workbench.nav.account")}</span>
				</button>
				{accountOpen && (
					<div className="workbench-nav-account-menu" role="menu">
						<button
							type="button"
							role="menuitem"
							onClick={() => {
								setAccountOpen(false);
								useSettingsStore.getState().openWith("general");
							}}
						>
							<GearIcon size={15} />
							{t("workbench.nav.settings")}
						</button>
						<button
							type="button"
							role="menuitem"
							onClick={() => {
								setAccountOpen(false);
								useSettingsStore.getState().openWith("about");
							}}
						>
							<HelpIcon size={15} />
							{t("workbench.nav.help")}
						</button>
						<button
							type="button"
							role="menuitem"
							onClick={() => {
								setAccountOpen(false);
								useSettingsStore.getState().openWith("about");
							}}
						>
							<HelpIcon size={15} />
							{t("settings.category.about")}
						</button>
					</div>
				)}
			</div>
		</aside>
	);
}
