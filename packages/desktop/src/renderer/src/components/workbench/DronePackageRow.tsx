import {
	type ConfiguredPackageInfo,
	compareVersions,
	DRONE_BUILTIN_PLUGIN_PACKAGE_NAMES,
	type HostPluginPackage,
	npmPackageName,
	type PiPluginSourceEntry,
	type UiPluginInfo,
} from "@drone/shared";
import { useT } from "../../i18n";
import { selectLifecycleReceipt, useCatalogStore } from "../../stores/catalog";
import { useUiPluginsStore } from "../../stores/ui-plugins";
import {
	PackageLifecycleDetails,
	PackageOperationProgress,
} from "../settings/extensions/PackageLifecycleDetails";
import { Switch } from "../ui/Switch";

export function isBuiltinDronePackage(packageName: string): boolean {
	return DRONE_BUILTIN_PLUGIN_PACKAGE_NAMES.some((name) => name === packageName);
}

export function packageState(
	name: string,
	configured: readonly ConfiguredPackageInfo[],
	host: HostPluginPackage | undefined,
	uiPlugins: readonly UiPluginInfo[],
) {
	const selected = configured.find((item) => npmPackageName(item.source) === name);
	const uiPlugin = uiPlugins.find((item) => item.packageName === name);
	const builtin = isBuiltinDronePackage(name) || uiPlugin?.builtin === true;
	return {
		installed: Boolean(builtin || selected || host?.status === "available" || uiPlugin),
		builtin,
		selected,
		uiPlugin,
	};
}

function useDronePackageRow(entry: PiPluginSourceEntry, host?: HostPluginPackage) {
	const name = entry.packageName;
	const configured = useCatalogStore((state) => state.configuredPackages);
	const uiPlugins = useUiPluginsStore((state) => state.plugins);
	const { installed, builtin, selected, uiPlugin } = packageState(name, configured ?? [], host, uiPlugins);
	const latest = useCatalogStore((state) => state.latestVersions[name]) ?? null;
	const installedVersion = host?.version ?? entry.version ?? "?";
	const hasUpdate = Boolean(
		installed && latest && installedVersion !== "?" && compareVersions(latest, installedVersion) > 0,
	);
	const installing = useCatalogStore((state) => state.installingNames[name] === true);
	const updating = useCatalogStore((state) => state.updatingNames[name] === true);
	const removing = useCatalogStore((state) => Boolean(selected && state.removingSources[selected.source]));
	const installError = useCatalogStore((state) => state.installErrors[name]);
	const updateError = useCatalogStore((state) => state.updateErrors[name]);
	const removeError = useCatalogStore((state) =>
		selected ? state.removeErrors[selected.source] : undefined,
	);
	const lifecycle = useCatalogStore((state) => selectLifecycleReceipt(state, name, selected));
	return {
		installed,
		builtin,
		selected,
		uiPlugin,
		latest,
		installedVersion,
		hasUpdate,
		installing,
		updating,
		removing,
		installError,
		updateError,
		removeError,
		lifecycle,
	};
}

type RowState = ReturnType<typeof useDronePackageRow>;

function useDeclarations(entry: PiPluginSourceEntry) {
	const t = useT();
	return {
		capabilities: `${t("skillsConnections.declaredCapabilities")}: ${entry.capabilities.join(", ") || t("skillsConnections.undeclaredCapabilities")}`,
		hosts: `${t("skillsConnections.declaredHosts")}: ${entry.hosts.join(", ") || t("skillsConnections.undeclaredHosts")}`,
		tools: `${t("skillsConnections.declaredTools")}: ${entry.tools.join(", ") || t("skillsConnections.undeclaredTools")}`,
		permissions: `${t("skillsConnections.declaredPermissions")}: ${entry.permissions ? JSON.stringify(entry.permissions) : t("skillsConnections.undeclaredPermissions")}`,
	};
}

function PackageDeclarations({ entry }: { entry: PiPluginSourceEntry }) {
	const t = useT();
	const { capabilities, hosts, tools, permissions } = useDeclarations(entry);
	return (
		<>
			<p className="mt-1 text-[11px] text-ink-faint">
				{capabilities} · {hosts}
			</p>
			{!entry.manifestDeclared && (
				<p className="mt-1 text-[11px] text-warn">
					{t(
						entry.declarationSource === "fallback"
							? "skillsConnections.metadataAfterInstall"
							: "skillsConnections.undeclaredManifest",
					)}
				</p>
			)}
			<p className="mt-1 text-[11px] text-ink-faint">
				{tools} · {permissions}
			</p>
		</>
	);
}

function WorkerVersions({ version, host }: { version?: string; host?: HostPluginPackage }) {
	const t = useT();
	return (
		<>
			{host?.currentVersion && host.currentVersion !== version && (
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
				<p className="mt-1 text-[11px] text-danger">
					{t("settings.extensions.lifecycleErrors.operation-failed")}
				</p>
			)}
		</>
	);
}

function InstallButton({ entry, installing }: { entry: PiPluginSourceEntry; installing: boolean }) {
	const t = useT();
	const declarations = useDeclarations(entry);
	const install = useCatalogStore((state) => state.installCatalogPackage);
	const confirmInstall = () => {
		const text = [
			t("skillsConnections.installConfirm", { name: entry.packageName }),
			...Object.values(declarations),
		];
		if (window.confirm(text.join("\n"))) void install(entry.packageName);
	};
	return (
		<button
			type="button"
			className="rounded-full bg-ink px-2 py-1 text-[11px] text-canvas hover:opacity-90 disabled:opacity-60"
			disabled={installing}
			onClick={confirmInstall}
		>
			{t(installing ? "skillsConnections.installing" : "skillsConnections.install")}
		</button>
	);
}

function PackageStatus({ state }: { state: RowState }) {
	const t = useT();
	const { builtin, installed, hasUpdate, uiPlugin, latest, installedVersion } = state;
	const label =
		builtin && (!uiPlugin || uiPlugin.enabled)
			? t("skillsConnections.builtinEnabled")
			: !installed
				? t("skillsConnections.notInstalled")
				: hasUpdate && latest
					? t("skillsConnections.updateAvailable", { version: latest })
					: latest
						? t("skillsConnections.upToDate", { version: installedVersion })
						: `${t("skillsConnections.installed")} · v${installedVersion}`;
	return (
		<span
			className={`text-xs ${hasUpdate ? "text-warn" : installed ? "text-ok" : "text-ink-faint"}`}
			title={latest ? t("skillsConnections.latestVersion", { version: latest }) : undefined}
		>
			{label}
		</span>
	);
}

function PackageControls({ entry, state }: { entry: PiPluginSourceEntry; state: RowState }) {
	const t = useT();
	const enable = useUiPluginsStore((value) => value.setPluginEnabled);
	const remove = useCatalogStore((value) => value.removeConfiguredPackage);
	const update = useCatalogStore((value) => value.updateCatalogPackage);
	const { uiPlugin, installed, builtin, selected, installing, updating, removing, hasUpdate } = state;
	if (uiPlugin)
		return (
			<Switch
				checked={uiPlugin.enabled}
				disabled={Boolean(uiPlugin.invalidReason || uiPlugin.buildError)}
				onCheckedChange={(enabled) => void enable(uiPlugin.name, enabled)}
				aria-label={t(uiPlugin.enabled ? "skillsConnections.disable" : "skillsConnections.enable")}
			/>
		);
	if (!installed) return <InstallButton entry={entry} installing={installing} />;
	return (
		<>
			<Switch
				checked
				disabled={builtin || installing || updating || removing}
				aria-label={t("skillsConnections.disable")}
				onCheckedChange={(enabled) => {
					if (!enabled && selected) void remove(selected.source, selected.scope);
				}}
			/>
			{!builtin && (hasUpdate || updating) && (
				<button
					type="button"
					className="rounded-full bg-ink px-2 py-1 text-xs text-canvas hover:opacity-90 disabled:opacity-60"
					disabled={updating || removing}
					onClick={() => void update(entry.packageName)}
				>
					{t(updating ? "skillsConnections.updating" : "skillsConnections.update")}
				</button>
			)}
		</>
	);
}

export function DronePackageRow({ entry, host }: { entry: PiPluginSourceEntry; host?: HostPluginPackage }) {
	const t = useT();
	const state = useDronePackageRow(entry, host);
	const { installing, updating, removing, installError, updateError, removeError, lifecycle } = state;
	const error = installError ?? updateError ?? removeError;
	return (
		<li className="flex items-start gap-3 py-3">
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
				<PackageDeclarations entry={entry} />
				{error && !lifecycle && (
					<p className="mt-1 text-[11px] text-err">
						{t("skillsConnections.operationFailed")} · {error}
					</p>
				)}
				<PackageLifecycleDetails receipt={lifecycle} context="skillsConnections" />
				<WorkerVersions host={host} version={entry.version} />
				{(installing || updating || removing) && (
					<PackageOperationProgress
						label={t(
							installing
								? "skillsConnections.installing"
								: updating
									? "skillsConnections.updating"
									: "skillsConnections.removing",
						)}
					/>
				)}
			</div>
			<div className="flex shrink-0 items-center gap-2">
				<PackageStatus state={state} />
				<PackageControls entry={entry} state={state} />
			</div>
		</li>
	);
}
