import { commandForKey, cycleTab, DESKTOP_COMMAND_EVENT, type DesktopCommand } from "@drone/shared";
import { useEffect } from "react";
import { getPi } from "../api";
import { useSessionsStore } from "../stores/sessions";
import { useSettingsStore } from "../stores/settings";

/** 渲染层统一出口：任何来源的命令都变成 window CustomEvent。 */
export function dispatchDesktopCommand(command: DesktopCommand): void {
	window.dispatchEvent(new CustomEvent<DesktopCommand>(DESKTOP_COMMAND_EVENT, { detail: command }));
}

/** 订阅某个桌面命令；返回退订函数。 */
export function onDesktopCommand(command: DesktopCommand, handler: () => void): () => void {
	const listener = (event: Event) => {
		if ((event as CustomEvent<DesktopCommand>).detail === command) handler();
	};
	window.addEventListener(DESKTOP_COMMAND_EVENT, listener);
	return () => window.removeEventListener(DESKTOP_COMMAND_EVENT, listener);
}

/** 内建命令的默认处理：新任务 / 关闭标签 / 设置 / 切标签。search、send、find 由对应组件监听。 */
export function handleBuiltinCommand(command: DesktopCommand): boolean {
	const sessions = useSessionsStore.getState();
	switch (command) {
		case "new-task":
			sessions.createDraftSession(sessions.cwd ?? undefined);
			return true;
		case "close-tab":
			if (sessions.activeSessionId) void sessions.closeSession(sessions.activeSessionId);
			return true;
		case "settings":
			useSettingsStore.getState().setOpen(true);
			return true;
		case "prev-tab":
		case "next-tab": {
			const next = cycleTab(
				sessions.sessions.map((s) => s.sessionId),
				sessions.activeSessionId,
				command === "prev-tab" ? -1 : 1,
			);
			if (next && next !== sessions.activeSessionId) sessions.switchSession(next);
			return true;
		}
		default:
			return false;
	}
}

/** App 根挂一次：主进程菜单 IPC + 键盘快捷键 → desktop-command 总线 → 内建处理。 */
export function useDesktopCommands(): void {
	useEffect(() => {
		const pi = getPi();
		const isMac = pi.platform === "darwin";
		const offIpc = pi.onDesktopCommand?.((command) => dispatchDesktopCommand(command));
		const onKey = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.isComposing) return;
			const command = commandForKey(event, isMac);
			if (!command) return;
			event.preventDefault();
			dispatchDesktopCommand(command);
		};
		const onCommand = (event: Event) => handleBuiltinCommand((event as CustomEvent<DesktopCommand>).detail);
		window.addEventListener("keydown", onKey);
		window.addEventListener(DESKTOP_COMMAND_EVENT, onCommand);
		return () => {
			offIpc?.();
			window.removeEventListener("keydown", onKey);
			window.removeEventListener(DESKTOP_COMMAND_EVENT, onCommand);
		};
	}, []);
}
