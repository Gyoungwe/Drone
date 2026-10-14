import type { ComponentType, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useMemo, useRef } from "react";
import { useI18nStore, useT } from "../../i18n";
import { PluginBoundary } from "../../plugins/PluginBoundary";
import { EMPTY_CONTRIBUTIONS } from "../../plugins/RegionHost";
import { type Contribution, useUiPluginRegistry } from "../../plugins/registry";
import { UI_REGIONS } from "../../plugins/slots";
import { type SettingsCategory, useSettingsStore } from "../../stores/settings";
import { useUiPluginsStore } from "../../stores/ui-plugins";
import {
	DiffIcon,
	EditIcon,
	GearIcon,
	HelpIcon,
	ListIcon,
	ObsidianIcon,
	ProjectsIcon,
	PuzzleIcon,
	ShieldIcon,
	SubagentIcon,
	TaskBoardIcon,
	TestIcon,
	TimelineIcon,
	ZoteroIcon,
} from "../icons";
import { KnowledgePanel } from "../knowledge/KnowledgePanel";
import { ZoteroPanel } from "../knowledge/ZoteroPanel";
import { ComputePane } from "../panel/ComputePane";
import { AboutPanel } from "./AboutPanel";
import { AppearancePanel } from "./AppearancePanel";
import { ExtensionsPanel } from "./extensions/ExtensionsPanel";
import { GeneralPanel } from "./GeneralPanel";
import { LanObserverPanel } from "./LanObserverPanel";
import { McpPanel } from "./McpPanel";
import { PermissionsPanel } from "./PermissionsPanel";
import { ProvidersPanel } from "./providers/ProvidersPanel";
import { SkillsPanel } from "./SkillsPanel";
import { UiPluginsSection } from "./UiPluginsSection";
import { WorkflowOverviewPanel } from "./WorkflowOverview";

const STATIC_CATEGORIES = [
	"general",
	"permissions",
	"appearance",
	"models",
	"skills",
	"mcp",
	"zotero",
	"extensions",
	"about",
] as const satisfies readonly SettingsCategory[];

/** U7：主分类按「身份 / 能力 / 资源 / 通用」分组（组名小灰字）；顺序即导航顺序 */
const NAV_GROUPS: ReadonlyArray<{ id: string; items: readonly (typeof STATIC_CATEGORIES)[number][] }> = [
	{ id: "identity", items: ["models", "permissions"] },
	{ id: "capability", items: ["skills", "mcp", "extensions"] },
	{ id: "resource", items: ["zotero"] },
	{ id: "general", items: ["general", "appearance", "about"] },
];

/** 导航项图标 + 英文副标（中文界面下显示，ClawsGO 式「中文 English」） */
const NAV_META: Record<string, { icon: typeof GearIcon; en: string }> = {
	general: { icon: GearIcon, en: "General" },
	permissions: { icon: ShieldIcon, en: "Permissions" },
	appearance: { icon: EditIcon, en: "Appearance" },
	models: { icon: SubagentIcon, en: "Models" },
	skills: { icon: TaskBoardIcon, en: "Skills" },
	mcp: { icon: ListIcon, en: "MCP" },
	zotero: { icon: ZoteroIcon, en: "Zotero" },
	extensions: { icon: PuzzleIcon, en: "Extensions" },
	about: { icon: HelpIcon, en: "About" },
	knowledge: { icon: ObsidianIcon, en: "Knowledge" },
	lan: { icon: ProjectsIcon, en: "LAN" },
	uiPlugins: { icon: DiffIcon, en: "UI Plugins" },
	workflows: { icon: TimelineIcon, en: "Workflows" },
	compute: { icon: TestIcon, en: "SSH Hosts" },
};

function NavLabel({ id, label }: { id: string; label: string }) {
	const zh = useI18nStore((s) => s.language) === "zh";
	const meta = NAV_META[id];
	const Icon = meta?.icon ?? PuzzleIcon;
	return (
		<span className="flex min-w-0 items-center gap-2">
			<Icon size={14} className="shrink-0 text-ink-dim" />
			<span className="truncate">{label}</span>
			{zh && meta && label !== meta.en && (
				<span className="settings-nav-en truncate text-[11px] text-ink-faint">{meta.en}</span>
			)}
		</span>
	);
}

/** 「高级」分组：治理与维护类功能保留，但不出现在主流程分类里 */
const ADVANCED_CATEGORIES = [
	"knowledge",
	"lan",
	"uiPlugins",
	"workflows",
	"compute",
] as const satisfies readonly SettingsCategory[];

/** 面板注册表：新增分类 = 写一个面板组件 + 在这里登记（未登记显示 coming soon） */
const PANELS: Partial<Record<SettingsCategory, ComponentType>> = {
	general: GeneralPanel,
	permissions: PermissionsPanel,
	appearance: AppearancePanel,
	models: ProvidersPanel,
	skills: SkillsPanel,
	mcp: McpPanel,
	knowledge: KnowledgePanel,
	zotero: ZoteroPanel,
	extensions: ExtensionsPanel,
	lan: LanObserverPanel,
	uiPlugins: UiPluginsSection,
	workflows: WorkflowOverviewPanel,
	compute: ComputePane,
	about: AboutPanel,
};

/** settings.panel 贡献的分类 id：plugin:<pluginName>:<contributionId>（spec §17） */
function pluginCategoryId(pluginName: string, contributionId: string): SettingsCategory {
	return `plugin:${pluginName}:${contributionId}`;
}

/** 由分类 id 反查 settings.panel 贡献；非 plugin: 前缀或已不存在返回 null */
function findPluginContribution(category: SettingsCategory, list: Contribution[] | undefined) {
	if (!category.startsWith("plugin:")) return null;
	const rest = category.slice("plugin:".length);
	const sep = rest.indexOf(":");
	if (sep < 0) return null;
	const pluginName = rest.slice(0, sep);
	const contributionId = rest.slice(sep + 1);
	return list?.find((c) => c.pluginName === pluginName && c.id === contributionId) ?? null;
}

/** 设置弹窗：左侧分类导航 + 右侧内容，两列均可独立滚动；plugin 分类由 registry 动态拼接 */
export function SettingsDialog() {
	const t = useT();
	const open = useSettingsStore((s) => s.open);
	const setOpen = useSettingsStore((s) => s.setOpen);
	const category = useSettingsStore((s) => s.category);
	const setCategory = useSettingsStore((s) => s.setCategory);
	const closeButtonRef = useRef<HTMLButtonElement>(null);
	const previousFocusRef = useRef<HTMLElement | null>(null);
	useEffect(() => {
		if (!open) return;
		previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		closeButtonRef.current?.focus();
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				setOpen(false);
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("keydown", onKeyDown);
			previousFocusRef.current?.focus();
			previousFocusRef.current = null;
		};
	}, [open, setOpen]);

	// settings.panel 贡献：动态分类（插件停用/卸载即消失）；稳定引用（空用模块级 EMPTY）
	// 全局总开关关闭时隐藏插件分类（与 RegionHost 同一开关语义；当前正在看的分类回落 comingSoon 空态）
	const masterOn = useUiPluginsStore((s) => s.config.enabled);
	const registryCategories = useUiPluginRegistry((s) => s.contributions[UI_REGIONS.SettingsPanel]);
	const pluginCategories = masterOn ? (registryCategories ?? EMPTY_CONTRIBUTIONS) : EMPTY_CONTRIBUTIONS;
	// 贡献边界 key 带 loadNonce（与 RegionHost 一致）：热重载换新边界实例，settings.panel 贡献崩溃后可恢复
	const pluginNonces = useUiPluginRegistry((s) => s.loadNonces);

	const activePluginContribution = useMemo(
		() => findPluginContribution(category, pluginCategories),
		[category, pluginCategories],
	);
	const handleNavKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
		event.preventDefault();
		const nav = event.currentTarget.closest("nav");
		const items = nav ? Array.from(nav.querySelectorAll<HTMLButtonElement>("[data-settings-nav]")) : [];
		const index = items.indexOf(event.currentTarget);
		const delta = event.key === "ArrowUp" ? -1 : 1;
		const next = items[(index + delta + items.length) % items.length];
		next?.focus();
		next?.click();
	};

	if (!open) return null;

	const Panel = PANELS[category];
	const panelDescription = t(`settings.panelDescription.${category as "general"}`);

	return (
		<div
			className="settings-dialog-shell fixed inset-0 z-40 flex items-center justify-center bg-ink/20"
			role="dialog"
			aria-modal
			aria-labelledby="settings-dialog-title"
		>
			<div
				data-testid="settings-dialog"
				className="settings-dialog flex h-[min(74vh,720px)] max-h-[calc(100dvh-24px)] w-[min(900px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-dialog"
			>
				<div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
					<h2 id="settings-dialog-title" className="text-[13px] font-semibold text-ink">
						{t("settings.title")}
					</h2>
					<button
						ref={closeButtonRef}
						type="button"
						className="rounded-lg px-2 py-1 text-ink-faint transition-colors hover:bg-hover hover:text-ink-2"
						onClick={() => setOpen(false)}
						aria-label={t("common.close")}
					>
						✕
					</button>
				</div>
				<div className="flex min-h-0 flex-1">
					<nav className="w-36 shrink-0 scroll-fade overflow-y-auto border-r border-border p-1">
						{NAV_GROUPS.map((group, gi) => (
							<div key={group.id}>
								<p className={`mb-0.5 px-2 text-[11px] text-ink-faint ${gi ? "mt-3" : "mt-1"}`}>
									{t(`settings.navGroup.${group.id as "identity"}`)}
								</p>
								{group.items.map((id) => (
									<button
										key={id}
										type="button"
										id={`settings-nav-${id}`}
										data-settings-nav="true"
										aria-current={category === id ? "page" : undefined}
										aria-controls="settings-dialog-panel"
										onKeyDown={handleNavKeyDown}
										className={`settings-nav-item mb-0.5 w-full rounded-md px-2 py-2 text-left text-[12px] transition-colors ${
											category === id
												? "is-active bg-hover font-medium text-ink"
												: "text-ink-dim hover:bg-hover hover:text-ink"
										}`}
										onClick={() => setCategory(id)}
									>
										<NavLabel id={id} label={t(`settings.category.${id}`)} />
									</button>
								))}
							</div>
						))}
						<p className="mb-0.5 mt-3 px-2 text-[11px] text-ink-faint">{t("settings.category.advanced")}</p>
						{ADVANCED_CATEGORIES.map((id) => (
							<button
								key={id}
								type="button"
								id={`settings-nav-${id}`}
								data-settings-nav="true"
								aria-current={category === id ? "page" : undefined}
								aria-controls="settings-dialog-panel"
								onKeyDown={handleNavKeyDown}
								className={`settings-nav-item mb-0.5 w-full rounded-md px-2 py-2 text-left text-[12px] transition-colors ${
									category === id
										? "is-active bg-hover font-medium text-ink"
										: "text-ink-dim hover:bg-hover hover:text-ink"
								}`}
								onClick={() => setCategory(id)}
							>
								<NavLabel id={id} label={t(`settings.category.${id}`)} />
							</button>
						))}
						{/* 插件自带设置页分类：标题取 contribution.title（插件自定义字符串，不走宿主 i18n） */}
						{pluginCategories.map((c) => {
							const id = pluginCategoryId(c.pluginName, c.id);
							return (
								<button
									key={id}
									type="button"
									id={`settings-nav-${id}`}
									data-settings-nav="true"
									aria-current={category === id ? "page" : undefined}
									aria-controls="settings-dialog-panel"
									onKeyDown={handleNavKeyDown}
									className={`settings-nav-item mb-0.5 w-full rounded-md px-2 py-2 text-left text-[12px] transition-colors ${
										category === id
											? "is-active bg-hover font-medium text-ink"
											: "text-ink-dim hover:bg-hover hover:text-ink"
									}`}
									onClick={() => setCategory(id)}
								>
									<NavLabel id="plugin" label={c.title ?? c.pluginName} />
								</button>
							);
						})}
					</nav>
					<div
						id="settings-dialog-panel"
						className="settings-dialog-content min-w-0 flex-1 scroll-fade overflow-y-auto overflow-x-hidden px-3 py-2"
						role="tabpanel"
						aria-labelledby={`settings-nav-${category}`}
					>
						{Panel && (
							<header className="mb-4 flex items-start justify-between gap-4 border-b border-border pb-3">
								<div className="min-w-0">
									<h1 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">
										{t(`settings.category.${category as "general"}`)}
									</h1>
									<p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-ink-faint">
										{panelDescription}
									</p>
								</div>
							</header>
						)}
						{Panel ? (
							<Panel />
						) : activePluginContribution ? (
							// 插件设置页：包 PluginBoundary（崩溃 → null，与其他贡献同一套隔离语义）
							<PluginBoundary
								key={`${activePluginContribution.pluginName}:${activePluginContribution.id}:${
									pluginNonces[activePluginContribution.pluginName] ?? 0
								}`}
								pluginName={activePluginContribution.pluginName}
								label={category}
							>
								<activePluginContribution.component />
							</PluginBoundary>
						) : (
							<p className="py-8 text-center text-[13px] text-ink-faint">{t("settings.comingSoon")}</p>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
