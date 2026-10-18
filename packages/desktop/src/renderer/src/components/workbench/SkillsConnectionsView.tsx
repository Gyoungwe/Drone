import type {
	InstitutionalStatus,
	KnowledgeCloudStatus,
	McpServerRuntimeStatus,
	McpStatus,
	ZoteroLocalWriteStatus,
	ZoteroStatus,
	ZoteroWebApiStatus,
} from "@drone/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";
import { useSessionsStore } from "../../stores/sessions";
import { useSettingsStore } from "../../stores/settings";
import { useUiPluginsStore } from "../../stores/ui-plugins";
import { ListIcon, PuzzleIcon, RefreshIcon, TaskBoardIcon, ZoteroIcon } from "../icons";
import { Switch } from "../ui/Switch";

export type CapabilityStatus =
	| "available"
	| "configure"
	| "running"
	| "disabled"
	| "permission"
	| "stale"
	| "error"
	| "incompatible";
export type CapabilityFilter = "all" | "plugin" | "connector" | "mcp" | "skill";

export function mcpCapabilityStatus(
	status: McpServerRuntimeStatus | null,
	enabled: boolean,
): CapabilityStatus {
	if (!enabled || status === "disabled") return "disabled";
	if (status === "connected") return "running";
	if (status === "cached") return "available";
	if (status === "needs-auth" || status === "blocked") return "permission";
	if (status === "failed") return "error";
	return "configure";
}

export function cloudCapabilityStatus(status: KnowledgeCloudStatus | null): CapabilityStatus {
	if (!status) return "configure";
	if (status.mode === "disabled") return "disabled";
	if (status.mode === "ready") return "available";
	if (status.mode === "read-only") return "permission";
	if (status.mode === "offline" || status.mode === "error") return "stale";
	if (status.mode === "unauthorized") return "permission";
	return "configure";
}

export function zoteroCapabilityStatus(status: ZoteroStatus | null): CapabilityStatus {
	if (!status) return "configure";
	if (!status.registered || !status.enabled) return "configure";
	if (status.localApiReachable) return "running";
	return "stale";
}

export function statusTone(status: CapabilityStatus): string {
	if (status === "running" || status === "available") return "text-ok";
	if (status === "configure" || status === "permission" || status === "stale") return "text-warn";
	if (status === "error" || status === "incompatible") return "text-err";
	return "text-ink-faint";
}

interface CapabilityRow {
	id: string;
	kind: Exclude<CapabilityFilter, "all">;
	name: string;
	description: string;
	scope: string;
	status: CapabilityStatus;
	version?: string;
	action?: string;
}

function IconForKind({ kind }: { kind: CapabilityRow["kind"] }) {
	if (kind === "plugin") return <PuzzleIcon size={17} />;
	if (kind === "connector") return <ZoteroIcon size={17} />;
	if (kind === "mcp") return <ListIcon size={17} />;
	return <TaskBoardIcon size={17} />;
}

export function SkillsConnectionsView() {
	const t = useT();
	const cwd = useSessionsStore((state) => state.cwd);
	const settingsSkills = useSettingsStore((state) => state.skills);
	const settingsExtensions = useSettingsStore((state) => state.extensions);
	const diagnostics = useSettingsStore((state) => state.skillDiagnostics);
	const refreshSettings = useSettingsStore((state) => state.refresh);
	const plugins = useUiPluginsStore((state) => state.plugins);
	const loadPlugins = useUiPluginsStore((state) => state.loadAll);
	const setPluginEnabled = useUiPluginsStore((state) => state.setPluginEnabled);
	const setSettingsOpen = useSettingsStore((state) => state.setOpen);
	const [mcp, setMcp] = useState<McpStatus | null>(null);
	const [cloud, setCloud] = useState<KnowledgeCloudStatus | null>(null);
	const [zotero, setZotero] = useState<ZoteroStatus | null>(null);
	const [zoteroWeb, setZoteroWeb] = useState<ZoteroWebApiStatus | null>(null);
	const [zoteroLocal, setZoteroLocal] = useState<ZoteroLocalWriteStatus | null>(null);
	const [institutional, setInstitutional] = useState<InstitutionalStatus | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [filter, setFilter] = useState<CapabilityFilter>("all");
	const [attentionOnly, setAttentionOnly] = useState(false);
	const [pendingMcp, setPendingMcp] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		setLoading(true);
		setError(null);
		const results = await Promise.allSettled([
			refreshSettings(),
			loadPlugins(),
			getPi().getMcpStatus(cwd ?? undefined),
			getPi().getKnowledgeCloudStatus(),
			getPi().getZoteroStatus(),
			getPi().getZoteroWebApi(),
			getPi().getZoteroLocalWrite(),
			getPi().getInstitutionalStatus(),
		]);
		const [
			settingsResult,
			,
			mcpResult,
			cloudResult,
			zoteroResult,
			webResult,
			localResult,
			institutionalResult,
		] = results;
		if (mcpResult.status === "fulfilled") setMcp(mcpResult.value);
		if (cloudResult.status === "fulfilled") setCloud(cloudResult.value);
		if (zoteroResult.status === "fulfilled") setZotero(zoteroResult.value);
		if (webResult.status === "fulfilled") setZoteroWeb(webResult.value);
		if (localResult.status === "fulfilled") setZoteroLocal(localResult.value);
		if (institutionalResult.status === "fulfilled") setInstitutional(institutionalResult.value);
		const failed = results.find((result) => result.status === "rejected");
		if (failed?.status === "rejected" && settingsResult.status === "rejected")
			setError(failed.reason instanceof Error ? failed.reason.message : String(failed.reason));
		setLoading(false);
	}, [cwd, loadPlugins, refreshSettings]);

	useEffect(() => {
		void refresh();
		return window.pi.onMcpEvent((event) => {
			if (event.cwd === cwd) setMcp(event.status);
		});
	}, [cwd, refresh]);

	const rows = useMemo<CapabilityRow[]>(() => {
		const next: CapabilityRow[] = [];
		for (const plugin of plugins) {
			const problem = plugin.invalidReason || plugin.buildError;
			next.push({
				id: `plugin:${plugin.name}`,
				kind: "plugin",
				name: plugin.displayName ?? plugin.name,
				description: plugin.description ?? t("skillsConnections.pluginDescription"),
				scope: plugin.builtin ? t("skillsConnections.desktopHost") : t("skillsConnections.desktopHost"),
				status: problem
					? "incompatible"
					: !plugin.enabled
						? "disabled"
						: plugin.built
							? "available"
							: "configure",
				version: plugin.version,
				action: plugin.name,
			});
		}
		for (const server of mcp?.servers ?? []) {
			const enabled = !server.disabled;
			next.push({
				id: `mcp:${server.name}`,
				kind: "mcp",
				name: server.name,
				description: t("skillsConnections.mcpDescription", { count: server.toolCount }),
				scope: t("skillsConnections.mcpScope"),
				status: mcpCapabilityStatus(server.status, enabled),
				action: server.name,
			});
		}
		for (const skill of settingsSkills ?? []) {
			next.push({
				id: `skill:${skill.path}`,
				kind: "skill",
				name: skill.name,
				description: skill.description,
				scope: skill.scope,
				status: "available",
				action: "skills",
			});
		}
		if (cloud) {
			next.push({
				id: "connector:webdav",
				kind: "connector",
				name: t("skillsConnections.webdav"),
				description: cloud.message ?? t("skillsConnections.webdavDescription"),
				scope: cloud.endpoint || t("skillsConnections.readOnlyScope"),
				status: cloudCapabilityStatus(cloud),
				action: "knowledge",
			});
		}
		if (zotero) {
			const detail = zoteroWeb?.configured
				? t("skillsConnections.zoteroWebConfigured")
				: zoteroLocal?.authorized
					? t("skillsConnections.zoteroLocalAuthorized")
					: t("skillsConnections.zoteroDescription");
			next.push({
				id: "connector:zotero",
				kind: "connector",
				name: "Zotero",
				description: detail,
				scope: zotero.localApiReachable
					? t("skillsConnections.readWriteScope")
					: t("skillsConnections.readOnlyScope"),
				status: zoteroCapabilityStatus(zotero),
				action: "zotero",
			});
		}
		if (institutional) {
			next.push({
				id: "connector:institutional",
				kind: "connector",
				name: t("skillsConnections.institutional"),
				description: institutional.loggedIn
					? t("skillsConnections.institutionalLoggedIn")
					: t("skillsConnections.institutionalDescription"),
				scope: institutional.config.institutionName ?? t("skillsConnections.readOnlyScope"),
				status: institutional.loggedIn
					? "available"
					: institutional.config.configured
						? "permission"
						: "configure",
				action: "zotero",
			});
		}
		return next;
	}, [cloud, institutional, mcp, plugins, settingsSkills, t, zotero, zoteroLocal, zoteroWeb]);

	const visibleRows = useMemo(
		() =>
			rows.filter(
				(row) =>
					(filter === "all" || row.kind === filter) &&
					(!attentionOnly || !["available", "running"].includes(row.status)),
			),
		[attentionOnly, filter, rows],
	);
	const attentionCount = rows.filter((row) => !["available", "running"].includes(row.status)).length;
	const statusLabel = (status: CapabilityStatus) => t(`skillsConnections.status.${status}` as never);
	const openSettings = (category: "skills" | "mcp" | "zotero" | "knowledge" | "extensions") => {
		setSettingsOpen(true);
		useSettingsStore.getState().setCategory(category);
	};

	return (
		<div
			className="page-fade min-h-0 min-w-0 flex-1 overflow-y-auto bg-canvas px-6 py-8"
			data-testid="skills-connections-view"
		>
			<div className="mx-auto max-w-5xl">
				<header className="flex flex-wrap items-start justify-between gap-4">
					<div>
						<p className="text-xs uppercase tracking-[0.16em] text-ink-faint">
							{t("skillsConnections.eyebrow")}
						</p>
						<h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-ink">
							{t("skillsConnections.title")}
						</h1>
						<p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-dim">
							{t("skillsConnections.description")}
						</p>
					</div>
					<div className="flex shrink-0 gap-2">
						<button
							type="button"
							className="flex items-center gap-2 rounded-full border border-border px-3 py-2 text-xs text-ink-2 hover:bg-hover"
							onClick={() => void refresh()}
							disabled={loading}
						>
							<RefreshIcon size={13} className={loading ? "animate-spin" : ""} />{" "}
							{t("skillsConnections.checkAll")}
						</button>
						<button
							type="button"
							className="rounded-full bg-ink px-4 py-2 text-xs font-medium text-canvas hover:opacity-90"
							onClick={() => openSettings("mcp")}
						>
							+ {t("skillsConnections.add")}
						</button>
					</div>
				</header>

				<div
					className="mt-8 flex flex-wrap items-center gap-2 border-b border-border pb-3"
					role="tablist"
					aria-label={t("skillsConnections.filters")}
				>
					{(["all", "plugin", "connector", "mcp", "skill"] as const).map((key) => (
						<button
							key={key}
							type="button"
							role="tab"
							aria-selected={filter === key}
							className={`rounded-full px-3 py-2 text-xs ${filter === key ? "bg-highlight font-medium text-ink" : "text-ink-dim hover:bg-hover"}`}
							onClick={() => setFilter(key)}
						>
							{t(`skillsConnections.filter.${key}` as never)}
						</button>
					))}
					<button
						type="button"
						className={`ml-auto rounded-full border px-3 py-2 text-xs ${attentionOnly ? "border-warn text-warn" : "border-border text-ink-dim"}`}
						onClick={() => setAttentionOnly((value) => !value)}
					>
						{t("skillsConnections.attention", { count: attentionCount })}
					</button>
				</div>

				{error && (
					<p className="mt-4 rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-xs text-danger">
						{error}
					</p>
				)}
				{loading && rows.length === 0 ? (
					<p className="py-16 text-center text-sm text-ink-faint">{t("skillsConnections.loading")}</p>
				) : null}
				{!loading && visibleRows.length === 0 ? (
					<p className="py-16 text-center text-sm text-ink-faint">{t("skillsConnections.empty")}</p>
				) : null}
				<div className="mt-4 divide-y divide-border rounded-2xl border border-border bg-surface">
					{visibleRows.map((row) => {
						const plugin =
							row.kind === "plugin" ? plugins.find((item) => item.name === row.action) : undefined;
						const server =
							row.kind === "mcp" ? mcp?.servers.find((item) => item.name === row.action) : undefined;
						return (
							<div
								key={row.id}
								className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,2fr)_minmax(140px,1fr)_120px_auto] md:items-center"
							>
								<div className="flex min-w-0 items-start gap-3">
									<span className="mt-0.5 text-ink-dim">
										<IconForKind kind={row.kind} />
									</span>
									<div className="min-w-0">
										<p className="truncate text-sm font-medium text-ink">
											{row.name}
											{row.version ? (
												<span className="ml-2 text-xs font-normal text-ink-faint">v{row.version}</span>
											) : null}
										</p>
										<p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-dim">
											{row.description}
										</p>
									</div>
								</div>
								<div className="text-xs text-ink-faint">
									<p>{row.kind === "plugin" ? t("skillsConnections.host") : t("skillsConnections.scope")}</p>
									<p className="mt-1 truncate text-ink-2" title={row.scope}>
										{row.scope}
									</p>
								</div>
								<div className={`flex items-center gap-2 text-xs font-medium ${statusTone(row.status)}`}>
									<span
										className={`h-2 w-2 rounded-full ${row.status === "running" ? "animate-pulse bg-ok" : row.status === "available" ? "bg-ok" : row.status === "error" || row.status === "incompatible" ? "bg-err" : row.status === "disabled" ? "bg-ink-faint" : "bg-warn"}`}
									/>
									{statusLabel(row.status)}
								</div>
								<div className="flex justify-end">
									{plugin ? (
										<Switch
											checked={plugin.enabled}
											disabled={Boolean(plugin.invalidReason || plugin.buildError)}
											onCheckedChange={(enabled) => void setPluginEnabled(plugin.name, enabled)}
											aria-label={
												plugin.enabled ? t("skillsConnections.disable") : t("skillsConnections.enable")
											}
										/>
									) : server ? (
										<Switch
											checked={!server.disabled}
											disabled={pendingMcp === server.name}
											onCheckedChange={(enabled) => {
												setPendingMcp(server.name);
												void getPi()
													.setMcpServerEnabled(server.name, enabled, cwd ?? undefined)
													.then(() => getPi().getMcpStatus(cwd ?? undefined))
													.then(setMcp)
													.finally(() => setPendingMcp(null));
											}}
											aria-label={
												server.disabled ? t("skillsConnections.enable") : t("skillsConnections.disable")
											}
										/>
									) : (
										<button
											type="button"
											className="rounded-full border border-border px-3 py-2 text-xs text-ink-2 hover:bg-hover"
											onClick={() =>
												openSettings(row.action as "skills" | "mcp" | "zotero" | "knowledge" | "extensions")
											}
										>
											{row.status === "configure"
												? t("skillsConnections.configure")
												: row.status === "error"
													? t("skillsConnections.viewReason")
													: t("skillsConnections.view")}
										</button>
									)}
								</div>
							</div>
						);
					})}
				</div>
				{settingsExtensions && diagnostics.length > 0 ? (
					<p className="mt-3 text-xs text-warn">
						{t("skillsConnections.diagnostics", { count: diagnostics.length })}
					</p>
				) : null}
			</div>
		</div>
	);
}
