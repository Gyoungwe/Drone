import { DESKTOP_COMMANDS, type DesktopCommand, IpcChannels } from "@drone/shared";
import type { MenuItemConstructorOptions } from "electron";

/**
 * 原生菜单模板（P5）。只在 macOS 安装（系统菜单栏，承担复制粘贴）；
 * Windows/Linux 保持无菜单，快捷键由渲染层 `commandForKey` 处理，避免出现 File/Edit 菜单栏。
 */
export function buildMenuTemplate(
	send: (command: DesktopCommand) => void,
	lang: "zh" | "en" = "zh",
	appName = "Drone",
): MenuItemConstructorOptions[] {
	const item = (command: DesktopCommand): MenuItemConstructorOptions[] =>
		DESKTOP_COMMANDS.filter((b) => b.menu && b.command === command).map((b) => ({
			label: b.label[lang],
			accelerator: b.accelerator,
			click: () => send(b.command),
		}));
	return [
		{
			label: appName,
			submenu: [
				{ role: "about" },
				{ type: "separator" },
				...item("settings"),
				{ type: "separator" },
				{ role: "hide" },
				{ role: "hideOthers" },
				{ role: "unhide" },
				{ type: "separator" },
				{ role: "quit" },
			],
		},
		{
			label: lang === "zh" ? "文件" : "File",
			submenu: [
				...item("new-task"),
				...item("search"),
				{ type: "separator" },
				...item("close-tab"),
				...item("prev-tab"),
				...item("next-tab"),
			],
		},
		{ role: "editMenu" },
		{ role: "viewMenu" },
		{ role: "windowMenu" },
	];
}

export const DESKTOP_COMMAND_CHANNEL = IpcChannels.DesktopCommand;
