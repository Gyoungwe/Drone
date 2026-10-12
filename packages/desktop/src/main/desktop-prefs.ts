import {
	DEFAULT_DESKTOP_PREFS,
	type DesktopPrefs,
	loginItemSettings,
	needsTray,
	normalizeDesktopPrefs,
} from "@drone/shared";

export interface TrayHandle {
	destroy(): void;
}

export interface DesktopPrefsHost {
	platform: string;
	launchedHidden: boolean;
	setLoginItemSettings(settings: ReturnType<typeof loginItemSettings>): void;
	createTray(): TrayHandle;
}

let current: DesktopPrefs = DEFAULT_DESKTOP_PREFS;
let tray: TrayHandle | null = null;

export function currentDesktopPrefs(): DesktopPrefs {
	return current;
}

/** 应用偏好到系统：登录项（只在打包版设置，开发态会把 electron 本体注册进去）、托盘。 */
export function applyDesktopPrefs(raw: unknown, host: DesktopPrefsHost, packaged: boolean): DesktopPrefs {
	const prev = current;
	current = normalizeDesktopPrefs(raw);
	if (
		packaged &&
		(host.platform === "darwin" || host.platform === "win32") &&
		prev.openAtLogin !== current.openAtLogin
	)
		host.setLoginItemSettings(loginItemSettings(current));
	const wantTray = needsTray(current, host.launchedHidden);
	if (wantTray && !tray) tray = host.createTray();
	else if (!wantTray && tray) {
		tray.destroy();
		tray = null;
	}
	return current;
}

/** 测试用 */
export function resetDesktopPrefsForTest(): void {
	current = DEFAULT_DESKTOP_PREFS;
	tray = null;
}
