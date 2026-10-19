import type {
	InstitutionalStatus,
	KnowledgeCloudStatus,
	LoadedSkill,
	McpServerRuntimeStatus,
	McpStatus,
	ZoteroLocalWriteStatus,
	ZoteroStatus,
	ZoteroWebApiStatus,
} from "@drone/shared";
import { RESEARCH_SKILL_SOURCES, researchSkillProfile } from "@drone/shared";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";
import { restartForResearchSkillsWithGuard } from "../../lib/restart-research-skills";
import { useResearchSkillUpdateStore } from "../../stores/research-skill-update";
import { isDraftSessionId, useSessionsStore } from "../../stores/sessions";
import { useSettingsStore } from "../../stores/settings";
import { type CapabilityDrawer, useUiStore } from "../../stores/ui";
import { useUiPluginsStore } from "../../stores/ui-plugins";
import { ListIcon, PuzzleIcon, RefreshIcon, TaskBoardIcon, ZoteroIcon } from "../icons";
import { Switch } from "../ui/Switch";

const ExtensionsPanel = lazy(() =>
	import("../settings/extensions/ExtensionsPanel").then((m) => ({ default: m.ExtensionsPanel })),
);
const InstitutionalAccessSection = lazy(() =>
	import("../knowledge/InstitutionalAccessSection").then((m) => ({ default: m.InstitutionalAccessSection })),
);
const KnowledgePanel = lazy(() =>
	import("../knowledge/KnowledgePanel").then((m) => ({ default: m.KnowledgePanel })),
);
const ZoteroPanel = lazy(() => import("../knowledge/ZoteroPanel").then((m) => ({ default: m.ZoteroPanel })));
const McpPanel = lazy(() => import("../settings/McpPanel").then((m) => ({ default: m.McpPanel })));
const SkillsPanel = lazy(() => import("../settings/SkillsPanel").then((m) => ({ default: m.SkillsPanel })));
const UiPluginsSection = lazy(() =>
	import("../settings/UiPluginsSection").then((m) => ({ default: m.UiPluginsSection })),
);

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
	if (status.localApiReachable) return "running";
	return status.desktopDetected ? "stale" : "configure";
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
	source?: string;
}

type DrawerKind = CapabilityDrawer;

function sourceLabel(source: string, scope: string, t: (key: any) => string): string {
	if (source.startsWith("github:")) return source.slice("github:".length);
	if (source.startsWith("npm:@gyoungwe/"))
		return `${source.slice("npm:".length)}（${t("skillsConnections.dronePlugin")}）`;
	if (scope === "project")
		return `${t("skillsConnections.projectSource")} · ${source.split(/[\\/]/u).pop() || source}`;
	if (source.includes(".agents/skills"))
		return `${t("skillsConnections.personalSource")} · ${source.split(/[\\/]/u).pop() || source}`;
	if (source === "builtin" || source.startsWith("inline:")) return t("skillsConnections.builtinSource");
	return source;
}

export function skillSource(
	skillName: string,
	source: string,
	scope: string,
	upstream?: Pick<LoadedSkill, "repository" | "repositoryCommit" | "repositoryPath">,
): {
	key: string;
	profile?: ReturnType<typeof researchSkillProfile>;
	repository?: { url: string; path: string; commit?: string };
} {
	if (upstream?.repository) {
		const repository = upstream.repository.replace(/^https?:\/\/github\.com\//u, "");
		return {
			key: `github:${repository}`,
			repository: {
				url: `https://github.com/${repository}`,
				path: upstream.repositoryPath ?? "",
				...(upstream.repositoryCommit ? { commit: upstream.repositoryCommit } : {}),
			},
		};
	}
	const profile = researchSkillProfile(skillName);
	if (!profile) return { key: source || scope };
	const sourceInfo = RESEARCH_SKILL_SOURCES.find((entry) => entry.id === profile.source);
	if (!sourceInfo) return { key: source || scope, profile };
	return {
		key: `github:${sourceInfo.repository}`,
		profile,
		repository: {
			url: `https://github.com/${sourceInfo.repository}`,
			path: profile?.path ?? "",
			commit: sourceInfo.commit,
		},
	};
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
	const activeSessionId = useSessionsStore((state) => state.activeSessionId);
	const settingsSkills = useSettingsStore((state) => state.skills);
	const settingsExtensions = useSettingsStore((state) => state.extensions);
	const hostPlugins = useSettingsStore((state) => state.hostPlugins);
	const diagnostics = useSettingsStore((state) => state.skillDiagnostics);
	const refreshSettings = useSettingsStore((state) => state.refresh);
	const plugins = useUiPluginsStore((state) => state.plugins);
	const loadPlugins = useUiPluginsStore((state) => state.loadAll);
	const setPluginEnabled = useUiPluginsStore((state) => state.setPluginEnabled);
	const requestedDrawer = useUiStore((state) => state.capabilityDrawer);
	const clearRequestedDrawer = useUiStore((state) => state.setCapabilityDrawer);
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
	const [pendingSkillGroup, setPendingSkillGroup] = useState<string | null>(null);
	const [disabledSkillNames, setDisabledSkillNames] = useState<Set<string>>(() => new Set());
	const [drawer, setDrawer] = useState<DrawerKind | null>(null);
	const skillUpdateState = useResearchSkillUpdateStore((state) => state.state);
	useEffect(() => {
		if (!requestedDrawer) return;
		setDrawer(requestedDrawer);
		clearRequestedDrawer(null);
	}, [clearRequestedDrawer, requestedDrawer]);
	useEffect(() => {
		if (!activeSessionId || isDraftSessionId(activeSessionId) || disabledSkillNames.size === 0) return;
		void getPi()
			.setSkillNamesEnabled(activeSessionId, [...disabledSkillNames], false)
			.catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
	}, [activeSessionId, disabledSkillNames]);

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
		// Pi capability packages are host plugins too.  They used to be visible
		// only in the session resource inspector, which made the Plugins tab look
		// incomplete on a real desktop install.  Surface the loaded package-owned
		// extensions alongside UI plugins without inventing a second toggle.
		for (const extension of settingsExtensions ?? []) {
			if (extension.hidden || next.some((row) => row.id === `plugin:${extension.name}`)) continue;
			next.push({
				id: `plugin:${extension.name}`,
				kind: "plugin",
				name: extension.name,
				description: t("skillsConnections.pluginDescription"),
				scope: extension.source,
				status: "available",
				action: "extensions",
			});
		}
		for (const plugin of hostPlugins ?? []) {
			if (next.some((row) => row.id === `plugin:${plugin.name}`)) continue;
			next.push({
				id: `plugin:${plugin.name}`,
				kind: "plugin",
				name: plugin.name,
				description: t("skillsConnections.hostPluginDescription"),
				scope: plugin.host === "desktop" ? t("skillsConnections.desktopHost") : "Pi",
				status: plugin.status === "available" ? "available" : "configure",
				version: plugin.version,
				action: "extensions",
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
				action: "institutional",
			});
		}
		return next;
	}, [
		cloud,
		institutional,
		mcp,
		plugins,
		hostPlugins,
		settingsExtensions,
		settingsSkills,
		t,
		zotero,
		zoteroLocal,
		zoteroWeb,
	]);

	const visibleRows = useMemo(
		() =>
			rows.filter(
				(row) =>
					row.kind !== "skill" &&
					(filter === "all" || row.kind === filter) &&
					(!attentionOnly || !["available", "running"].includes(row.status)),
			),
		[attentionOnly, filter, rows],
	);
	const skillGroups = useMemo(() => {
		type GroupedSkill = {
			skill: NonNullable<typeof settingsSkills>[number];
			sources: string[];
			repository?: { url: string; path: string; commit: string };
		};
		type SkillGroup = { source: string; scope: string; skills: GroupedSkill[] };
		const groups = new Map<string, SkillGroup>();
		const byName = new Map<string, GroupedSkill>();
		for (const skill of settingsSkills ?? []) {
			const resolved = skillSource(skill.name, skill.source, skill.scope, skill);
			const key = resolved.key;
			const existing = byName.get(skill.name);
			if (existing) {
				if (!existing.sources.includes(key)) existing.sources.push(key);
				continue;
			}
			const grouped: GroupedSkill = {
				skill,
				sources: [key],
				repository: resolved.repository
					? {
							url: resolved.repository.url,
							path: resolved.repository.path,
							commit: resolved.repository.commit ?? "",
						}
					: undefined,
			};
			byName.set(skill.name, grouped);
			const current = groups.get(key) ?? { source: key, scope: skill.scope, skills: [] };
			current.skills.push(grouped);
			groups.set(key, current);
		}
		return [...groups.values()];
	}, [settingsSkills]);
	const researchSourceCards = useMemo(
		() =>
			RESEARCH_SKILL_SOURCES.map((source) => {
				const loaded = (settingsSkills ?? []).filter((skill) => {
					const resolved = skillSource(skill.name, skill.source, skill.scope, skill);
					return resolved.repository?.url === `https://github.com/${source.repository}`;
				}).length;
				return {
					...source,
					loaded,
					bundled: source.skills.filter((skill) => skill.bundled).length,
					managed: source.id === "nature" || source.id === "scientific",
				};
			}),
		[settingsSkills],
	);
	const attentionCount = rows.filter((row) => !["available", "running"].includes(row.status)).length;
	const statusLabel = (status: CapabilityStatus) => t(`skillsConnections.status.${status}` as never);
	const openSettings = (category: DrawerKind) => setDrawer(category);
	const skillUpdateBusy = skillUpdateState?.phase === "checking" || skillUpdateState?.phase === "downloading";
	const skillUpdateLabel =
		skillUpdateState?.phase === "ready" ? t("update.skillsRestart") : t("update.skillsUpdate");
	const setSkillGroupEnabled = async (source: string, names: string[], enabled: boolean) => {
		if (!activeSessionId || isDraftSessionId(activeSessionId)) {
			setError(t("skillsConnections.noSession"));
			return;
		}
		setPendingSkillGroup(source);
		try {
			const result = await getPi().setSkillNamesEnabled(activeSessionId, names, enabled);
			setDisabledSkillNames(new Set(result.disabled));
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setPendingSkillGroup(null);
		}
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
				<div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3">
					<div className="min-w-0 text-xs text-ink-dim">
						<p className="font-medium text-ink">{t("update.skillsUpdate")}</p>
						<p className="mt-1 truncate">
							{skillUpdateState?.phase === "available"
								? t("update.skillsAvailable", { count: skillUpdateState.packs.length })
								: skillUpdateState?.phase === "ready"
									? t("update.skillsReady")
									: skillUpdateState?.phase === "up-to-date"
										? t("update.skillsUpToDate")
										: skillUpdateState?.phase === "error"
											? t("update.skillsFailed", { message: skillUpdateState.message })
											: t("update.skillsChecking")}
						</p>
					</div>
					<button
						type="button"
						className="rounded-full border border-border px-3 py-2 text-xs text-ink-2 hover:bg-hover disabled:opacity-60"
						disabled={skillUpdateBusy}
						onClick={() =>
							void (skillUpdateState?.phase === "ready"
								? restartForResearchSkillsWithGuard()
								: getPi().updateResearchSkills())
						}
					>
						{skillUpdateBusy ? t("update.skillsChecking") : skillUpdateLabel}
					</button>
				</div>
				<section
					className="mt-4 rounded-2xl border border-border bg-surface px-4 py-4"
					data-testid="research-skill-sources"
				>
					<div className="flex flex-wrap items-baseline justify-between gap-2">
						<div>
							<h2 className="text-sm font-medium text-ink">{t("skillsConnections.sourceRepositories")}</h2>
							<p className="mt-1 text-xs leading-relaxed text-ink-dim">
								{t("skillsConnections.sourceRepositoriesHint")}
							</p>
						</div>
					</div>
					<div className="mt-3 grid gap-2 md:grid-cols-2">
						{researchSourceCards.map((source) => (
							<div key={source.id} className="rounded-xl border border-border px-3 py-3">
								<div className="flex items-start justify-between gap-3">
									<div className="min-w-0">
										<p className="truncate text-xs font-medium text-ink">
											{t(`skillsConnections.sourceName.${source.id}` as never)}
										</p>
										<p className="mt-1 truncate text-[11px] text-ink-faint">github.com/{source.repository}</p>
									</div>
									<span
										className={`shrink-0 rounded-full px-2 py-1 text-[10px] ${source.managed ? "bg-highlight text-ink-2" : "bg-hover text-ink-faint"}`}
									>
										{source.managed
											? t("skillsConnections.autoUpdateSource")
											: t("skillsConnections.catalogSource")}
									</span>
								</div>
								<p className="mt-2 text-[11px] text-ink-faint">
									{t("skillsConnections.sourceCommit", { commit: source.commit.slice(0, 9) })} ·{" "}
									{t("skillsConnections.sourceSkillCounts", {
										loaded: source.loaded,
										bundled: source.bundled,
									})}
								</p>
								<button
									type="button"
									className="mt-2 text-[11px] text-accent hover:underline"
									onClick={() => void getPi().openExternal(`https://github.com/${source.repository}`)}
								>
									{t("skillsConnections.openRepository")}
								</button>
							</div>
						))}
					</div>
				</section>

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
											onClick={() => openSettings(row.action as DrawerKind)}
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
				{skillGroups.length > 0 && (filter === "all" || filter === "skill") && (
					<div className="mt-4 space-y-2" data-testid="skill-source-groups">
						{skillGroups.map((group) => (
							<details
								key={group.source}
								className="rounded-2xl border border-border bg-surface"
								open={group.skills.some(({ skill }) => skill.disableModelInvocation)}
							>
								<summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm font-medium text-ink">
									<span className="min-w-0 flex-1 truncate">{sourceLabel(group.source, group.scope, t)}</span>
									<span className="text-xs text-ink-faint">
										{group.skills.length} {t("skillsConnections.skillsCount")}
									</span>
									<Switch
										checked={group.skills.some(({ skill }) => !disabledSkillNames.has(skill.name))}
										disabled={pendingSkillGroup === group.source}
										onCheckedChange={(enabled) =>
											void setSkillGroupEnabled(
												group.source,
												group.skills.map(({ skill }) => skill.name),
												enabled,
											)
										}
										aria-label={
											group.skills.some(({ skill }) => !disabledSkillNames.has(skill.name))
												? t("skillsConnections.disableGroup")
												: t("skillsConnections.enableGroup")
										}
									/>
								</summary>
								<ul className="divide-y divide-border border-t border-border px-4">
									{group.skills.map(({ skill, sources, repository }) => (
										<li key={skill.name} className="flex items-center gap-3 py-3 text-xs">
											<span className="min-w-0 flex-1">
												<span className="block font-medium text-ink">{skill.name}</span>
												<span className="mt-1 block truncate text-ink-faint">
													/skill:{skill.name} ·{" "}
													{skill.repository ? "GitHub source" : `loader: ${skill.source}`}
												</span>
												{repository ? (
													<button
														type="button"
														className="mt-1 block max-w-full truncate text-left text-[11px] text-accent hover:underline"
														onClick={() =>
															void getPi().openExternal(
																repository.commit
																	? `${repository.url}/blob/${repository.commit}/${repository.path}`
																	: repository.url,
															)
														}
													>
														{repository.url.replace("https://github.com/", "github.com/")}
													</button>
												) : null}
												{sources.length > 1 && (
													<details className="mt-1 text-[11px] text-ink-faint">
														<summary className="cursor-pointer">
															{t("skillsConnections.moreSources", { count: sources.length - 1 })}
														</summary>
														<ul className="mt-1 space-y-0.5 pl-3">
															{sources.map((source) => (
																<li key={source}>{source}</li>
															))}
														</ul>
													</details>
												)}
											</span>
											{disabledSkillNames.has(skill.name) ? (
												<span className="text-ink-faint">{t("skillsConnections.disabled")}</span>
											) : skill.disableModelInvocation ? (
												<span className="text-warn">{t("skillsConnections.manualOnly")}</span>
											) : (
												<span className="text-ok">{t("skillsConnections.available")}</span>
											)}
										</li>
									))}
								</ul>
							</details>
						))}
					</div>
				)}
				{settingsExtensions && diagnostics.length > 0 ? (
					<p className="mt-3 text-xs text-warn">
						{t("skillsConnections.diagnostics", { count: diagnostics.length })}
					</p>
				) : null}
			</div>
			{drawer && (
				<aside
					className="fixed inset-y-0 right-0 z-30 w-[min(520px,92vw)] overflow-y-auto border-l border-border bg-surface p-5 shadow-2xl"
					aria-label={t("skillsConnections.drawerTitle")}
				>
					<div className="mb-4 flex items-center justify-between gap-3">
						<h2 className="text-sm font-semibold text-ink">{t("skillsConnections.drawerTitle")}</h2>
						<button
							type="button"
							className="rounded-lg px-2 py-1 text-ink-faint hover:bg-hover"
							onClick={() => setDrawer(null)}
							aria-label={t("common.close")}
						>
							✕
						</button>
					</div>
					<Suspense fallback={<p className="text-xs text-ink-faint">{t("skillsConnections.loading")}</p>}>
						{drawer === "skills" && <SkillsPanel />}
						{drawer === "mcp" && <McpPanel />}
						{drawer === "extensions" && <ExtensionsPanel />}
						{drawer === "uiPlugins" && <UiPluginsSection />}
						{drawer === "zotero" && <ZoteroPanel />}
						{drawer === "institutional" && <InstitutionalAccessSection />}
						{drawer === "knowledge" && <KnowledgePanel />}
					</Suspense>
				</aside>
			)}
		</div>
	);
}
