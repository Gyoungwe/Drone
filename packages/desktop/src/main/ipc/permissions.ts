import { existsSync } from "node:fs";
import { dirname } from "node:path";
import type { PiBackend } from "@drone/backend";
import type { PermissionProbeInput, PermissionSettingsSaveInput } from "@drone/shared";
import { IpcChannels } from "@drone/shared";
import { ipcMain, shell } from "electron";

/**
 * 设置 → 权限 面板：编辑全局 permissions.json。读 / 校验 / 原子写 / 试算 / 审计尾部全在 backend
 * （permissions/settings.ts），这里只透传 + 用 shell 定位文件（不存在时打开所在目录）。
 */
export function registerPermissionSettingsIpc(backend: PiBackend): void {
	ipcMain.handle(IpcChannels.PermissionSettingsLoad, () => backend.getPermissionSettings());
	ipcMain.handle(IpcChannels.PermissionSettingsSave, (_e, input: PermissionSettingsSaveInput) =>
		backend.savePermissionSettings(input),
	);
	ipcMain.handle(IpcChannels.PermissionSettingsReset, () => backend.resetPermissionSettings());
	ipcMain.handle(IpcChannels.PermissionSettingsProbe, (_e, input: PermissionProbeInput) =>
		backend.probePermission(input),
	);
	ipcMain.handle(IpcChannels.PermissionSettingsAuditTail, (_e, limit?: number) =>
		backend.getPermissionAuditTail(limit),
	);
	ipcMain.handle(IpcChannels.PermissionSettingsOpenLocation, async () => {
		const { path } = backend.getPermissionSettings();
		if (existsSync(path)) {
			shell.showItemInFolder(path);
			return;
		}
		const error = await shell.openPath(dirname(path));
		if (error) throw new Error(error);
	});
}
