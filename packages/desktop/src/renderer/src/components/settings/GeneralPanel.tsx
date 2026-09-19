import type { ContextManagerMode } from "@drone/shared";
import type { Language } from "../../i18n";
import { useI18nStore, useT } from "../../i18n";
import { useSettingsStore } from "../../stores/settings";
import { Switch } from "../ui/Switch";
import { SettingsRow } from "./SettingsRow";

const CONTEXT_MANAGER_MODES: ContextManagerMode[] = ["evaporation", "off"];

/** 通用设置面板：语言选择 + 上下文管理二态 + channel-watch 开关 */
export function GeneralPanel() {
	const t = useT();
	const language = useI18nStore((s) => s.language);
	const setLanguage = useI18nStore((s) => s.setLanguage);
	const contextManagerMode = useSettingsStore((s) => s.contextManagerMode);
	const setContextManagerMode = useSettingsStore((s) => s.setContextManagerMode);
	const channelWatchEnabled = useSettingsStore((s) => s.channelWatchEnabled);
	const setChannelWatchEnabled = useSettingsStore((s) => s.setChannelWatchEnabled);

	return (
		<div className="settings-rows">
			<SettingsRow title={t("settings.language")} hint={t("settings.languageHint")}>
				<div className="flex gap-1.5">
					{(["zh", "en"] as Language[]).map((lang) => (
						<button
							key={lang}
							type="button"
							className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
								language === lang
									? "border-ink bg-ink text-on-ink"
									: "border-border text-ink-2 hover:border-border-strong hover:bg-hover"
							}`}
							onClick={() => setLanguage(lang)}
						>
							{t(`lang.${lang}`)}
						</button>
					))}
				</div>
			</SettingsRow>
			<SettingsRow
				title={t("settings.contextManager")}
				hint={contextManagerMode ? t(`settings.contextManagerHint.${contextManagerMode}`) : undefined}
			>
				<div className="flex gap-1.5">
					{CONTEXT_MANAGER_MODES.map((mode) => (
						<button
							key={mode}
							type="button"
							disabled={contextManagerMode === null}
							className={`rounded-md border px-2 py-1 text-[11px] transition-colors disabled:opacity-50 ${
								contextManagerMode === mode
									? "border-ink bg-ink text-on-ink"
									: "border-border text-ink-2 hover:border-border-strong hover:bg-hover"
							}`}
							onClick={() => void setContextManagerMode(mode)}
						>
							{t(`settings.contextManagerMode.${mode}`)}
						</button>
					))}
				</div>
			</SettingsRow>
			<SettingsRow title={t("settings.channelWatch")} hint={t("settings.channelWatchHint")}>
				<Switch
					checked={channelWatchEnabled === true}
					disabled={channelWatchEnabled === null}
					onCheckedChange={(enabled) => void setChannelWatchEnabled(enabled)}
				/>
			</SettingsRow>
			<details className="settings-disclosure" data-testid="ssh-guard-card" aria-labelledby="ssh-guard-title">
				<summary className="settings-disclosure-summary">
					<div className="min-w-0">
						<h3 id="ssh-guard-title" className="settings-row-title">
							{t("settings.sshGuard.title")}
						</h3>
						<p className="settings-row-hint" title={t("settings.sshGuard.description")}>
							{t("settings.sshGuard.description")}
						</p>
					</div>
					<div className="flex shrink-0 items-center gap-1.5">
						<span className="inline-flex items-center gap-1.5 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium text-ink-dim">
							<span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden="true" />
							{t("settings.sshGuard.enabled")}
						</span>
						<span className="settings-disclosure-chevron" aria-hidden="true">
							⌄
						</span>
					</div>
				</summary>
				<div className="settings-disclosure-body">
					<dl className="settings-disclosure-grid">
						<div className="min-w-0">
							<dt className="text-ink-faint">{t("settings.sshGuard.approvalLabel")}</dt>
							<dd className="mt-0.5 text-ink-dim">{t("settings.sshGuard.approval")}</dd>
						</div>
						<div className="min-w-0">
							<dt className="text-ink-faint">{t("settings.sshGuard.keysLabel")}</dt>
							<dd className="mt-0.5 text-ink-dim">{t("settings.sshGuard.keys")}</dd>
						</div>
						<div className="min-w-0">
							<dt className="text-ink-faint">{t("settings.sshGuard.scopeLabel")}</dt>
							<dd className="mt-0.5 text-ink-dim">{t("settings.sshGuard.scope")}</dd>
						</div>
					</dl>
					<p className="settings-disclosure-hint">{t("settings.sshGuard.defaultHint")}</p>
				</div>
			</details>
		</div>
	);
}
