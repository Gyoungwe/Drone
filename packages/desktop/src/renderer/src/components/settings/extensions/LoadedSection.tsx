import { useMemo } from "react";
import { useT } from "../../../i18n";
import { useCatalogStore } from "../../../stores/catalog";
import { useSettingsStore } from "../../../stores/settings";
import { StatePanel } from "../../ui/StatePanel";
import { ExtensionRow } from "./rows";

/** 已加载：当前项目（活跃会话）加载的扩展及其注册的工具/命令 */
export function LoadedSection() {
	const t = useT();
	const extensions = useSettingsStore((s) => s.extensions);
	const errors = useSettingsStore((s) => s.extensionErrors);
	const configuredPackages = useCatalogStore((s) => s.configuredPackages);

	// 已加载扩展的 source 命中已配置包 → 可卸载（source 为 npm:/git: 等安装源时）
	const configuredBySource = useMemo(() => {
		const map = new Map<string, { source: string; scope: "user" | "project" }>();
		for (const p of configuredPackages ?? []) {
			if (!map.has(p.source)) map.set(p.source, { source: p.source, scope: p.scope });
		}
		return map;
	}, [configuredPackages]);

	if (extensions === null) {
		return <StatePanel title={t("settings.extensions.emptyNoSession")} />;
	}
	return (
		<div>
			{extensions.length === 0 && errors.length === 0 ? (
				<StatePanel title={t("settings.extensions.empty")} />
			) : (
				<ul className="divide-y divide-border">
					{extensions.map((extension) => (
						<ExtensionRow
							key={extension.path}
							extension={extension}
							configured={configuredBySource.get(extension.source) ?? null}
						/>
					))}
				</ul>
			)}
			{errors.length > 0 && (
				<div className="mt-4 rounded-lg bg-err/10 px-3 py-2">
					<p className="text-xs font-medium text-err">
						{t("settings.extensions.loadErrors", { count: errors.length })}
					</p>
					<ul className="mt-1 space-y-1">
						{errors.map((err) => (
							<li key={err.path} className="text-xs leading-relaxed text-err">
								<span className="font-mono">{err.path}</span> — {err.error}
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}
