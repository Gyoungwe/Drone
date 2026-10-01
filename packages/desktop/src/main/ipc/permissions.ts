import { existsSync } from "node:fs";
import { dirname } from "node:path";
import type { BackendServices, PiBackend } from "@drone/backend";
import { IpcChannels, PermissionsContract } from "@drone/shared";
import { shell } from "electron";
import { bindContract, type ContractImplementation } from "./bind-contract";

/**
 * 设置 → 权限 面板：编辑全局 permissions.json。读 / 校验 / 原子写 / 试算 / 审计尾部全在 backend
 * （permissions/settings.ts），这里只透传 + 用 shell 定位文件（不存在时打开所在目录）。
 */
export function registerPermissionSettingsIpc(backendOrServices: PiBackend | BackendServices): void {
	const backend = "sessions" in backendOrServices ? backendOrServices.sessions : backendOrServices;
	const permissions = "sessions" in backendOrServices ? backendOrServices.permissions : backend.permissions;
	const implementation: ContractImplementation<typeof PermissionsContract> = {
		load: () => permissions.getSettings(),
		save: (input) => permissions.saveSettings(input),
		reset: () => permissions.resetSettings(),
		probe: (input) => permissions.probe(input),
		auditTail: (...args) => permissions.getAuditTail(...args),
		respondAsk: (requestId, response) => backend.respondAsk(requestId, response),
		respondPermission: async (requestId, answer) => {
			await backend.respondPermission(requestId, answer);
		},
		getConfig: () => permissions.getConfig(),
		getMode: (sessionId) => backend.getSessionPermissionMode(sessionId),
		setMode: (sessionId, mode) => backend.setSessionPermissionMode(sessionId, mode),
		contextManagerGetConfig: () => backend.getContextManagerConfig(),
		contextManagerSetMode: (mode) => backend.setContextManagerMode(mode),
		channelWatchGetConfig: () => backend.getChannelWatchConfig(),
		channelWatchSetEnabled: (enabled) => backend.setChannelWatchEnabled(enabled),
		respondTrust: (requestId, answer) => backend.respondTrust(requestId, answer),
		openLocation: async () => {
			const { path } = permissions.getSettings();
			if (existsSync(path)) {
				shell.showItemInFolder(path);
				return;
			}
			const error = await shell.openPath(dirname(path));
			if (error) throw new Error(error);
		},
	};
	bindContract(PermissionsContract, implementation, {
		channelForMethod: (_contract, method) =>
			({
				load: IpcChannels.PermissionSettingsLoad,
				save: IpcChannels.PermissionSettingsSave,
				reset: IpcChannels.PermissionSettingsReset,
				probe: IpcChannels.PermissionSettingsProbe,
				auditTail: IpcChannels.PermissionSettingsAuditTail,
				respondAsk: IpcChannels.AskRespond,
				respondPermission: IpcChannels.PermissionRespond,
				getConfig: IpcChannels.PermissionGetConfig,
				getMode: IpcChannels.PermissionGetMode,
				setMode: IpcChannels.PermissionSetMode,
				contextManagerGetConfig: IpcChannels.ContextManagerGetConfig,
				contextManagerSetMode: IpcChannels.ContextManagerSetMode,
				channelWatchGetConfig: IpcChannels.ChannelWatchGetConfig,
				channelWatchSetEnabled: IpcChannels.ChannelWatchSetEnabled,
				respondTrust: IpcChannels.TrustRespond,
				openLocation: IpcChannels.PermissionSettingsOpenLocation,
			})[method as keyof typeof PermissionsContract.methods],
	});
}
