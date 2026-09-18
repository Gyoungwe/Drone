import { useState } from "react";
import { useT } from "../../i18n";
import { useKnowledgeStore } from "../../stores/knowledge";
import { useSessionsStore } from "../../stores/sessions";
import { useSettingsStore } from "../../stores/settings";
import { useUiStore } from "../../stores/ui";
import {
	ComposeIcon,
	GearIcon,
	HelpIcon,
	ObsidianIcon,
	SearchIcon,
	SubagentIcon,
	TaskBoardIcon,
} from "../icons";

type NavKey = "chat" | "research" | "knowledge" | "tools" | "extensions";

const navItems: {
	key: NavKey;
	icon: typeof ComposeIcon;
	label: "chat" | "research" | "knowledge" | "tools" | "extensions";
}[] = [
	{ key: "chat", icon: ComposeIcon, label: "chat" },
	{ key: "research", icon: SearchIcon, label: "research" },
	{ key: "knowledge", icon: ObsidianIcon, label: "knowledge" },
	{ key: "tools", icon: TaskBoardIcon, label: "tools" },
	{ key: "extensions", icon: SubagentIcon, label: "extensions" },
];

/** Sunburst 风格的工作区导航：入口都落到现有页面或设置，不制造新的空路由。 */
export function WorkbenchNav() {
	const t = useT();
	const cwd = useSessionsStore((s) => s.cwd);
	const activeSessionId = useSessionsStore((s) => s.activeSessionId);
	const currentModel = useSessionsStore((s) => s.currentModel);
	const setView = useUiStore((s) => s.setView);
	const toggleTaskSidebar = useUiStore((s) => s.toggleTaskSidebar);
	const [selected, setSelected] = useState<NavKey>("chat");

	const select = (key: NavKey) => {
		setSelected(key);
		if (key === "chat") {
			setView("chat");
			return;
		}
		if (key === "research" || key === "knowledge") {
			setView("chat");
			useKnowledgeStore.getState().open({
				cwd,
				sessionId: activeSessionId,
				tab: key === "research" ? "overview" : "reviews",
			});
			return;
		}
		if (key === "tools") {
			setView("chat");
			toggleTaskSidebar();
			return;
		}
		useSettingsStore.getState().openWith("extensions");
	};

	return (
		<aside
			className="workbench-nav hidden shrink-0 border-r border-border bg-surface/90 lg:flex"
			aria-label={t("workbench.nav.title")}
		>
			<div className="flex min-h-0 w-[184px] flex-1 flex-col px-2.5 py-3">
				<nav className="space-y-1" aria-label={t("workbench.nav.title")}>
					{navItems.map(({ key, icon: Icon, label }) => (
						<button
							key={key}
							type="button"
							className={`workbench-nav-item ${selected === key ? "is-active" : ""}`}
							onClick={() => select(key)}
							aria-current={selected === key ? "page" : undefined}
						>
							<Icon size={15} />
							<span>{t(`workbench.nav.${label}`)}</span>
						</button>
					))}
				</nav>

				<div className="mt-auto space-y-1 border-t border-border pt-3">
					<button
						type="button"
						className="workbench-nav-item"
						onClick={() => useSettingsStore.getState().openWith("general")}
					>
						<GearIcon size={15} />
						<span>{t("workbench.nav.settings")}</span>
					</button>
					<button
						type="button"
						className="workbench-nav-item"
						onClick={() => useSettingsStore.getState().openWith("about")}
					>
						<HelpIcon size={15} />
						<span>{t("workbench.nav.help")}</span>
					</button>
					<div className="workbench-agent-status mt-3">
						<div className="flex items-center gap-2 text-[11px] font-medium text-ink">
							<span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
							{t("workbench.agentReady")}
						</div>
						<p
							className="mt-1 truncate text-[10px] text-ink-dim"
							title={currentModel ? `${currentModel.provider}/${currentModel.modelId}` : undefined}
						>
							{currentModel ? currentModel.modelId : t("workbench.modelNotSelected")}
						</p>
					</div>
				</div>
			</div>
		</aside>
	);
}
