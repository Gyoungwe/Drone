import { getPi } from "../../api";
import { useT } from "../../i18n";
import { useDesktopPrefsStore } from "../../stores/desktop-prefs";
import { Switch } from "../ui/Switch";
import { SettingsRow } from "./SettingsRow";

/** 桌面端设置（P11）：通知、提示音、登录时启动、菜单栏图标、下载位置。软件更新入口保持在「关于」不动。 */
export function DesktopSettings() {
	const t = useT();
	const prefs = useDesktopPrefsStore((s) => s.prefs);
	const update = useDesktopPrefsStore((s) => s.update);
	const pickDir = async () => {
		const dir = await getPi()
			.pickDownloadDir()
			.catch(() => null);
		if (dir) update({ downloadDir: dir });
	};
	return (
		<>
			<SettingsRow title={t("settings.desktop.notify")} hint={t("settings.desktop.notifyHint")}>
				<Switch
					checked={prefs.notifyInBackground}
					onCheckedChange={(v) => update({ notifyInBackground: v })}
				/>
			</SettingsRow>
			<SettingsRow title={t("settings.desktop.sound")} hint={t("settings.desktop.soundHint")}>
				<Switch checked={prefs.completionSound} onCheckedChange={(v) => update({ completionSound: v })} />
			</SettingsRow>
			<SettingsRow title={t("settings.desktop.login")} hint={t("settings.desktop.loginHint")}>
				<Switch checked={prefs.openAtLogin} onCheckedChange={(v) => update({ openAtLogin: v })} />
			</SettingsRow>
			<SettingsRow title={t("settings.desktop.tray")} hint={t("settings.desktop.trayHint")}>
				<Switch checked={prefs.menuBarIcon} onCheckedChange={(v) => update({ menuBarIcon: v })} />
			</SettingsRow>
			<SettingsRow
				title={t("settings.desktop.download")}
				hint={prefs.downloadDir ?? t("settings.desktop.downloadDefault")}
			>
				<div className="flex gap-2">
					<button
						type="button"
						className="rounded-md border border-border px-2 py-1 text-xs hover:bg-hover"
						onClick={() => void pickDir()}
					>
						{t("settings.desktop.downloadPick")}
					</button>
					{prefs.downloadDir && (
						<button
							type="button"
							className="rounded-md border border-border px-2 py-1 text-xs hover:bg-hover"
							onClick={() => update({ downloadDir: null })}
						>
							{t("settings.desktop.downloadReset")}
						</button>
					)}
				</div>
			</SettingsRow>
		</>
	);
}
