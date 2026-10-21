import {
	compareVersions,
	DRONE_BUILTIN_PLUGIN_PACKAGE_NAMES,
	DRONE_PLUGIN_METADATA,
	DRONE_PLUGIN_PACKAGE_NAMES,
	type HostPluginPackage,
	type PiPluginSourceEntry,
} from "@drone/shared";
import { useEffect, useMemo } from "react";
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
		tools: host?.tools ?? metadata?.tools ?? [],
		permissions: host?.permissions ?? metadata?.permissions,
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

function isBuiltinDronePackage(packageName: string): boolean {
	return DRONE_BUILTIN_PLUGIN_PACKAGE_NAMES.includes(
		packageName as (typeof DRONE_BUILTIN_PLUGIN_PACKAGE_NAMES)[number],
	);
}

function OperationProgress({ label }: { label: string }) {
	return (
		<div className="mt-2 flex items-center gap-2" role="progressbar" aria-label={label}>
			<div className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-hover">
				<div className="h-full w-1/2 animate-pulse rounded-full bg-accent" />
			</div>
			<span className="text-[10px] text-ink-faint">{label}</span>
		</div>
	);
}

function configuredPackageName(source: string): string {
	const value = source.replace(/^npm:/u, "");
	const match = value.match(/^(@[^/]+\/[^@]+|[^@]+)(?:@.+)?$/u);
	return match?.[1] ?? value;
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
		installed: Boolean(
			isBuiltinDronePackage(entry.packageName) || configuredItem || host?.status === "available" || ui,
		),
		builtin: isBuiltinDronePackage(entry.packageName) || ui?.builtin === true,
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
	const current = packageState(entry, configured, host, uiPlugins);
	const latest = useCatalogStore((state) => state.latestVersions[entry.packageName]) ?? null;
	const installedVersion = host?.version ?? entry.version ?? "?";
	const hasUpdate = Boolean(
		current.installed && latest && installedVersion !== "?" && compareVersions(latest, installedVersion) > 0,
	);
	const installing = useCatalogStore((state) => state.installingNames[entry.packageName] === true);
	const updating = useCatalogStore((state) => state.updatingNames[entry.packageName] === true);
	const installError = useCatalogStore((state) => state.installErrors[entry.packageName]);
	const updateError = useCatalogStore((state) => state.updateErrors[entry.packageName]);
	const removing = useCatalogStore((state) =>
		Object.keys(state.removingSources).some(
			(source) => source === `npm:${entry.packageName}` || source.startsWith(`npm:${entry.packageName}@`),
		),
	);
	const removeError = useCatalogStore((state) =>
		current.configured ? state.removeErrors[current.configured.source] : undefined,
	);
	const lifecycle = useCatalogStore(
		(state) => state.lifecycleReceipts[current.configured?.source ?? entry.packageName],
	);
	const uiPlugin =
		entry.packageName === "@gyoungwe/desktop-ui-pack"
			? uiPlugins.find((item) => item.name === "drone-research-ui")
			: undefined;
	return (
		<li className="py-3">
			<div className="flex items-start gap-3">
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<strong className="truncate text-sm font-medium text-ink">{entry.packageName}</strong>
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
					<p className="mt-1 text-[11px] text-ink-faint">
						{t("skillsConnections.declaredTools")}:{" "}
						{entry.tools.length ? entry.tools.join(", ") : t("skillsConnections.undeclaredTools")}
						{" · "}
						{t("skillsConnections.declaredPermissions")}:{" "}
						{entry.permissions
							? JSON.stringify(entry.permissions)
							: t("skillsConnections.undeclaredPermissions")}
					</p>
					{installError && (
						<p className="mt-1 text-[11px] text-err">
							{t("skillsConnections.operationFailed")}: {installError}
						</p>
					)}
					{updateError && (
						<p className="mt-1 text-[11px] text-err">
							{t("skillsConnections.operationFailed")}: {updateError}
						</p>
					)}
					{removeError && (
						<p className="mt-1 text-[11px] text-err">
							{t("skillsConnections.operationFailed")}: {removeError}
						</p>
					)}
					{lifecycle?.status === "succeeded" && (
						<p className="mt-1 text-[11px] text-ok">
							{lifecycle.effect === "next-session"
								? t("skillsConnections.effectiveNext")
								: t("skillsConnections.effectiveCurrent")}
						</p>
					)}
					{host?.currentVersion && host.currentVersion !== entry.version && (
						<p className="mt-1 text-[11px] text-ink-faint">
							{t("skillsConnections.currentSessionVersion", { version: host.currentVersion })}
						</p>
					)}
					{host?.nextSessionVersion && (
						<p className="mt-1 text-[11px] text-warn">
							{t("skillsConnections.nextSessionVersion", { version: host.nextSessionVersion })}
						</p>
					)}
					{host?.lastLifecycleError && (
						<p className="mt-1 truncate text-[11px] text-danger" title={host.lastLifecycleError}>
							{t("skillsConnections.lifecycleError", { message: host.lastLifecycleError })}
						</p>
					)}
					{(installing || updating || removing) && (
						<OperationProgress
							label={
								installing
									? t("skillsConnections.installing")
									: updating
										? t("skillsConnections.updating")
										: t("skillsConnections.removing")
							}
						/>
					)}
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<span
						className={`text-xs ${hasUpdate ? "text-warn" : current.installed ? "text-ok" : "text-ink-faint"}`}
						title={latest ? t("skillsConnections.latestVersion", { version: latest }) : undefined}
					>
						{current.builtin && (!uiPlugin || uiPlugin.enabled)
							? t("skillsConnections.builtinEnabled")
							: !current.installed
								? t("skillsConnections.notInstalled")
								: hasUpdate
									? t("skillsConnections.updateAvailable", { version: latest ?? "" })
									: latest
										? t("skillsConnections.upToDate", { version: installedVersion })
										: `${t("skillsConnections.installed")} · v${installedVersion}`}
					</span>
					{uiPlugin ? (
						<Switch
							checked={uiPlugin.enabled}
							disabled={Boolean(uiPlugin.invalidReason || uiPlugin.buildError)}
							onCheckedChange={(enabled) => void setPluginEnabled(uiPlugin.name, enabled)}
							aria-label={uiPlugin.enabled ? t("skillsConnections.disable") : t("skillsConnections.enable")}
						/>
					) : (
						<>
							{current.installed ? (
								<Switch
									checked
									disabled={current.builtin || installing || updating || removing}
									onCheckedChange={(enabled) => {
										if (!enabled && current.configured)
											void remove(current.configured.source, current.configured.scope);
									}}
									aria-label={t("skillsConnections.disable")}
								/>
							) : null}
							{/* Update only when the registry has a newer version; the switch already uninstalls. */}
							{current.installed && !current.builtin && (hasUpdate || updating) ? (
								<button
									type="button"
									className="rounded-full bg-ink px-2 py-1 text-xs text-canvas hover:opacity-90 disabled:opacity-60"
									disabled={updating || removing}
									onClick={() => void update(entry.packageName)}
								>
									{updating ? t("skillsConnections.updating") : t("skillsConnections.update")}
								</button>
							) : !current.installed ? (
								<button
									type="button"
									className="rounded-full bg-ink px-2 py-1 text-[11px] text-canvas hover:opacity-90 disabled:opacity-60"
									disabled={installing}
									onClick={() => {
										if (window.confirm(t("skillsConnections.installConfirm", { name: entry.packageName })))
											void install(entry.packageName);
									}}
								>
									{installing ? t("skillsConnections.installing") : t("skillsConnections.install")}
								</button>
							) : null}
						</>
					)}
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
	const setPluginEnabled = useUiPluginsStore((state) => state.setPluginEnabled);
	const checkLatestVersions = useCatalogStore((state) => state.checkLatestVersions);
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
	const builtinEntries = useMemo(
		() => entries.filter((entry) => isBuiltinDronePackage(entry.packageName)),
		[entries],
	);
	const droneNames = useMemo(() => new Set<string>(DRONE_PLUGIN_PACKAGE_NAMES), []);
	const configuredEntries = useMemo(
		() =>
			(configured ?? []).filter((item) => {
				return !droneNames.has(configuredPackageName(item.source));
			}),
		[droneNames, configured],
	);
	const hostEntries = useMemo(
		// Non-Drone packages the host actually loaded (Drone packages have their own rows above).
		() =>
			hostPlugins.filter(
				(plugin) =>
					!droneNames.has(plugin.name) &&
					plugin.status !== "unavailable" &&
					!(configured ?? []).some((item) => configuredPackageName(item.source) === plugin.name),
			),
		[configured, droneNames, hostPlugins],
	);
	const optionalEntries = useMemo(() => {
		const optional = entries.filter((entry) => !isBuiltinDronePackage(entry.packageName));
		const installed = (entry: PiPluginSourceEntry) =>
			packageState(
				entry,
				configured ?? [],
				hostPlugins.find((item) => item.name === entry.packageName),
				uiPlugins,
			).installed;
		// Installed first, then the ones that can still be added.
		return [...optional.filter(installed), ...optional.filter((entry) => !installed(entry))];
	}, [configured, entries, hostPlugins, uiPlugins]);
	// Ask npm once per set of installed packages so rows can say "up to date" vs "update available".
	const installedNames = useMemo(
		() =>
			[
				...optionalEntries.map((entry) => entry.packageName),
				...(configured ?? []).map((item) => configuredPackageName(item.source)),
				...hostPlugins.filter((plugin) => plugin.status !== "unavailable").map((plugin) => plugin.name),
			]
				.filter((name, index, all) => all.indexOf(name) === index && !isBuiltinDronePackage(name))
				.sort()
				.join("|"),
		[configured, hostPlugins, optionalEntries],
	);
	useEffect(() => {
		if (installedNames) void checkLatestVersions(installedNames.split("|"));
	}, [checkLatestVersions, installedNames]);
	return (
		<div className="space-y-5" data-testid="plugin-sources-section">
			{/* One card for every plugin the user has or can add from Drone; the community market below is a
			    separate kind of thing (a catalogue to browse). */}
			<section className="rounded-2xl border border-border bg-surface px-4 py-4" data-testid="plugins-card">
				<h2 className="text-sm font-semibold text-ink">{t("skillsConnections.pluginsCardTitle")}</h2>
				<p className="mt-1 text-xs text-ink-dim">{t("skillsConnections.pluginsCardHint")}</p>
				<ul className="mt-2 divide-y divide-border">
					{builtinEntries.map((entry) => (
						<li key={`builtin:${entry.packageName}`} className="flex items-start gap-3 py-3">
							<div className="min-w-0 flex-1">
								<p className="truncate text-sm font-medium text-ink">{entry.packageName}</p>
								{entry.description ? (
									<p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-dim">
										{entry.description}
									</p>
								) : null}
							</div>
							<span className="shrink-0 text-xs text-ok">{t("skillsConnections.builtinEnabled")}</span>
						</li>
					))}
					{optionalEntries.map((entry) => (
						<DronePackageRow
							key={entry.packageName}
							entry={entry}
							host={hostPlugins.find((item) => item.name === entry.packageName)}
						/>
					))}
					{configuredEntries.map((item) => (
						<li key={`${item.source}:${item.scope}`} className="flex items-center gap-3 py-3">
							<p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
								{configuredPackageName(item.source)}
							</p>
							<span className="shrink-0 text-xs text-ink-faint">
								{t("skillsConnections.installed")} · {item.scope}
							</span>
						</li>
					))}
					{hostEntries.map((plugin) => (
						<li key={`host:${plugin.name}`} className="flex items-center gap-3 py-3">
							<p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{plugin.name}</p>
							<span className={`shrink-0 text-xs ${plugin.status === "available" ? "text-ok" : "text-warn"}`}>
								{plugin.version} ·{" "}
								{plugin.status === "available"
									? t("skillsConnections.pluginStatusAvailable")
									: t("skillsConnections.pluginStatusConfigure")}
							</span>
						</li>
					))}
					{uiPlugins.map((plugin) => (
						<li key={`ui:${plugin.name}`} className="flex items-center gap-3 py-3">
							<div className="min-w-0 flex-1">
								<p className="truncate text-sm font-medium text-ink">{plugin.displayName ?? plugin.name}</p>
								<p className="mt-1 text-xs text-ink-faint">Desktop UI</p>
							</div>
							<Switch
								checked={plugin.enabled}
								disabled={Boolean(plugin.invalidReason || plugin.buildError)}
								onCheckedChange={(enabled) => void setPluginEnabled(plugin.name, enabled)}
								aria-label={plugin.enabled ? t("skillsConnections.disable") : t("skillsConnections.enable")}
							/>
						</li>
					))}
				</ul>
			</section>
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
		</div>
	);
}
