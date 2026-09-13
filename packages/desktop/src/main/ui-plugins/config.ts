import { join } from "node:path";
import { createLogger, JsonStore } from "@percho/backend";
import type { UiPluginsConfig } from "@percho/shared";
import { app } from "electron";
import { applyUiPluginsPatch, defaultUiPluginsConfig, normalizeUiPluginsConfig } from "./config-merge";

export { applyUiPluginsPatch, defaultUiPluginsConfig, normalizeUiPluginsConfig };

const log = createLogger("ui-plugins-config");

function uiPluginsConfigPath(): string {
	return join(app.getPath("userData"), "ui-plugins.json");
}

function configStore(): JsonStore<Partial<UiPluginsConfig> | null> {
	return new JsonStore<Partial<UiPluginsConfig> | null>({
		path: uiPluginsConfigPath(),
		defaultValue: () => null,
	});
}

/** 读取持久化配置；文件缺失/损坏返回默认（不是 null：配置损坏不应阻塞插件系统） */
export async function loadUiPluginsConfig(): Promise<UiPluginsConfig> {
	const parsed = await configStore().read();
	return normalizeUiPluginsConfig(parsed ?? {});
}

/**
 * 持久化配置（与现有内容合并后原子写，调用方传补丁即可）。
 * 失败不吞（log 后重抛）：IPC handler 已 await 落盘才返回/推 config 事件，
 * reject 后 renderer 收到失败、不再误推成功事件。
 */
export async function saveUiPluginsConfig(patch: Partial<UiPluginsConfig>): Promise<void> {
	try {
		// 单次 update：读改写整体在 per-path 队列内串行（handler 并发调用不互相覆盖）；
		// 损坏拒写抛 CorruptedError（原为读损坏回退默认后照样覆盖写 = 自愈但静默丢数据）
		await configStore().update((draft) => applyUiPluginsPatch(draft, patch));
	} catch (err) {
		log.error("ui-plugins config save failed", err);
		throw err;
	}
}
