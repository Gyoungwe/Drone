/**
 * 桌面端偏好（P11）：通知、提示音、登录时启动（只开托盘，配合 P20）、菜单栏图标、下载位置。
 * 存在 UiState.desktop 里，随 saveUiState 浅合并持久化。
 */
export interface DesktopPrefs {
	/** 窗口不在前台时，回合完成 / 需要确认时发系统通知 */
	notifyInBackground: boolean;
	/** 回合完成提示音 */
	completionSound: boolean;
	/** 登录时启动（隐藏窗口，只开托盘） */
	openAtLogin: boolean;
	/** 菜单栏 / 系统托盘图标 */
	menuBarIcon: boolean;
	/** 下载默认目录；null = 系统「下载」 */
	downloadDir: string | null;
}

export const DEFAULT_DESKTOP_PREFS: DesktopPrefs = {
	notifyInBackground: true,
	completionSound: false,
	openAtLogin: false,
	menuBarIcon: false,
	downloadDir: null,
};

/** 旧文件缺字段 / 类型不对时回落默认值，保证读出来的永远是完整对象。 */
export function normalizeDesktopPrefs(raw: unknown): DesktopPrefs {
	const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	const bool = (k: keyof DesktopPrefs) =>
		typeof r[k] === "boolean" ? (r[k] as boolean) : (DEFAULT_DESKTOP_PREFS[k] as boolean);
	return {
		notifyInBackground: bool("notifyInBackground"),
		completionSound: bool("completionSound"),
		openAtLogin: bool("openAtLogin"),
		menuBarIcon: bool("menuBarIcon"),
		downloadDir: typeof r.downloadDir === "string" && r.downloadDir.trim() ? r.downloadDir : null,
	};
}

export const HIDDEN_LAUNCH_ARG = "--hidden";

/** Electron setLoginItemSettings 参数；登录启动一律隐藏窗口（macOS openAsHidden，Windows 用启动参数）。 */
export function loginItemSettings(prefs: DesktopPrefs): {
	openAtLogin: boolean;
	openAsHidden: boolean;
	args: string[];
} {
	return {
		openAtLogin: prefs.openAtLogin,
		openAsHidden: prefs.openAtLogin,
		args: prefs.openAtLogin ? [HIDDEN_LAUNCH_ARG] : [],
	};
}

/** 登录启动且要求隐藏时只开托盘：托盘必须存在，否则用户找不到应用。 */
export function needsTray(prefs: DesktopPrefs, launchedHidden: boolean): boolean {
	return prefs.menuBarIcon || launchedHidden;
}

export type CompletionKind = "done" | "error" | "ask";

export function shouldNotify(prefs: DesktopPrefs, windowFocused: boolean): boolean {
	return prefs.notifyInBackground && !windowFocused;
}

export function shouldPlaySound(prefs: DesktopPrefs, kind: CompletionKind): boolean {
	return prefs.completionSound && kind !== "ask";
}
