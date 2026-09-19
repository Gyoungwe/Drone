import type { ComponentType } from "react";
import { useUiPluginsStore } from "../stores/ui-plugins";
import { PluginBoundary } from "./PluginBoundary";
import { EMPTY_CONTRIBUTIONS } from "./RegionHost";
import { type Contribution, useUiPluginRegistry } from "./registry";
import { pluginTabId, type RegionName } from "./slots";

/** 一个贡献型页签 / 视图条目（挂钩 4：panel.tab / rail.view） */
export interface PluginEntry {
	id: string;
	pluginName: string;
	title: string;
	contribution: Contribution;
}

/** 某区域（panel.tab / rail.view）当前可用的条目：总开关关 → 空。 */
export function usePluginEntries(region: RegionName): PluginEntry[] {
	const list = useUiPluginRegistry((s) => s.contributions[region]) ?? EMPTY_CONTRIBUTIONS;
	const masterOn = useUiPluginsStore((s) => s.config.enabled);
	if (!masterOn || list.length === 0) return EMPTY_ENTRIES;
	return list.map((c) => ({
		id: pluginTabId(c.pluginName, c.id),
		pluginName: c.pluginName,
		title: c.title || c.id,
		contribution: c,
	}));
}
const EMPTY_ENTRIES: PluginEntry[] = [];

export const isPluginEntryId = (value: string | null | undefined): boolean => !!value?.startsWith("plugin:");

/** 渲染一个贡献条目（外包错误边界；崩溃 → null，与 RegionHost 同语义） */
export function PluginEntryHost({ entry }: { entry: PluginEntry }) {
	const nonce = useUiPluginRegistry((s) => s.loadNonces[entry.pluginName] ?? 0);
	const Comp = entry.contribution.component as ComponentType<Record<string, never>>;
	return (
		<div key={`${entry.id}:${nonce}`} data-plugin={entry.pluginName} className="min-h-0 min-w-0 flex-1">
			<PluginBoundary pluginName={entry.pluginName} label={entry.id}>
				<Comp />
			</PluginBoundary>
		</div>
	);
}
