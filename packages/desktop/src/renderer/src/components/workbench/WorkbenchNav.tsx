import { useT } from "../../i18n";
import { useKnowledgeStore } from "../../stores/knowledge";
import { useSessionsStore } from "../../stores/sessions";
import { useSettingsStore } from "../../stores/settings";
import { type AppView, useUiStore } from "../../stores/ui";
import {
	ComposeIcon,
	GearIcon,
	HelpIcon,
	ObsidianIcon,
	ProjectsIcon,
	SearchIcon,
	SubagentIcon,
} from "../icons";

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
 * 聊天 / 空间 / 研究工作台 / 知识库 是四个全屏视图；扩展 / 设置 / 帮助 走设置弹窗。
 */
export function WorkbenchNav() {
	const t = useT();
	const view = useUiStore((s) => s.view);
	const setView = useUiStore((s) => s.setView);
	const cwd = useSessionsStore((s) => s.cwd);
	const activeSessionId = useSessionsStore((s) => s.activeSessionId);
	const closeKnowledge = useKnowledgeStore((s) => s.close);
	const openKnowledge = useKnowledgeStore((s) => s.open);

	const select = (key: NavKey) => {
		if (key === "extensions") {
			useSettingsStore.getState().openWith("extensions");
			return;
		}
		if (key === "research" || key === "knowledge") {
			openKnowledge({ cwd, sessionId: activeSessionId, tab: key === "research" ? "overview" : "reviews" });
			return;
		}
		closeKnowledge();
		setView(key);
	};

	return (
		<aside className="workbench-nav" aria-label={t("workbench.nav.title")}>
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
			</nav>
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
