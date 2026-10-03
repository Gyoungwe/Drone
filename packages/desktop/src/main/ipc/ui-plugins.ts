import { IpcChannels, KNOWN_UI_SLOTS, type UiPluginsConfig, UiPluginsContract } from "@drone/shared";
import { shell } from "electron";
import { loadUiPluginsConfig } from "../ui-plugins/config";
import type { UiPluginManager } from "../ui-plugins/manager";
import { bindContract, type ContractImplementation } from "./bind-contract";
import { sendToRenderer } from "./index";

/** 配置类变更（总开关/启用/指派）→ 通知 renderer 全量对齐 */
function pushConfigEvent(): void {
	sendToRenderer(IpcChannels.UiPluginsEvent, { kind: "config" });
}

/**
 * UI 插件域：配置读写 / 列表 / 构建 / 代码读取 / 目录打开。
 * 安全细则（spec §9）：readCode/openDir 只接受 manager 白名单内的合法插件名（禁路径）；
 * 所有参数做类型检查，非法直接 return。
 */
export function registerUiPluginsIpc(manager: UiPluginManager): void {
	const implementation: ContractImplementation<typeof UiPluginsContract> = {
		getConfig: () => loadUiPluginsConfig(),
		setEnabled: async (enabled) => {
			// await 落盘后才返回：renderer 的 invoke → loadAll 读到的是写入后的最新配置
			await manager.updateConfig({ enabled });
			pushConfigEvent();
		},
		list: () => manager.list(),
		readCode: (name) => manager.readCode(name),
		// 启用=信任：enabled=true 时 trusted 一并落盘
		setPluginEnabled: async (name, enabled) => {
			if (typeof name !== "string" || typeof enabled !== "boolean") {
				throw new Error("invalid plugin enable arguments");
			}
			if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
				throw new Error(`invalid plugin name: ${name}`);
			}
			const info = manager.info(name);
			if (enabled && info?.invalidReason) {
				throw new Error(info.invalidReason);
			}
			const config = await loadUiPluginsConfig();
			const prev = config.plugins[name];
			const patch: Partial<UiPluginsConfig> = {
				plugins: {
					...config.plugins,
					[name]: { enabled, trusted: enabled ? true : (prev?.trusted ?? false) },
				},
			};
			await manager.updateConfig(patch);
			pushConfigEvent();
		},
		assignSlot: async (slot, pluginName) => {
			if (!KNOWN_UI_SLOTS.includes(slot)) return;
			const config = await loadUiPluginsConfig();
			const assignments = { ...config.assignments };
			if (pluginName === null) delete assignments[slot];
			else assignments[slot] = pluginName;
			await manager.updateConfig({ assignments });
			pushConfigEvent();
		},
		rebuild: async (name) => {
			const ok = await manager.ensureBuilt(name, true);
			if (!ok) {
				const info = manager.info(name);
				return { ok: false as const, error: info?.buildError ?? "构建失败" };
			}
			// 重建成功 → 通知 renderer 重载该插件（旧代码立即替换）
			sendToRenderer(IpcChannels.UiPluginsEvent, { kind: "changed", name });
			return { ok: true as const };
		},
		openDir: (...args) => {
			const name = args[0];
			const dir = typeof name === "string" ? manager.pluginDirOf(name) : manager.rootDir();
			if (!dir) return;
			void shell.openPath(dir);
		},
	};
	bindContract(UiPluginsContract, implementation, {
		channelForMethod: (_contract, method) =>
			({
				getConfig: IpcChannels.UiPluginsGetConfig,
				setEnabled: IpcChannels.UiPluginsSetEnabled,
				list: IpcChannels.UiPluginsList,
				readCode: IpcChannels.UiPluginsReadCode,
				setPluginEnabled: IpcChannels.UiPluginsSetPluginEnabled,
				assignSlot: IpcChannels.UiPluginsAssignSlot,
				rebuild: IpcChannels.UiPluginsRebuild,
				openDir: IpcChannels.UiPluginsOpenDir,
			})[method as keyof typeof UiPluginsContract.methods],
	});
}
