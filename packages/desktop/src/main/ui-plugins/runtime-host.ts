import { createProcessPluginRuntime, hostText, type SessionServicePort } from "@drone/backend";
import { BrowserWindow, dialog, webContents } from "electron";
import type { UiPluginManager } from "./manager";
import { DesktopRuntimeBridge } from "./runtime-bridge";

/** The host asks before the worker imports code; UI trust alone grants no Node privileges. */
export function createDesktopRuntime(
	manager: UiPluginManager,
	runtimeDirectory: string,
	sessions: Pick<SessionServicePort, "getPluginCallerContext">,
): DesktopRuntimeBridge {
	return new DesktopRuntimeBridge({
		source: (name) => manager.runtimeSource(name),
		getSessionContext: (sessionId) => sessions.getPluginCallerContext(sessionId),
		enabled: (name) => manager.isEnabled(name),
		factory: (source) => createProcessPluginRuntime({ ...source, runtimeDirectory }),
		approve: async (owner, source, operation) => {
			const contents = webContents.fromId(owner.id);
			if (!contents || contents.isDestroyed()) return false;
			const window = BrowserWindow.fromWebContents(contents);
			if (!window) return false;
			const response = await dialog.showMessageBox(window, {
				type: "question",
				title: hostText("插件后台权限", "Plugin runtime permission"),
				message: operation
					? hostText(
							`允许 ${source.pluginId} 执行 ${operation}？`,
							`Allow ${source.pluginId} to execute ${operation}?`,
						)
					: hostText(
							`启动 ${source.pluginId} 的桌面后台？`,
							`Start the desktop runtime for ${source.pluginId}?`,
						),
				detail: hostText(
					"后台在独立进程中运行，只能读取自身包文件；不能联网、写文件、创建子进程或读取宿主凭据。停用或关闭窗口会撤销访问。",
					"The runtime runs in a separate process with read access to its own package only. Network, file writes, child processes and host credentials are unavailable. Disabling the plugin or closing the window revokes access.",
				),
				buttons: [hostText("拒绝", "Deny"), hostText("允许", "Allow")],
				defaultId: 0,
				cancelId: 0,
			});
			return response.response === 1 && !contents.isDestroyed();
		},
	});
}
