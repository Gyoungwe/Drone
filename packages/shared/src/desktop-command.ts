/**
 * 桌面命令总线（P5）：主进程原生菜单 / 渲染层快捷键都归一成 DesktopCommand，
 * 渲染层以 window CustomEvent `drone:desktop-command` 分发，各组件按需监听。
 */
export type DesktopCommand =
	| "search"
	| "new-task"
	| "close-tab"
	| "settings"
	| "prev-tab"
	| "next-tab"
	| "send"
	| "find";

export const DESKTOP_COMMAND_EVENT = "drone:desktop-command";

export interface DesktopCommandBinding {
	command: DesktopCommand;
	/** Electron accelerator（主进程菜单用） */
	accelerator: string;
	/** 菜单里出现；send / find 只在渲染层生效 */
	menu: boolean;
	label: { zh: string; en: string };
}

export const DESKTOP_COMMANDS: readonly DesktopCommandBinding[] = [
	{ command: "search", accelerator: "CmdOrCtrl+K", menu: true, label: { zh: "搜索", en: "Search" } },
	{ command: "new-task", accelerator: "CmdOrCtrl+N", menu: true, label: { zh: "新任务", en: "New task" } },
	{
		command: "close-tab",
		accelerator: "CmdOrCtrl+W",
		menu: true,
		label: { zh: "关闭标签", en: "Close tab" },
	},
	{ command: "settings", accelerator: "CmdOrCtrl+,", menu: true, label: { zh: "设置…", en: "Settings…" } },
	{
		command: "prev-tab",
		accelerator: "CmdOrCtrl+Shift+[",
		menu: true,
		label: { zh: "上一个标签", en: "Previous tab" },
	},
	{
		command: "next-tab",
		accelerator: "CmdOrCtrl+Shift+]",
		menu: true,
		label: { zh: "下一个标签", en: "Next tab" },
	},
	{ command: "send", accelerator: "CmdOrCtrl+Enter", menu: false, label: { zh: "发送", en: "Send" } },
	{ command: "find", accelerator: "CmdOrCtrl+F", menu: false, label: { zh: "查找", en: "Find" } },
];

export function isDesktopCommand(value: unknown): value is DesktopCommand {
	return typeof value === "string" && DESKTOP_COMMANDS.some((b) => b.command === value);
}

export interface KeyLike {
	key: string;
	code?: string;
	metaKey: boolean;
	ctrlKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
}

/**
 * 键盘事件 → 命令。mac 用 ⌘，其他平台用 Ctrl。
 * `menuHandled` 为 true 时（mac 有原生菜单）跳过菜单已注册的组合，避免触发两次。
 */
export function commandForKey(e: KeyLike, isMac: boolean, menuHandled = isMac): DesktopCommand | null {
	const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
	if (!mod || e.altKey) return null;
	const key = e.key.toLowerCase();
	let command: DesktopCommand | null = null;
	if (!e.shiftKey) {
		if (key === "enter") command = "send";
		else if (key === "f") command = "find";
		else if (key === "k") command = "search";
		else if (key === "n") command = "new-task";
		else if (key === "w") command = "close-tab";
		else if (key === ",") command = "settings";
	} else if (key === "[" || key === "{" || e.code === "BracketLeft") command = "prev-tab";
	else if (key === "]" || key === "}" || e.code === "BracketRight") command = "next-tab";
	if (!command) return null;
	if (menuHandled && DESKTOP_COMMANDS.find((b) => b.command === command)?.menu) return null;
	return command;
}

/** 在标签序列里循环取上一 / 下一个。 */
export function cycleTab(ids: readonly string[], current: string | null, dir: 1 | -1): string | null {
	if (!ids.length) return null;
	const index = current ? ids.indexOf(current) : -1;
	if (index < 0) return ids[0] ?? null;
	return ids[(index + dir + ids.length) % ids.length] ?? null;
}
