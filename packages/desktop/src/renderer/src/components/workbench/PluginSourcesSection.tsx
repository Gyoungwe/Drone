import {
	DRONE_PLUGIN_METADATA,
	DRONE_PLUGIN_PACKAGE_NAMES,
	type HostPluginPackage,
	MARKET_RESOURCE_LINKS,
	type PiPluginSourceEntry,
} from "@drone/shared";
import { useMemo } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";
import { useCatalogStore } from "../../stores/catalog";
import { useSettingsStore } from "../../stores/settings";
import { useUiPluginsStore } from "../../stores/ui-plugins";
import { BrowseSection } from "../settings/extensions/BrowseSection";
import { Switch } from "../ui/Switch";

function packageEntry(packageName: string, host?: HostPluginPackage): PiPluginSourceEntry {
	const metadata = DRONE_PLUGIN_METADATA[packageName as keyof typeof DRONE_PLUGIN_METADATA];
	return {
		packageName,
		version: host?.version ?? metadata?.version,
		description: host?.description ?? metadata?.description,
		sources: ["drone"],
		packageKind:
			host?.packageKind ??
			metadata?.packageKind ??
			(packageName === "@gyoungwe/desktop-ui-pack" ? "desktop-ui" : "pi"),
		capabilities: host?.capabilities ?? metadata?.capabilities ?? [],
		piExtensions: [],
		piSkills: [],
		piPrompts: [],
		uiContribution: packageName === "@gyoungwe/desktop-ui-pack",
		pluginApi: host?.pluginApi,
		piApiVersion: host?.piApiVersion,
		minHostVersion: host?.minHostVersion,
		hosts: host?.hosts ?? [],
	};
}

function packageState(
	entry: PiPluginSourceEntry,
	configured: readonly { source: string; scope: "user" | "project" }[],
	host?: HostPluginPackage,
	uiPlugins: readonly { name: string; builtin?: boolean }[] = [],
): { installed: boolean; builtin: boolean; configured?: { source: string; scope: "user" | "project" } } {
	const configuredItem = configured.find(
		(item) =>
			item.source === `npm:${entry.packageName}` || item.source.startsWith(`npm:${entry.packageName}@`),
	);
	const ui =
		entry.packageName === "@gyoungwe/desktop-ui-pack"
			? uiPlugins.find((item) => item.name === "drone-research-ui")
			: undefined;
	return {
		installed: Boolean(configuredItem || host?.status === "available" || ui),
		builtin: ui?.builtin === true,
		configured: configuredItem,
	};
}

function DronePackageRow({ entry, host }: { entry: PiPluginSourceEntry; host?: HostPluginPackage }) {
	const t = useT();
	const configured = useCatalogStore((state) => state.configuredPackages) ?? [];
	const uiPlugins = useUiPluginsStore((state) => state.plugins);
	const setPluginEnabled = useUiPluginsStore((state) => state.setPluginEnabled);
	const install = useCatalogStore((state) => state.installCatalogPackage);
	const update = useCatalogStore((state) => state.updateCatalogPackage);
	const remove = useCatalogStore((state) => state.removeConfiguredPackage);
	const installing = useCatalogStore((state) => state.installingNames[entry.packageName] === true);
	const updating = useCatalogStore((state) => state.updatingNames[entry.packageName] === true);
	const removing = useCatalogStore((state) =>
		Object.keys(state.removingSources).some(
			(source) => source === `npm:${entry.packageName}` || source.startsWith(`npm:${entry.packageName}@`),
		),
	);
	const current = packageState(entry, configured, host, uiPlugins);
	const uiPlugin =
		entry.packageName === "@gyoungwe/desktop-ui-pack"
			? uiPlugins.find((item) => item.name === "drone-research-ui")
			: undefined;
	return (
		<li className="rounded-xl border border-border px-3 py-3">
			<div className="flex items-start gap-3">
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<strong className="truncate text-xs text-ink">{entry.packageName}</strong>
						<span className="rounded-full bg-highlight px-2 py-0.5 text-[10px] text-ink-2">
							{t("skillsConnections.dronePlugin")}
						</span>
						{entry.uiContribution && (
							<span className="rounded-full bg-hover px-2 py-0.5 text-[10px] text-ink-faint">Desktop UI</span>
						)}
					</div>
					<p className="mt-1 text-[11px] leading-relaxed text-ink-dim">
						{entry.description ?? t("skillsConnections.pluginDescription")}
					</p>
					<p className="mt-1 text-[11px] text-ink-faint">
						v{entry.version ?? "?"} · {entry.capabilities.join(" · ") || "Pi package"}
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<span className={`text-[11px] ${current.installed ? "text-ok" : "text-ink-faint"}`}>
						{current.installed ? t("skillsConnections.installed") : t("skillsConnections.notInstalled")}
					</span>
					{uiPlugin ? (
						<Switch
							checked={uiPlugin.enabled}
							disabled={Boolean(uiPlugin.invalidReason || uiPlugin.buildError)}
							onCheckedChange={(enabled) => void setPluginEnabled(uiPlugin.name, enabled)}
							aria-label={uiPlugin.enabled ? t("skillsConnections.disable") : t("skillsConnections.enable")}
						/>
					) : current.installed && current.configured && !current.builtin ? (
						<>
							<button
								type="button"
								className="rounded-full border border-border px-2 py-1 text-[11px] text-ink-2 hover:bg-hover disabled:opacity-60"
								disabled={updating || removing}
								onClick={() => void update(entry.packageName)}
							>
								{updating ? t("skillsConnections.updating") : t("skillsConnections.update")}
							</button>
							<button
								type="button"
								className="rounded-full border border-border px-2 py-1 text-[11px] text-ink-2 hover:bg-hover disabled:opacity-60"
								disabled={removing}
								onClick={() => {
									if (current.configured) void remove(current.configured.source, current.configured.scope);
								}}
							>
								{removing ? t("skillsConnections.removing") : t("skillsConnections.uninstall")}
							</button>
						</>
					) : !current.installed ? (
						<button
							type="button"
							className="rounded-full bg-ink px-2 py-1 text-[11px] text-canvas hover:opacity-90 disabled:opacity-60"
							disabled={installing}
							onClick={() => void install(entry.packageName)}
						>
							{installing ? t("skillsConnections.installing") : t("skillsConnections.install")}
						</button>
					) : null}
				</div>
			</div>
		</li>
	);
}

export function PluginSourcesSection() {
	const t = useT();
	const configured = useCatalogStore((state) => state.configuredPackages);
	const hostPlugins = useSettingsStore((state) => state.hostPlugins) ?? [];
	const uiPlugins = useUiPluginsStore((state) => state.plugins);
	const entries = useMemo(
		() =>
			DRONE_PLUGIN_PACKAGE_NAMES.map((name) =>
				packageEntry(
					name,
					hostPlugins.find((item) => item.name === name),
				),
			),
		[hostPlugins],
	);
	const packageNames = useMemo(() => entries.map((entry) => entry.packageName), [entries]);
	return (
		<div className="space-y-5" data-testid="plugin-sources-section">
			<section className="rounded-2xl border border-border bg-surface px-4 py-4">
				<div className="flex flex-wrap items-baseline justify-between gap-2">
					<div>
						<h2 className="text-sm font-medium text-ink">{t("skillsConnections.piMarket")}</h2>
						<p className="mt-1 text-xs text-ink-dim">{t("skillsConnections.piMarketHint")}</p>
					</div>
					<span className="rounded-full bg-hover px-2 py-1 text-[10px] text-ink-faint">extension</span>
				</div>
				<div className="mt-3">
					<BrowseSection extensionsOnly excludePackageNames={packageNames} />
				</div>
			</section>
			<section className="rounded-2xl border border-border bg-surface px-4 py-4">
				<h2 className="text-sm font-medium text-ink">{t("skillsConnections.marketResources")}</h2>
				<p className="mt-1 text-xs leading-relaxed text-ink-dim">
					{t("skillsConnections.marketResourcesHint")}
				</p>
				<ul className="mt-3 grid gap-2 md:grid-cols-2">
					{MARKET_RESOURCE_LINKS.map((resource) => (
						<li key={resource.id} className="rounded-xl border border-border px-3 py-3">
							<div className="flex items-start justify-between gap-2">
								<div className="min-w-0">
									<p className="truncate text-xs font-medium text-ink">{resource.name}</p>
									<p className="mt-1 truncate text-[11px] text-ink-faint">github.com/{resource.repository}</p>
								</div>
								<span className="shrink-0 rounded-full bg-hover px-2 py-1 text-[10px] text-ink-faint">
									{t(`skillsConnections.marketResourceKind.${resource.kind}` as never)}
								</span>
							</div>
							<p className="mt-2 text-[11px] leading-relaxed text-ink-dim">{resource.description}</p>
							<button
								type="button"
								className="mt-2 text-[11px] text-accent hover:underline"
								onClick={() => void getPi().openExternal(resource.url)}
							>
								{t("skillsConnections.openRepository")}
							</button>
						</li>
					))}
				</ul>
			</section>
			<section className="rounded-2xl border border-border bg-surface px-4 py-4">
				<h2 className="text-sm font-medium text-ink">{t("skillsConnections.droneRegistry")}</h2>
				<p className="mt-1 text-xs text-ink-dim">{t("skillsConnections.droneRegistryHint")}</p>
				<ul className="mt-3 space-y-2">
					{entries.map((entry) => (
						<DronePackageRow
							key={entry.packageName}
							entry={entry}
							host={hostPlugins.find((item) => item.name === entry.packageName)}
						/>
					))}
				</ul>
			</section>
			<section className="rounded-2xl border border-border bg-surface px-4 py-4">
				<h2 className="text-sm font-medium text-ink">{t("skillsConnections.installedPlugins")}</h2>
				<p className="mt-1 text-xs text-ink-dim">{t("skillsConnections.installedPluginsHint")}</p>
				{configured?.length || hostPlugins.length || uiPlugins.length ? (
					<ul className="mt-3 divide-y divide-border text-xs">
						{configured?.map((item) => (
							<li
								key={`${item.source}:${item.scope}`}
								className="flex items-center justify-between gap-3 py-2"
							>
								<span className="truncate text-ink-2">{item.source}</span>
								<span className="shrink-0 text-[11px] text-ink-faint">{item.scope}</span>
							</li>
						))}
						{hostPlugins.map((plugin) => (
							<li key={`host:${plugin.name}`} className="flex items-center justify-between gap-3 py-2">
								<span className="truncate text-ink-2">{plugin.name}</span>
								<span
									className={`shrink-0 text-[11px] ${plugin.status === "available" ? "text-ok" : "text-warn"}`}
								>
									{plugin.version} · {plugin.status}
								</span>
							</li>
						))}
						{uiPlugins.map((plugin) => (
							<li key={`ui:${plugin.name}`} className="flex items-center justify-between gap-3 py-2">
								<span className="truncate text-ink-2">{plugin.displayName ?? plugin.name}</span>
								<span className="shrink-0 text-[11px] text-ink-faint">Desktop UI</span>
							</li>
						))}
					</ul>
				) : (
					<p className="mt-3 text-xs text-ink-faint">{t("skillsConnections.noInstalledPlugins")}</p>
				)}
			</section>
		</div>
	);
}
