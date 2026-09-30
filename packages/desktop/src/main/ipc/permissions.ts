import { existsSync } from "node:fs";
import { dirname } from "node:path";
import type { PiBackend } from "@drone/backend";
import { IpcChannels, PermissionsContract } from "@drone/shared";
import { ipcMain, shell } from "electron";
import { bindContract, type ContractImplementation } from "./bind-contract";

/**
 * 设置 → 权限 面板：编辑全局 permissions.json。读 / 校验 / 原子写 / 试算 / 审计尾部全在 backend
 * （permissions/settings.ts），这里只透传 + 用 shell 定位文件（不存在时打开所在目录）。
 */
export function registerPermissionSettingsIpc(backend: PiBackend): void {
	const implementation: ContractImplementation<typeof PermissionsContract> = {
		load: () => backend.getPermissionSettings(),
		save: (input) => backend.savePermissionSettings(input),
		reset: () => backend.resetPermissionSettings(),
		probe: (input) => backend.probePermission(input),
		auditTail: (...args) => backend.getPermissionAuditTail(...args),
	};
	bindContract(PermissionsContract, implementation, {
		channelForMethod: (_contract, method) =>
			({
				load: IpcChannels.PermissionSettingsLoad,
				save: IpcChannels.PermissionSettingsSave,
				reset: IpcChannels.PermissionSettingsReset,
				probe: IpcChannels.PermissionSettingsProbe,
				auditTail: IpcChannels.PermissionSettingsAuditTail,
			})[method as keyof typeof PermissionsContract.methods],
	});
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
