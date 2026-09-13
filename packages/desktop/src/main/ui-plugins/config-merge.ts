import type { UiPluginsConfig } from "@percho/shared";

/** 配置损坏/缺失时返回的默认值（首次发布保守默认：总开关关、无插件、无指派） */
export function defaultUiPluginsConfig(): UiPluginsConfig {
	return { enabled: false, plugins: {}, assignments: {} };
}

/** 字段校验 + 默认值填充（未知字段丢弃；enabled/trusted 必须 boolean 否则归默认） */
export function normalizeUiPluginsConfig(parsed: Partial<UiPluginsConfig>): UiPluginsConfig {
	const plugins: UiPluginsConfig["plugins"] = {};
	if (parsed.plugins && typeof parsed.plugins === "object") {
		for (const [name, p] of Object.entries(parsed.plugins)) {
			if (!p || typeof p !== "object") continue;
			plugins[name] = {
				enabled: typeof p.enabled === "boolean" ? p.enabled : false,
				trusted: typeof p.trusted === "boolean" ? p.trusted : false,
			};
		}
	}
	const assignments: UiPluginsConfig["assignments"] = {};
	if (parsed.assignments && typeof parsed.assignments === "object") {
		for (const [slot, name] of Object.entries(parsed.assignments)) {
			if (typeof name === "string") assignments[slot] = name;
		}
	}
	return {
		enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : false,
		plugins,
		assignments,
	};
}

/**
 * 合并配置补丁：plugins 按名深合并（避免浅合并整表覆盖丢掉已启用项）；
 * assignments 若传入则整体替换；其余字段补丁覆盖。
 */
export function applyUiPluginsPatch(
	draft: Partial<UiPluginsConfig> | null | undefined,
	patch: Partial<UiPluginsConfig>,
): UiPluginsConfig {
	const base = draft ?? {};
	const plugins: UiPluginsConfig["plugins"] = {
		...(base.plugins && typeof base.plugins === "object" ? base.plugins : {}),
		...(patch.plugins && typeof patch.plugins === "object" ? patch.plugins : {}),
	};
	const next: Partial<UiPluginsConfig> = {
		...base,
		...patch,
		plugins,
	};
	if (patch.assignments !== undefined) next.assignments = patch.assignments;
	return normalizeUiPluginsConfig(next);
}
