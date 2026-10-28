import { IpcChannels, KNOWN_UI_SLOTS, type UiPluginsConfig, UiPluginsContract } from "@drone/shared";
import { shell } from "electron";
import { loadUiPluginsConfig } from "../ui-plugins/config";
import type { UiPluginManager } from "../ui-plugins/manager";
import type { DesktopRuntimeBridge } from "../ui-plugins/runtime-bridge";
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
export function registerUiPluginsIpc(manager: UiPluginManager, runtime: DesktopRuntimeBridge): void {
	const changeConfiguration = async <T>(action: () => Promise<T>): Promise<T> => {
		try {
			return await runtime.withUiTransition(action);
		} finally {
			// Failed persistence still drained old clients. Reload the configuration that actually survived.
			pushConfigEvent();
		}
	};
	const implementation = (
		event: import("electron").IpcMainInvokeEvent,
	): ContractImplementation<typeof UiPluginsContract> => ({
		getConfig: () => loadUiPluginsConfig(),
		setEnabled: async (enabled) => {
			await changeConfiguration(() => manager.updateConfig({ enabled }));
		},
		list: () => manager.list(),
		readCode: async (name) => {
			if (!manager.isEnabled(name)) return { error: "UI plugin is not enabled and trusted" };
			const directory = manager.pluginDirOf(name);
			const source = manager.runtimeSource(name);
			const code = await manager.readCode(name);
			if ("error" in code) return code;
			if (directory !== manager.pluginDirOf(name) || source !== manager.runtimeSource(name)) {
				return { error: "UI plugin installation changed while loading; reload required" };
			}
			const runtimeBinding = await runtime.bind(name, event.sender);
			return { ...code, ...(runtimeBinding === undefined ? {} : { runtimeBinding }) };
		},
		// 启用=信任：enabled=true 时 trusted 一并落盘
		setPluginEnabled: async (name, enabled) => {
			if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
				throw new Error(`invalid plugin name: ${name}`);
			}
			const info = manager.info(name);
			if (enabled && info?.invalidReason) {
				throw new Error(info.invalidReason);
			}
			await changeConfiguration(async () => {
				const config = await loadUiPluginsConfig();
				const prev = config.plugins[name];
				const patch: Partial<UiPluginsConfig> = {
					plugins: {
						...config.plugins,
						[name]: { enabled, trusted: enabled ? true : (prev?.trusted ?? false) },
					},
				};
				await manager.updateConfig(patch);
			});
		},
		assignSlot: async (slot, pluginName) => {
			if (!KNOWN_UI_SLOTS.includes(slot)) return;
			await changeConfiguration(async () => {
				const config = await loadUiPluginsConfig();
				const assignments = { ...config.assignments };
				if (pluginName === null) delete assignments[slot];
				else assignments[slot] = pluginName;
				await manager.updateConfig({ assignments });
			});
		},
		rebuild: async (name) => {
			const ok = await changeConfiguration(() => manager.ensureBuilt(name, true));
			if (!ok) {
				const info = manager.info(name);
				return { ok: false as const, error: info?.buildError ?? "构建失败" };
			}
			return { ok: true as const };
		},
		openDir: (...args) => {
			const name = args[0];
			const dir = typeof name === "string" ? manager.pluginDirOf(name) : manager.rootDir();
			if (!dir) return;
			void shell.openPath(dir);
		},
	});
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
