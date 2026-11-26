import {
	type ConfiguredPackageInfo,
	DRONE_PLUGIN_METADATA,
	DRONE_PLUGIN_PACKAGE_NAMES,
	type HostPluginPackage,
	npmPackageName,
	type PiPluginSourceEntry,
	type RegistryPluginMetadata,
	type UiPluginInfo,
} from "@drone/shared";
import { useEffect, useMemo } from "react";
import { useT } from "../../i18n";
import { selectLifecycleReceipt, useCatalogStore } from "../../stores/catalog";
import { useSettingsStore } from "../../stores/settings";
import { useUiPluginsStore } from "../../stores/ui-plugins";
import { BrowseSection } from "../settings/extensions/BrowseSection";
import { LoadedSection } from "../settings/extensions/LoadedSection";
import { PackageLifecycleDetails } from "../settings/extensions/PackageLifecycleDetails";
import { Switch } from "../ui/Switch";
import { DronePackageRow, isBuiltinDronePackage, packageState } from "./DronePackageRow";

const packageNames = [...DRONE_PLUGIN_PACKAGE_NAMES];
const emptyConfigured: ConfiguredPackageInfo[] = [];
const emptyHosts: HostPluginPackage[] = [];

function packageEntry(
	packageName: (typeof DRONE_PLUGIN_PACKAGE_NAMES)[number],
	host?: HostPluginPackage,
	registry?: RegistryPluginMetadata | null,
): PiPluginSourceEntry {
	const metadata = DRONE_PLUGIN_METADATA[packageName as keyof typeof DRONE_PLUGIN_METADATA];
	const declared = host ? (host.manifestDeclared ? host : undefined) : (registry ?? undefined);
	const packageKind = host?.packageKind ?? registry?.packageKind ?? metadata?.packageKind ?? "pi";
	return {
		packageName,
		version: host?.version ?? registry?.version ?? metadata?.version,
		description: host?.description ?? registry?.description ?? metadata?.description,
		sources: ["drone"],
		packageKind,
		capabilities: declared?.capabilities ?? [],
		tools: declared?.tools ?? [],
		permissions: declared?.permissions,
		piExtensions: [],
		piSkills: [],
		piPrompts: [],
		uiContribution: packageKind === "desktop-ui",
		pluginApi: host?.pluginApi,
		piApiVersion: host?.piApiVersion,
		minHostVersion: host?.minHostVersion,
		hosts: host ? (host.manifestDeclared ? (host.hosts ?? []) : []) : (registry?.hosts ?? []),
		declarationSource: host ? "installed" : registry ? "registry" : "fallback",
		manifestDeclared: declared?.manifestDeclared === true,
	};
}

function configuredName(item: ConfiguredPackageInfo) {
	return npmPackageName(item.source) ?? item.source;
}

function usePluginInventory() {
	const configured = useCatalogStore((state) => state.configuredPackages) ?? emptyConfigured;
	const hosts = useSettingsStore((state) => state.hostPlugins) ?? emptyHosts;
	const uiPlugins = useUiPluginsStore((state) => state.plugins);
	const metadata = useCatalogStore((state) => state.pluginMetadata);
	const checkLatestVersions = useCatalogStore((state) => state.checkLatestVersions);
	const loadPluginMetadata = useCatalogStore((state) => state.loadPluginMetadata);
	const entries = useMemo(
		() =>
			packageNames.map((name) =>
				packageEntry(
					name,
					hosts.find((item) => item.name === name),
					metadata[name],
				),
			),
		[hosts, metadata],
	);
	const otherConfigured = configured.filter(
		(item) => !packageNames.some((name) => name === configuredName(item)),
	);
	const otherHosts = hosts.filter(
		(host) =>
			host.status !== "unavailable" &&
			!packageNames.some((name) => name === host.name) &&
			!configured.some((item) => configuredName(item) === host.name),
	);
	const installedNames = [
		...new Set<string>([
			...packageNames,
			...configured.map(configuredName),
			...otherHosts.map(({ name }) => name),
		]),
	]
		.filter((name) => !isBuiltinDronePackage(name))
		.sort()
		.join("|");
	useEffect(() => {
		if (installedNames) void checkLatestVersions(installedNames.split("|"));
	}, [checkLatestVersions, installedNames]);
	useEffect(() => {
		void loadPluginMetadata(packageNames);
	}, [loadPluginMetadata]);
	const orderedEntries = [...entries].sort((left, right) => {
		const rank = ({ packageName }: PiPluginSourceEntry) =>
			isBuiltinDronePackage(packageName)
				? 0
				: packageState(
							packageName,
							configured,
							hosts.find(({ name }) => name === packageName),
							uiPlugins,
						).installed
					? 1
					: 2;
		return rank(left) - rank(right);
	});
	return { orderedEntries, hosts, otherConfigured, otherHosts, uiPlugins };
}

function ConfiguredRow({ configured }: { configured: ConfiguredPackageInfo }) {
	const t = useT();
	const name = configuredName(configured);
	const receipt = useCatalogStore((state) => selectLifecycleReceipt(state, name, configured));
	return (
		<li className="flex items-start gap-3 py-3">
			<div className="min-w-0 flex-1">
				<p className="truncate text-sm font-medium text-ink">{name}</p>
				<PackageLifecycleDetails receipt={receipt} context="skillsConnections" />
			</div>
			<span className="shrink-0 text-xs text-ink-faint">
				{t("skillsConnections.installed")} · {configured.scope}
			</span>
		</li>
	);
}

function HostRow({ plugin }: { plugin: HostPluginPackage }) {
	const t = useT();
	return (
		<li className="flex items-center gap-3 py-3">
			<p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{plugin.name}</p>
			<span className={`shrink-0 text-xs ${plugin.status === "available" ? "text-ok" : "text-warn"}`}>
				{plugin.version} ·{" "}
				{t(
					plugin.status === "available"
						? "skillsConnections.pluginStatusAvailable"
						: "skillsConnections.pluginStatusConfigure",
				)}
			</span>
		</li>
	);
}

function DesktopUiRow({ plugin }: { plugin: UiPluginInfo }) {
	const t = useT();
	const setEnabled = useUiPluginsStore((state) => state.setPluginEnabled);
	return (
		<li className="flex items-center gap-3 py-3">
			<div className="min-w-0 flex-1">
				<p className="truncate text-sm font-medium text-ink">{plugin.displayName ?? plugin.name}</p>
				<p className="mt-1 text-xs text-ink-faint">Desktop UI</p>
			</div>
			<Switch
				checked={plugin.enabled}
				disabled={Boolean(plugin.invalidReason || plugin.buildError)}
				onCheckedChange={(enabled) => void setEnabled(plugin.name, enabled)}
				aria-label={t(plugin.enabled ? "skillsConnections.disable" : "skillsConnections.enable")}
			/>
		</li>
	);
}

function PluginsCard() {
	const t = useT();
	const { orderedEntries, hosts, otherConfigured, otherHosts, uiPlugins } = usePluginInventory();
	return (
		<section className="rounded-2xl border border-border bg-surface px-4 py-4" data-testid="plugins-card">
			<h2 className="text-sm font-semibold text-ink">{t("skillsConnections.pluginsCardTitle")}</h2>
			<p className="mt-1 text-xs text-ink-dim">{t("skillsConnections.pluginsCardHint")}</p>
			<ul className="mt-2 divide-y divide-border">
				{orderedEntries.map((entry) => (
					<DronePackageRow
						key={entry.packageName}
						entry={entry}
						host={hosts.find((item) => item.name === entry.packageName)}
					/>
				))}
				{otherConfigured.map((item) => (
					<ConfiguredRow key={`${item.source}:${item.scope}`} configured={item} />
				))}
				{otherHosts.map((plugin) => (
					<HostRow key={`host:${plugin.name}`} plugin={plugin} />
				))}
				{uiPlugins.map((plugin) => (
					<DesktopUiRow key={`ui:${plugin.name}`} plugin={plugin} />
				))}
			</ul>
		</section>
	);
}

export function PluginSourcesSection() {
	const t = useT();
	return (
		<div className="space-y-5" data-testid="plugin-sources-section">
			<PluginsCard />
			<details className="rounded-2xl border border-border bg-surface px-4 py-4">
				<summary className="cursor-pointer text-sm font-medium text-ink">
					{t("settings.extensions.tab.loaded")}
				</summary>
				<p className="mt-2 text-xs text-ink-dim">
					{t("pluginSandbox.title")} · {t("pluginSandbox.networkPermission")}
				</p>
				<LoadedSection />
			</details>
			<section className="rounded-2xl border border-border bg-surface px-4 py-4">
				<h2 className="text-sm font-medium text-ink">{t("skillsConnections.piMarket")}</h2>
				<p className="mt-1 text-xs text-ink-dim">{t("skillsConnections.piMarketHint")}</p>
				<div className="mt-3">
					<BrowseSection extensionsOnly excludePackageNames={packageNames} />
				</div>
			</section>
		</div>
	);
}
