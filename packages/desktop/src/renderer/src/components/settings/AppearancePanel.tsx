import type { ThemeMode } from "@drone/shared";
import { useState } from "react";
import { useT } from "../../i18n";
import { backgroundImageUrl, useThemeStore } from "../../stores/theme";
import { useUiPreferencesStore } from "../../stores/ui-preferences";
import { Switch } from "../ui/Switch";
import { SettingsRow } from "./SettingsRow";
import { UiPluginsSection } from "./UiPluginsSection";

const THEME_MODES: ThemeMode[] = ["light", "dark", "system"];
const THEME_LABEL_KEYS = {
	light: "settings.themeLight",
	dark: "settings.themeDark",
	system: "settings.themeSystem",
} as const;

type AppearanceTab = "basics" | "uiPlugins";

const APPEARANCE_TABS = [
	{ id: "basics", labelKey: "settings.appearance.tabBasics" },
	{ id: "uiPlugins", labelKey: "settings.appearance.tabUiPlugins" },
] as const;

/** 基础子页：主题模式 + 自定义背景图（选图/清除/遮罩浓度）+ 两个界面开关 */
function AppearanceBasics() {
	const t = useT();
	const mode = useThemeStore((s) => s.mode);
	const setMode = useThemeStore((s) => s.setMode);
	const background = useThemeStore((s) => s.background);
	const pickBackground = useThemeStore((s) => s.pickBackground);
	const clearBackground = useThemeStore((s) => s.clearBackground);
	const setBackgroundDim = useThemeStore((s) => s.setBackgroundDim);
	const sessionRailEnabled = useUiPreferencesStore((s) => s.sessionRailEnabled);
	const setSessionRailEnabled = useUiPreferencesStore((s) => s.setSessionRailEnabled);
	const centerOrbEnabled = useUiPreferencesStore((s) => s.centerOrbEnabled);
	const setCenterOrbEnabled = useUiPreferencesStore((s) => s.setCenterOrbEnabled);

	return (
		<div className="settings-rows">
			<div className="settings-row">
				<div className="min-w-0">
					<h3 className="settings-row-title">{t("settings.theme")}</h3>
					<p className="settings-row-hint" title={t("settings.themeHint")}>
						{t("settings.themeHint")}
					</p>
				</div>
				<div className="flex shrink-0 gap-1.5">
					{THEME_MODES.map((m) => (
						<button
							key={m}
							type="button"
							className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
								mode === m
									? "border-ink bg-ink text-on-ink"
									: "border-border text-ink-2 hover:border-border-strong hover:bg-hover"
							}`}
							onClick={() => setMode(m)}
						>
							{t(THEME_LABEL_KEYS[m])}
						</button>
					))}
				</div>
			</div>
			<div className="settings-row settings-row-column">
				<div className="flex items-center justify-between gap-4">
					<div className="min-w-0">
						<h3 className="settings-row-title">{t("settings.background")}</h3>
						<p className="settings-row-hint" title={t("settings.backgroundHint")}>
							{t("settings.backgroundHint")}
						</p>
					</div>
					<div className="flex shrink-0 items-center gap-2">
						{background.image ? (
							<img
								src={backgroundImageUrl(background.image)}
								alt=""
								className="h-10 w-16 rounded-md border border-border object-cover"
							/>
						) : (
							<div className="flex h-10 w-16 items-center justify-center rounded-md border border-dashed border-border text-[10px] text-ink-faint">
								—
							</div>
						)}
						<div className="flex gap-1.5">
							<button
								type="button"
								className="rounded-md border border-border px-2 py-1 text-[11px] text-ink-2 transition-colors hover:border-border-strong hover:bg-hover"
								onClick={() => void pickBackground()}
							>
								{t(background.image ? "settings.backgroundChange" : "settings.backgroundPick")}
							</button>
							{background.image && (
								<button
									type="button"
									className="rounded-md px-2 py-1 text-[11px] text-red-500 transition-colors hover:bg-red-50"
									onClick={clearBackground}
								>
									{t("settings.backgroundClear")}
								</button>
							)}
						</div>
					</div>
				</div>
				{background.image && (
					<div className="settings-row-sub mt-2 flex items-center gap-2">
						<span className="w-16 shrink-0 text-[10px] text-ink-dim">{t("settings.backgroundDim")}</span>
						<input
							type="range"
							min={20}
							max={100}
							value={Math.round(background.dim * 100)}
							onChange={(e) => setBackgroundDim(Number(e.target.value) / 100)}
							className="h-1 flex-1 accent-[#7c3aed]"
							aria-label={t("settings.backgroundDim")}
						/>
						<span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-ink-dim">
							{Math.round(background.dim * 100)}%
						</span>
					</div>
				)}
			</div>
			<SettingsRow title={t("settings.sessionRail")} hint={t("settings.sessionRailHint")}>
				<Switch checked={sessionRailEnabled} onCheckedChange={setSessionRailEnabled} />
			</SettingsRow>
			<SettingsRow title={t("settings.centerOrb")} hint={t("settings.centerOrbHint")}>
				<Switch checked={centerOrbEnabled} onCheckedChange={setCenterOrbEnabled} />
			</SettingsRow>
		</div>
	);
}

/**
 * 外观面板：顶部 Tab 分栏（设计稿 .local/design/ux/appearance-ui-plugins）
 * 「基础」= 内置外观设置；「UI 插件」= 替换内置组件的插件管理（原独立设置分类并入）。
 * Tab 是面板内临时视图（内存态），每次打开设置默认落在「基础」。
 */
export function AppearancePanel() {
	const t = useT();
	const [tab, setTab] = useState<AppearanceTab>("basics");

	return (
		<div>
			<div className="flex gap-4 border-b border-border px-0.5 pt-0.5">
				{APPEARANCE_TABS.map((tabDef) => (
					<button
						key={tabDef.id}
						type="button"
						className={`relative -mb-px border-b-2 px-0.5 pb-2 pt-1 text-[12px] transition-colors ${
							tab === tabDef.id
								? "border-ink font-medium text-ink"
								: "border-transparent text-ink-faint hover:text-ink-2"
						}`}
						onClick={() => setTab(tabDef.id)}
					>
						{t(tabDef.labelKey)}
					</button>
				))}
			</div>
			<div className="pt-3">{tab === "basics" ? <AppearanceBasics /> : <UiPluginsSection />}</div>
		</div>
	);
}
