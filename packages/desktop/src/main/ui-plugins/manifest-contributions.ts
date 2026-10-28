import { KNOWN_UI_REGIONS, type UiPluginContribution } from "@drone/shared";

/**
 * 过滤 contributions：剔除未知 region 条目（scanAll 合成 info 与 readCode 返回的 manifest 都用这份），
 * 并把非 app.overlay 区域的 anchor 剥离（anchor 仅对 overlay 有意义）。
 * 非数组输入（坏插件可能给任意形状）一律空，防上层 for...of/条目访问抛错。
 */
export function filterContributions(
	contributions: UiPluginContribution[] | undefined,
): UiPluginContribution[] {
	if (!Array.isArray(contributions)) return [];
	const out: UiPluginContribution[] = [];
	for (const c of contributions) {
		if (!c || typeof c.region !== "string" || !KNOWN_UI_REGIONS.includes(c.region)) continue;
		out.push(c.region === "app.overlay" ? c : { ...c, anchor: undefined });
	}
	return out;
}
