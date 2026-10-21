import type {
	InstitutionalStatus,
	KnowledgeCloudStatus,
	LoadedSkill,
	McpServerRuntimeStatus,
	McpStatus,
	ResearchConnectorDescriptor,
	SkillRepositoryAddInput,
	SkillRepositoryRecord,
	ZoteroLocalWriteStatus,
	ZoteroStatus,
	ZoteroWebApiStatus,
} from "@drone/shared";
import { MARKET_RESOURCE_LINKS, RESEARCH_SKILL_SOURCES, researchSkillProfile } from "@drone/shared";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";
import { restartForResearchSkillsWithGuard } from "../../lib/restart-research-skills";
import { PluginEntryHost, usePluginEntries } from "../../plugins/PluginRegions";
import { UI_REGIONS } from "../../plugins/slots";
import { useResearchSkillUpdateStore } from "../../stores/research-skill-update";
import { isDraftSessionId, useSessionsStore } from "../../stores/sessions";
import { useSettingsStore } from "../../stores/settings";
import { type CapabilityDrawer, useUiStore } from "../../stores/ui";
import { useUiPluginsStore } from "../../stores/ui-plugins";
import { ListIcon, RefreshIcon, TaskBoardIcon, ZoteroIcon } from "../icons";
import { PageHeader, PageShell } from "../ui/PageHeader";
import { Switch } from "../ui/Switch";
import { PluginSourcesSection } from "./PluginSourcesSection";

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
export type CapabilitySection = "market" | "connectors" | "mcp" | "skills";

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

export function zoteroCapabilityStatus(status: ZoteroStatus | null, enabled = true): CapabilityStatus {
	if (!enabled) return "disabled";
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
	kind: "connector" | "mcp";
	name: string;
	description: string;
	scope: string;
	status: CapabilityStatus;
	version?: string;
	action?: string;
	connectorId?: string;
	source?: string;
}

type DrawerKind = CapabilityDrawer;

function sourceLabel(source: string, scope: string, t: (key: any) => string): string {
	if (source.startsWith("github:")) {
		const repository = source.slice("github:".length);
		const known = RESEARCH_SKILL_SOURCES.find((entry) => entry.repository === repository);
		return known ? t(`skillsConnections.sourceName.${known.id}`) : repository;
	}
	if (source.startsWith("npm:@gyoungwe/"))
		return `${source.slice("npm:".length)}（${t("skillsConnections.dronePlugin")}）`;
	if (scope === "project")
		return `${t("skillsConnections.projectSource")} · ${source.split(/[\\/]/u).pop() || source}`;
	if (source.includes(".agents/skills"))
		return `${t("skillsConnections.personalSource")} · ${source.split(/[\\/]/u).pop() || source}`;
	if (source === "builtin" || source.startsWith("inline:")) return t("skillsConnections.builtinSource");
	if (source === "auto") return t("skillsConnections.autoSource");
	if (source === "local") return t("skillsConnections.localSource");
	return source;
}

const CONNECTOR_DESCRIPTION_KEYS: Record<string, string> = {
	crossref: "crossref",
	doi: "doi",
	"europe-pmc": "europePmc",
	ena: "ena",
	openalex: "openalex",
	pubmed: "pubmed",
	zenodo: "zenodo",
	osf: "osf",
	sra: "sra",
	zotero: "zotero",
	protocols: "protocols",
	institutional: "institutional",
	"project-storage": "projectStorage",
};

const CONNECTOR_KINDS = [
	"literature",
	"citation",
	"dataset",
	"protocol",
	"project-storage",
	"institutional",
] as const;

/** Chinese/English category for a connector instead of the raw `kind · id` engineering line. */
function connectorKindLabel(
	kind: ResearchConnectorDescriptor["kind"],
	t: (key: any, params?: Record<string, string | number>) => string,
): string {
	return (CONNECTOR_KINDS as readonly string[]).includes(kind)
		? t(`skillsConnections.connectorKind.${kind}`)
		: String(kind);
}

function connectorDescription(
	id: string,
	kind: ResearchConnectorDescriptor["kind"],
	t: (key: any, params?: Record<string, string | number>) => string,
): string {
	const key = CONNECTOR_DESCRIPTION_KEYS[id];
	return key
		? t(`skillsConnections.connectorDescription.${key}`)
		: t("skillsConnections.connectorDescription.generic", { kind });
}

export function skillSource(
	skillName: string,
	source: string,
	scope: string,
	upstream?: Pick<LoadedSkill, "repository" | "repositoryCommit" | "repositoryPath">,
): {
	key: string;
	profile?: ReturnType<typeof researchSkillProfile>;
	repository?: { url: string; path: string };
} {
	if (upstream?.repository) {
		const repository = upstream.repository.replace(/^https?:\/\/github\.com\//u, "");
		return {
			key: `github:${repository}`,
			repository: {
				url: `https://github.com/${repository}`,
				path: upstream.repositoryPath ?? "",
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
		},
	};
}

function IconForKind({ kind }: { kind: CapabilityRow["kind"] }) {
	if (kind === "connector") return <ZoteroIcon size={17} />;
	if (kind === "mcp") return <ListIcon size={17} />;
	return <TaskBoardIcon size={17} />;
}

/** Market and skills have dedicated sections instead of mixed capability rows. */
export function capabilitySectionKind(section: CapabilitySection): CapabilityRow["kind"] | null {
	if (section === "connectors") return "connector";
	if (section === "mcp") return "mcp";
	return null;
}

/** Zotero is rendered in the status row so its read toggle and write drawer stay together. */
export function connectorCatalogEntries(
	connectors: readonly ResearchConnectorDescriptor[],
): ResearchConnectorDescriptor[] {
	// Zotero and institutional access each keep one combined row (switch + configure drawer).
	return connectors.filter((connector) => connector.id !== "zotero" && connector.id !== "institutional");
}

export function SkillsConnectionsView() {
	const t = useT();
	const pluginSections = usePluginEntries(UI_REGIONS.SkillsSection);
	const cwd = useSessionsStore((state) => state.cwd);
	const activeSessionId = useSessionsStore((state) => state.activeSessionId);
	const settingsSkills = useSettingsStore((state) => state.skills);
	const diagnostics = useSettingsStore((state) => state.skillDiagnostics);
	const refreshSettings = useSettingsStore((state) => state.refresh);
	const loadPlugins = useUiPluginsStore((state) => state.loadAll);
	const requestedDrawer = useUiStore((state) => state.capabilityDrawer);
	const clearRequestedDrawer = useUiStore((state) => state.setCapabilityDrawer);
	const [mcp, setMcp] = useState<McpStatus | null>(null);
	const [connectors, setConnectors] = useState<ResearchConnectorDescriptor[]>([]);
	const [connectorLoading, setConnectorLoading] = useState(false);
	const [connectorPending, setConnectorPending] = useState<string | null>(null);
	const [zotero, setZotero] = useState<ZoteroStatus | null>(null);
	const [zoteroWeb, setZoteroWeb] = useState<ZoteroWebApiStatus | null>(null);
	const [zoteroLocal, setZoteroLocal] = useState<ZoteroLocalWriteStatus | null>(null);
	const [institutional, setInstitutional] = useState<InstitutionalStatus | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [section, setSection] = useState<CapabilitySection>("market");
	const [pendingMcp, setPendingMcp] = useState<string | null>(null);
	const [pendingSkillGroup, setPendingSkillGroup] = useState<string | null>(null);
	const [disabledSkillNames, setDisabledSkillNames] = useState<Set<string>>(() => new Set());
	const [drawer, setDrawer] = useState<DrawerKind | null>(null);
	const [skillRepositories, setSkillRepositories] = useState<SkillRepositoryRecord[]>([]);
	const [repositoryDialog, setRepositoryDialog] = useState(false);
	const [repositoryBusy, setRepositoryBusy] = useState<string | null>(null);
	const [repositoryDraft, setRepositoryDraft] = useState<SkillRepositoryAddInput>({
		kind: "git",
		source: "",
		license: "",
	});
	const skillUpdateState = useResearchSkillUpdateStore((state) => state.state);
	const checkResearchSkills = useResearchSkillUpdateStore((state) => state.check);
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
			getPi().getZoteroStatus(),
			getPi().getZoteroWebApi(),
			getPi().getZoteroLocalWrite(),
			getPi().getInstitutionalStatus(),
			typeof getPi().listSkillRepositories === "function"
				? getPi().listSkillRepositories()
				: Promise.resolve([]),
		]);
		const [
			settingsResult,
			,
			mcpResult,
			zoteroResult,
			webResult,
			localResult,
			institutionalResult,
			repositoriesResult,
		] = results;
		if (mcpResult.status === "fulfilled") setMcp(mcpResult.value);
		if (zoteroResult.status === "fulfilled") setZotero(zoteroResult.value);
		if (webResult.status === "fulfilled") setZoteroWeb(webResult.value);
		if (localResult.status === "fulfilled") setZoteroLocal(localResult.value);
		if (institutionalResult.status === "fulfilled") setInstitutional(institutionalResult.value);
		if (repositoriesResult?.status === "fulfilled") setSkillRepositories(repositoriesResult.value);
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
	useEffect(() => {
		if (section !== "connectors") return;
		setConnectorLoading(true);
		void getPi()
			.listConnectors()
			.then((result) => setConnectors(result.connectors))
			.catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
			.finally(() => setConnectorLoading(false));
	}, [section]);
	const toggleConnector = async (connector: ResearchConnectorDescriptor) => {
		setConnectorPending(connector.id);
		setError(null);
		try {
			const next = await getPi().setConnectorEnabled({ id: connector.id, enabled: !connector.enabled });
			setConnectors((current) => current.map((item) => (item.id === next.id ? next : item)));
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setConnectorPending(null);
		}
	};

	const rows = useMemo<CapabilityRow[]>(() => {
		const next: CapabilityRow[] = [];
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
		const zoteroConnector = connectors.find((connector) => connector.id === "zotero");
		if (zotero || zoteroConnector) {
			// The `connector:webdav` route is intentionally owned by Knowledge settings;
			// this page keeps only the Zotero read switch and its write drawer together.
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
				scope: t("skillsConnections.readOnlyScope"),
				status: zoteroCapabilityStatus(zotero, zoteroConnector?.enabled ?? true),
				action: "zotero",
				connectorId: zoteroConnector?.id,
			});
		}
		const institutionalConnector = connectors.find((connector) => connector.id === "institutional");
		if (institutional) {
			next.push({
				id: "connector:institutional",
				kind: "connector",
				name: t("skillsConnections.institutional"),
				description: institutional.loggedIn
					? t("skillsConnections.institutionalLoggedIn")
					: t("skillsConnections.institutionalDescription"),
				scope: institutional.config.institutionName ?? t("skillsConnections.readOnlyScope"),
				status:
					institutionalConnector && !institutionalConnector.enabled
						? "disabled"
						: institutional.loggedIn
							? "available"
							: institutional.config.configured
								? "permission"
								: "configure",
				action: "institutional",
				connectorId: institutionalConnector?.id,
			});
		}
		return next;
	}, [connectors, institutional, mcp, t, zotero, zoteroLocal, zoteroWeb]);

	const visibleRows = useMemo(() => {
		const kind = capabilitySectionKind(section);
		if (!kind) return [];
		return rows.filter((row) => row.kind === kind);
	}, [rows, section]);
	const catalogConnectors = useMemo(() => connectorCatalogEntries(connectors), [connectors]);
	const skillGroups = useMemo(() => {
		type GroupedSkill = {
			skill: NonNullable<typeof settingsSkills>[number];
			sources: string[];
			repository?: { url: string; path: string };
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
	const statusLabel = (status: CapabilityStatus) => t(`skillsConnections.status.${status}` as never);
	const openSettings = (category: DrawerKind) => setDrawer(category);
	const skillUpdateBusy = skillUpdateState?.phase === "checking" || skillUpdateState?.phase === "downloading";
	const skillUpdateLabel =
		skillUpdateState?.phase === "ready" ? t("update.skillsRestart") : t("update.skillsUpdate");
	const refreshSkillRepositories = useCallback(async () => {
		if (typeof getPi().listSkillRepositories !== "function") return;
		try {
			setSkillRepositories(await getPi().listSkillRepositories());
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		}
	}, []);
	useEffect(() => {
		if (section === "skills") void refreshSkillRepositories();
	}, [refreshSkillRepositories, section]);
	const updateRepositoryInState = (repository: SkillRepositoryRecord) =>
		setSkillRepositories((current) =>
			current.some((item) => item.id === repository.id)
				? current.map((item) => (item.id === repository.id ? repository : item))
				: [...current, repository],
		);
	const checkSkillRepository = async (repository: SkillRepositoryRecord) => {
		setRepositoryBusy(repository.id);
		setError(null);
		try {
			const result = await getPi().checkSkillRepository(repository.id);
			updateRepositoryInState(result.repository);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setRepositoryBusy(null);
		}
	};
	const updateSkillRepository = async (repository: SkillRepositoryRecord) => {
		if (repository.status !== "update-available") {
			await checkSkillRepository(repository);
			return;
		}
		const shouldApply = window.confirm(
			t("skillsConnections.repositoryApplyConfirm", { name: repository.name }),
		);
		if (!shouldApply) return;
		setRepositoryBusy(repository.id);
		setError(null);
		try {
			const result = await getPi().updateSkillRepository(repository.id);
			updateRepositoryInState(result.repository);
			await restartForResearchSkillsWithGuard();
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setRepositoryBusy(null);
		}
	};
	const removeSkillRepository = async (repository: SkillRepositoryRecord) => {
		if (!window.confirm(t("skillsConnections.repositoryRemoveConfirm", { name: repository.name }))) return;
		setRepositoryBusy(repository.id);
		setError(null);
		try {
			await getPi().removeSkillRepository(repository.id);
			setSkillRepositories((current) => current.filter((item) => item.id !== repository.id));
			await restartForResearchSkillsWithGuard();
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setRepositoryBusy(null);
		}
	};
	const submitSkillRepository = async () => {
		setError(null);
		if (!repositoryDraft.source.trim() || !repositoryDraft.license.trim()) {
			setError(t("skillsConnections.repositoryRequired"));
			return;
		}
		setRepositoryBusy("new");
		try {
			const repository = await getPi().addSkillRepository({
				...repositoryDraft,
				source: repositoryDraft.source.trim(),
				license: repositoryDraft.license.trim(),
			});
			updateRepositoryInState(repository);
			setRepositoryDialog(false);
			setRepositoryDraft({ kind: "git", source: "", license: "" });
			await restartForResearchSkillsWithGuard();
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setRepositoryBusy(null);
		}
	};
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
		<PageShell testId="skills-connections-view">
			{pluginSections.map((entry) => (
				<section key={entry.id} className="mb-4" data-plugin={entry.pluginName}>
					<PluginEntryHost entry={entry} />
				</section>
			))}
			<PageHeader
				title={t("skillsConnections.title")}
				description={t("skillsConnections.description")}
				actions={
					<>
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
					</>
				}
			/>
			<div>
				<div className="mt-8 grid gap-4 md:grid-cols-[170px_minmax(0,1fr)]">
					<nav
						className="sticky top-4 z-10 max-h-[calc(100vh-2rem)] self-start overflow-y-auto rounded-2xl border border-border bg-surface p-2"
						aria-label={t("skillsConnections.filters")}
					>
						{(
							[
								["market", "market"],
								["connectors", "connector"],
								["mcp", "mcp"],
								["skills", "skill"],
							] as const
						).map(([id, label]) => (
							<button
								key={id}
								type="button"
								className={`mb-1 w-full rounded-xl px-3 py-2 text-left text-xs last:mb-0 ${section === id ? "bg-highlight font-medium text-ink" : "text-ink-dim hover:bg-hover"}`}
								onClick={() => setSection(id)}
								aria-current={section === id ? "page" : undefined}
							>
								{t(`skillsConnections.filter.${label}` as never)}
							</button>
						))}
					</nav>
					<main className="min-w-0">
						{section === "market" ? <PluginSourcesSection /> : null}
						{section === "skills" ? (
							<section
								className="rounded-2xl border border-border bg-surface"
								data-testid="research-skill-sources"
							>
								<div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-4">
									<div className="min-w-0">
										<h2 className="text-sm font-semibold text-ink">
											{t("skillsConnections.skillsCardTitle")}
										</h2>
										<p className="mt-1 truncate text-xs text-ink-dim">
											{skillUpdateState?.phase === "available"
												? t("update.skillsAvailable", { count: skillUpdateState.packs.length })
												: skillUpdateState?.phase === "ready"
													? t("update.skillsReady")
													: skillUpdateState?.phase === "up-to-date"
														? t("update.skillsUpToDate")
														: skillUpdateState?.phase === "error"
															? t("update.skillsFailed", { message: skillUpdateState.message })
															: skillUpdateBusy
																? t("update.skillsChecking")
																: t("update.skillsNotChecked")}
										</p>
									</div>
									<div className="flex shrink-0 flex-wrap gap-2">
										<button
											type="button"
											className="rounded-full border border-border px-3 py-2 text-xs text-ink-2 hover:bg-hover disabled:opacity-60"
											disabled={skillUpdateBusy}
											onClick={() => void checkResearchSkills()}
										>
											{skillUpdateBusy ? t("update.skillsChecking") : t("skillsConnections.checkUpdates")}
										</button>
										{["available", "ready"].includes(skillUpdateState?.phase ?? "") ? (
											<button
												type="button"
												className="rounded-full bg-ink px-3 py-2 text-xs text-canvas hover:opacity-90 disabled:opacity-50"
												disabled={skillUpdateBusy}
												onClick={() =>
													void (skillUpdateState?.phase === "ready"
														? restartForResearchSkillsWithGuard()
														: getPi().updateResearchSkills())
												}
											>
												{skillUpdateLabel}
											</button>
										) : null}
										<button
											type="button"
											className="rounded-full border border-border px-3 py-2 text-xs text-ink-2 hover:bg-hover"
											onClick={() => setRepositoryDialog(true)}
										>
											+ {t("skillsConnections.addRepository")}
										</button>
									</div>
								</div>
								{skillUpdateBusy ? (
									<div
										className="px-5 pb-3"
										role="progressbar"
										aria-valuemin={0}
										aria-valuemax={100}
										aria-valuenow={
											skillUpdateState?.phase === "downloading" ? skillUpdateState.percent : undefined
										}
									>
										<div className="h-1.5 overflow-hidden rounded-full bg-hover">
											<div
												className={`h-full rounded-full bg-accent ${skillUpdateState?.phase === "downloading" ? "transition-[width]" : "w-1/3 animate-pulse"}`}
												style={
													skillUpdateState?.phase === "downloading"
														? { width: `${skillUpdateState.percent}%` }
														: undefined
												}
											/>
										</div>
									</div>
								) : null}
								<ul
									className="divide-y divide-border border-t border-border"
									data-testid="skill-source-groups"
								>
									{skillGroups.map((group) => {
										const research = researchSourceCards.find(
											(source) => group.source === `github:${source.repository}`,
										);
										const repositoryUrl = group.source.startsWith("github:")
											? `https://github.com/${group.source.slice("github:".length)}`
											: null;
										const groupOn = group.skills.some(({ skill }) => !disabledSkillNames.has(skill.name));
										const hasUpdate =
											research &&
											skillUpdateState?.phase === "available" &&
											skillUpdateState.packs.some((pack) => pack.id === research.id);
										return (
											<li key={group.source}>
												<details className="group/source">
													<summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3 [&::-webkit-details-marker]:hidden">
														<span
															aria-hidden="true"
															className="text-ink-faint transition-transform group-open/source:rotate-90"
														>
															›
														</span>
														<span className="min-w-0 flex-1">
															<span className="block truncate text-sm font-medium text-ink">
																{sourceLabel(group.source, group.scope, t)}
															</span>
															<span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-faint">
																<span>
																	{group.skills.length} {t("skillsConnections.skillsCount")}
																</span>
																{repositoryUrl ? (
																	<button
																		type="button"
																		className="text-accent hover:underline"
																		onClick={(event) => {
																			event.preventDefault();
																			void getPi().openExternal(repositoryUrl);
																		}}
																	>
																		{t("skillsConnections.openRepository")}
																	</button>
																) : null}
																{hasUpdate ? (
																	<span className="text-warn">
																		{t("update.skillsAvailable", { count: 1 })}
																	</span>
																) : null}
															</span>
														</span>
														<Switch
															checked={groupOn}
															disabled={pendingSkillGroup === group.source}
															onCheckedChange={(enabled) =>
																void setSkillGroupEnabled(
																	group.source,
																	group.skills.map(({ skill }) => skill.name),
																	enabled,
																)
															}
															aria-label={
																groupOn
																	? t("skillsConnections.disableGroup")
																	: t("skillsConnections.enableGroup")
															}
														/>
													</summary>
													<ul className="divide-y divide-border border-t border-border bg-canvas">
														{group.skills.map(({ skill, sources }) => {
															const on = !disabledSkillNames.has(skill.name);
															return (
																<li key={skill.name} className="flex items-center gap-3 py-2 pl-10 pr-5">
																	<span className="min-w-0 flex-1">
																		<span className="block truncate text-[13px] text-ink">{skill.name}</span>
																		{skill.description ? (
																			<span className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-ink-dim">
																				{skill.description}
																			</span>
																		) : null}
																		<span className="mt-0.5 block truncate text-[11px] text-ink-faint">
																			/skill:{skill.name}
																			{skill.repository
																				? ""
																				: ` · ${t("skillsConnections.repositoryUnknown")}`}
																			{sources.length > 1
																				? ` · ${t("skillsConnections.moreSources", { count: sources.length - 1 })}`
																				: ""}
																		</span>
																	</span>
																	{skill.disableModelInvocation && on ? (
																		<span className="text-xs text-warn">
																			{t("skillsConnections.manualOnly")}
																		</span>
																	) : null}
																	<Switch
																		checked={on}
																		disabled={pendingSkillGroup === `skill:${skill.name}`}
																		onCheckedChange={(enabled) =>
																			void setSkillGroupEnabled(`skill:${skill.name}`, [skill.name], enabled)
																		}
																		aria-label={
																			on ? t("skillsConnections.disable") : t("skillsConnections.enable")
																		}
																	/>
																</li>
															);
														})}
													</ul>
												</details>
											</li>
										);
									})}
									{researchSourceCards
										.filter(
											(source) =>
												!skillGroups.some((group) => group.source === `github:${source.repository}`),
										)
										.map((source) => (
											<li key={source.id}>
												<details className="group/source">
													<summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3 [&::-webkit-details-marker]:hidden">
														<span
															aria-hidden="true"
															className="text-ink-faint transition-transform group-open/source:rotate-90"
														>
															›
														</span>
														<span className="min-w-0 flex-1">
															<span className="block truncate text-sm font-medium text-ink">
																{t(`skillsConnections.sourceName.${source.id}` as never)}
															</span>
															<span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-faint">
																<span>
																	{source.bundled} {t("skillsConnections.skillsCount")}
																</span>
																<button
																	type="button"
																	className="text-accent hover:underline"
																	onClick={(event) => {
																		event.preventDefault();
																		void getPi().openExternal(`https://github.com/${source.repository}`);
																	}}
																>
																	{t("skillsConnections.openRepository")}
																</button>
																<span>{t("skillsConnections.catalogOnlyNotLoaded")}</span>
															</span>
														</span>
														<span className="w-[42px] shrink-0 text-right text-xs text-ink-faint">
															{t("skillsConnections.notLoaded")}
														</span>
													</summary>
													<ul className="divide-y divide-border border-t border-border bg-canvas">
														{source.skills.map((skill) => (
															<li key={skill.name} className="flex items-center gap-3 py-2 pl-10 pr-5">
																<span className="min-w-0 flex-1">
																	<span className="block truncate text-[13px] text-ink">{skill.name}</span>
																	<span className="mt-0.5 block truncate text-[11px] text-ink-faint">
																		{skill.path} · {skill.license}
																	</span>
																</span>
																<span className="text-xs text-ink-faint">
																	{t("skillsConnections.notLoaded")}
																</span>
															</li>
														))}
													</ul>
												</details>
											</li>
										))}
									{skillRepositories.map((repository) => (
										<li key={repository.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
											<span className="min-w-0 flex-1">
												<span className="block truncate text-sm font-medium text-ink">{repository.name}</span>
												<span className="mt-0.5 block truncate text-xs text-ink-faint">
													{repository.kind === "git" ? "Git" : t("skillsConnections.localSource")} ·{" "}
													{repository.source}
													{repository.ref ? ` · ${repository.ref}` : ""} ·{" "}
													{t("skillsConnections.repositoryMeta", {
														count: repository.skillCount,
														license: repository.license,
													})}
												</span>
												{repository.lastError ? (
													<span className="mt-0.5 block truncate text-xs text-danger">
														{repository.lastError}
													</span>
												) : null}
											</span>
											<button
												type="button"
												className="rounded-full border border-border px-3 py-2 text-xs text-ink-2 hover:bg-hover disabled:opacity-50"
												disabled={repositoryBusy === repository.id}
												onClick={() => void checkSkillRepository(repository)}
											>
												{repositoryBusy === repository.id
													? t("skillsConnections.repositoryWorking")
													: t("skillsConnections.repositoryCheck")}
											</button>
											{repository.status === "update-available" ? (
												<button
													type="button"
													className="rounded-full bg-ink px-3 py-2 text-xs text-canvas hover:opacity-90 disabled:opacity-50"
													disabled={repositoryBusy === repository.id}
													onClick={() => void updateSkillRepository(repository)}
												>
													{t("skillsConnections.repositoryApply")}
												</button>
											) : null}
											<button
												type="button"
												className="rounded-full border border-danger/30 px-3 py-2 text-xs text-danger hover:bg-danger/5 disabled:opacity-50"
												disabled={repositoryBusy === repository.id}
												onClick={() => void removeSkillRepository(repository)}
											>
												{t("skillsConnections.repositoryRemove")}
											</button>
										</li>
									))}
								</ul>
								{diagnostics.length > 0 ? (
									<details className="border-t border-border px-5 py-3 text-xs">
										<summary className="cursor-pointer select-none text-warn">
											{t("skillsConnections.diagnostics", { count: diagnostics.length })}
										</summary>
										<ul className="mt-2 space-y-2">
											{diagnostics.map((diagnostic) => (
												<li
													key={`${diagnostic.type}:${diagnostic.path ?? ""}:${diagnostic.message}`}
													className="rounded-lg bg-hover px-3 py-2 leading-relaxed"
												>
													<span
														className={
															diagnostic.type === "error" ? "font-medium text-err" : "font-medium text-warn"
														}
													>
														{t(`skillsConnections.diagnosticType.${diagnostic.type}` as never)}
													</span>{" "}
													<span className="text-ink-2">{diagnostic.message}</span>
													{diagnostic.path ? (
														<span className="mt-0.5 block break-all font-mono text-[11px] text-ink-faint">
															{diagnostic.path}
														</span>
													) : null}
												</li>
											))}
										</ul>
									</details>
								) : null}
							</section>
						) : null}

						{error && (
							<p className="mt-4 rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-xs text-danger">
								{error}
							</p>
						)}
						{section === "connectors" ? (
							<section
								className="rounded-2xl border border-border bg-surface px-4 py-4"
								data-testid="connector-catalog"
							>
								<div className="flex items-baseline justify-between gap-3">
									<div>
										<h2 className="text-sm font-medium text-ink">
											{t("skillsConnections.connectorCatalog")}
										</h2>
										<p className="mt-1 text-xs text-ink-dim">{t("skillsConnections.connectorCatalogHint")}</p>
									</div>
								</div>
								{connectorLoading ? (
									<p className="py-8 text-center text-xs text-ink-faint">{t("skillsConnections.loading")}</p>
								) : catalogConnectors.length === 0 ? (
									<p className="py-8 text-center text-xs text-ink-faint">{t("skillsConnections.empty")}</p>
								) : (
									<ul className="mt-3 divide-y divide-border">
										{catalogConnectors.map((connector) => (
											<li
												key={connector.id}
												className="grid items-center gap-3 py-3 md:grid-cols-[minmax(0,2fr)_minmax(140px,1fr)_120px_136px]"
											>
												<div className="min-w-0">
													<p className="truncate text-sm font-medium text-ink">{connector.label}</p>
													<p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-dim">
														{connectorDescription(connector.id, connector.kind, t)}
													</p>
												</div>
												<p className="text-xs text-ink-faint">{connectorKindLabel(connector.kind, t)}</p>
												<span className="text-xs text-ink-faint">
													{connector.enabled ? "" : t("skillsConnections.disabled")}
												</span>
												<span className="flex justify-end">
													<Switch
														checked={connector.enabled}
														disabled={connectorPending === connector.id}
														onCheckedChange={() => void toggleConnector(connector)}
														aria-label={
															connector.enabled
																? t("skillsConnections.disable")
																: t("skillsConnections.enable")
														}
													/>
												</span>
											</li>
										))}
									</ul>
								)}
								{/* Zotero and institutional access live in the same card as the other connectors. */}
								<div className="-mx-4 mt-1 divide-y divide-border border-t border-border">
									{visibleRows.map((row) => {
										const server =
											row.kind === "mcp" ? mcp?.servers.find((item) => item.name === row.action) : undefined;
										const connector = row.connectorId
											? connectors.find((item) => item.id === row.connectorId)
											: undefined;
										return (
											<div
												key={row.id}
												className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,2fr)_minmax(140px,1fr)_120px_136px] md:items-center"
											>
												<div className="flex min-w-0 items-start gap-3">
													<span className="mt-0.5 text-ink-dim">
														<IconForKind kind={row.kind} />
													</span>
													<div className="min-w-0">
														<p className="truncate text-sm font-medium text-ink">
															{row.name}
															{row.version ? (
																<span className="ml-2 text-xs font-normal text-ink-faint">
																	v{row.version}
																</span>
															) : null}
														</p>
														<p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-dim">
															{row.description}
														</p>
													</div>
												</div>
												<p className="truncate text-xs text-ink-faint" title={row.scope}>
													{row.scope}
												</p>
												{row.status === "available" ? (
													<div />
												) : (
													<div
														className={`flex items-center gap-2 text-xs font-medium ${statusTone(row.status)}`}
													>
														<span
															className={`h-2 w-2 rounded-full ${row.status === "running" ? "animate-pulse bg-ok" : row.status === "error" || row.status === "incompatible" ? "bg-err" : row.status === "disabled" ? "bg-ink-faint" : "bg-warn"}`}
														/>
														{statusLabel(row.status)}
													</div>
												)}
												<div className="flex justify-end">
													{connector ? (
														<div className="flex items-center gap-2">
															<Switch
																checked={connector.enabled}
																disabled={connectorPending === connector.id}
																onCheckedChange={() => void toggleConnector(connector)}
																aria-label={
																	connector.enabled
																		? t("skillsConnections.disable")
																		: t("skillsConnections.enable")
																}
															/>
															<button
																type="button"
																className="rounded-full border border-border px-3 py-2 text-xs text-ink-2 hover:bg-hover"
																onClick={() => openSettings(row.action as DrawerKind)}
															>
																{row.status === "configure" || row.status === "permission"
																	? t("skillsConnections.configure")
																	: t("skillsConnections.view")}
															</button>
														</div>
													) : server ? (
														<div className="flex items-center gap-2">
															<Switch
																checked={!server.disabled}
																disabled={pendingMcp === server.name}
																onCheckedChange={(enabled) => {
																	setPendingMcp(server.name);
																	void getPi()
																		.setMcpServerEnabled(server.name, enabled, cwd ?? undefined)
																		.then(() => getPi().getMcpStatus(cwd ?? undefined))
																		.then(setMcp)
																		.catch((reason) =>
																			setError(reason instanceof Error ? reason.message : String(reason)),
																		)
																		.finally(() => setPendingMcp(null));
																}}
																aria-label={
																	server.disabled
																		? t("skillsConnections.enable")
																		: t("skillsConnections.disable")
																}
															/>
															<button
																type="button"
																className="rounded-full border border-border px-3 py-2 text-xs text-ink-2 hover:bg-hover"
																onClick={() => openSettings("mcp")}
															>
																{row.status === "configure"
																	? t("skillsConnections.configure")
																	: t("skillsConnections.view")}
															</button>
														</div>
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
							</section>
						) : null}
						{section === "mcp" && loading && rows.length === 0 ? (
							<p className="py-16 text-center text-sm text-ink-faint">{t("skillsConnections.loading")}</p>
						) : null}
						{section === "mcp" ? (
							<section className="rounded-2xl border border-border bg-surface" data-testid="mcp-servers">
								<div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-4">
									<div className="min-w-0">
										<h2 className="text-sm font-semibold text-ink">{t("skillsConnections.mcpCardTitle")}</h2>
										<p className="mt-1 text-xs text-ink-dim">{t("skillsConnections.mcpCardHint")}</p>
									</div>
									<button
										type="button"
										className="rounded-full bg-ink px-3 py-2 text-xs text-canvas hover:opacity-90"
										onClick={() => openSettings("mcp")}
									>
										+ {t("skillsConnections.addMcp")}
									</button>
								</div>
								<div className="divide-y divide-border border-t border-border">
									{visibleRows.map((row) => {
										const server =
											row.kind === "mcp" ? mcp?.servers.find((item) => item.name === row.action) : undefined;
										const connector = row.connectorId
											? connectors.find((item) => item.id === row.connectorId)
											: undefined;
										return (
											<div
												key={row.id}
												className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,2fr)_minmax(140px,1fr)_120px_136px] md:items-center"
											>
												<div className="flex min-w-0 items-start gap-3">
													<span className="mt-0.5 text-ink-dim">
														<IconForKind kind={row.kind} />
													</span>
													<div className="min-w-0">
														<p className="truncate text-sm font-medium text-ink">
															{row.name}
															{row.version ? (
																<span className="ml-2 text-xs font-normal text-ink-faint">
																	v{row.version}
																</span>
															) : null}
														</p>
														<p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-dim">
															{row.description}
														</p>
													</div>
												</div>
												<p className="truncate text-xs text-ink-faint" title={row.scope}>
													{row.scope}
												</p>
												{row.status === "available" ? (
													<div />
												) : (
													<div
														className={`flex items-center gap-2 text-xs font-medium ${statusTone(row.status)}`}
													>
														<span
															className={`h-2 w-2 rounded-full ${row.status === "running" ? "animate-pulse bg-ok" : row.status === "error" || row.status === "incompatible" ? "bg-err" : row.status === "disabled" ? "bg-ink-faint" : "bg-warn"}`}
														/>
														{statusLabel(row.status)}
													</div>
												)}
												<div className="flex justify-end">
													{connector ? (
														<div className="flex items-center gap-2">
															<Switch
																checked={connector.enabled}
																disabled={connectorPending === connector.id}
																onCheckedChange={() => void toggleConnector(connector)}
																aria-label={
																	connector.enabled
																		? t("skillsConnections.disable")
																		: t("skillsConnections.enable")
																}
															/>
															<button
																type="button"
																className="rounded-full border border-border px-3 py-2 text-xs text-ink-2 hover:bg-hover"
																onClick={() => openSettings(row.action as DrawerKind)}
															>
																{row.status === "configure" || row.status === "permission"
																	? t("skillsConnections.configure")
																	: t("skillsConnections.view")}
															</button>
														</div>
													) : server ? (
														<div className="flex items-center gap-2">
															<Switch
																checked={!server.disabled}
																disabled={pendingMcp === server.name}
																onCheckedChange={(enabled) => {
																	setPendingMcp(server.name);
																	void getPi()
																		.setMcpServerEnabled(server.name, enabled, cwd ?? undefined)
																		.then(() => getPi().getMcpStatus(cwd ?? undefined))
																		.then(setMcp)
																		.catch((reason) =>
																			setError(reason instanceof Error ? reason.message : String(reason)),
																		)
																		.finally(() => setPendingMcp(null));
																}}
																aria-label={
																	server.disabled
																		? t("skillsConnections.enable")
																		: t("skillsConnections.disable")
																}
															/>
															<button
																type="button"
																className="rounded-full border border-border px-3 py-2 text-xs text-ink-2 hover:bg-hover"
																onClick={() => openSettings("mcp")}
															>
																{row.status === "configure"
																	? t("skillsConnections.configure")
																	: t("skillsConnections.view")}
															</button>
														</div>
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
									{!loading && visibleRows.length === 0 ? (
										<p className="px-5 py-8 text-center text-xs text-ink-faint">
											{t("skillsConnections.noMcp")}
										</p>
									) : null}
								</div>
								<div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-5 py-3 text-xs text-ink-faint">
									<span>{t("skillsConnections.mcpDirectories")}</span>
									{MARKET_RESOURCE_LINKS.filter((resource) => resource.kind.startsWith("mcp")).map(
										(resource) => (
											<button
												key={resource.id}
												type="button"
												className="text-accent hover:underline"
												title={resource.description}
												onClick={() => void getPi().openExternal(resource.url)}
											>
												{resource.name}
											</button>
										),
									)}
								</div>
							</section>
						) : null}
					</main>
				</div>
			</div>
			{repositoryDialog && (
				<div
					className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4"
					role="presentation"
				>
					<div
						className="w-full max-w-lg rounded-2xl border border-border bg-surface p-5 shadow-2xl"
						role="dialog"
						aria-modal="true"
						aria-labelledby="skill-repository-dialog-title"
					>
						<div className="flex items-center justify-between gap-3">
							<h2 id="skill-repository-dialog-title" className="text-sm font-semibold text-ink">
								{t("skillsConnections.addRepository")}
							</h2>
							<button
								type="button"
								className="rounded-lg px-2 py-1 text-ink-faint hover:bg-hover"
								onClick={() => setRepositoryDialog(false)}
								aria-label={t("common.close")}
							>
								✕
							</button>
						</div>
						<div className="mt-4 space-y-3">
							<div className="flex gap-2">
								{(["git", "local"] as const).map((kind) => (
									<button
										key={kind}
										type="button"
										className={`rounded-full border px-3 py-2 text-xs ${repositoryDraft.kind === kind ? "border-ink bg-ink text-canvas" : "border-border text-ink-2 hover:bg-hover"}`}
										onClick={() => setRepositoryDraft((draft) => ({ ...draft, kind }))}
									>
										{kind === "git" ? "Git URL" : t("skillsConnections.localSource")}
									</button>
								))}
							</div>
							<label className="block text-xs text-ink-dim">
								<span>
									{repositoryDraft.kind === "git" ? "Git URL" : t("skillsConnections.localDirectory")}
								</span>
								<div className="mt-1 flex gap-2">
									<input
										className="min-w-0 flex-1 rounded-lg border border-border bg-canvas px-3 py-2 text-xs text-ink outline-none focus:border-ink"
										value={repositoryDraft.source}
										onChange={(event) =>
											setRepositoryDraft((draft) => ({ ...draft, source: event.target.value }))
										}
										placeholder={
											repositoryDraft.kind === "git" ? "https://github.com/org/repo.git" : "/path/to/skills"
										}
									/>
									{repositoryDraft.kind === "local" ? (
										<button
											type="button"
											className="rounded-lg border border-border px-3 py-2 text-xs text-ink-2 hover:bg-hover"
											onClick={async () => {
												const path = await getPi().pickPath("directory");
												if (path) setRepositoryDraft((draft) => ({ ...draft, source: path }));
											}}
										>
											{t("skillsConnections.browse")}
										</button>
									) : null}
								</div>
							</label>
							{repositoryDraft.kind === "git" ? (
								<label className="block text-xs text-ink-dim">
									<span>{t("skillsConnections.repositoryRef")}</span>
									<input
										className="mt-1 w-full rounded-lg border border-border bg-canvas px-3 py-2 text-xs text-ink outline-none focus:border-ink"
										value={repositoryDraft.ref ?? ""}
										onChange={(event) =>
											setRepositoryDraft((draft) => ({ ...draft, ref: event.target.value || undefined }))
										}
										placeholder="main"
									/>
								</label>
							) : null}
							<label className="block text-xs text-ink-dim">
								<span>{t("skillsConnections.repositoryLicense")}</span>
								<input
									className="mt-1 w-full rounded-lg border border-border bg-canvas px-3 py-2 text-xs text-ink outline-none focus:border-ink"
									value={repositoryDraft.license}
									onChange={(event) =>
										setRepositoryDraft((draft) => ({ ...draft, license: event.target.value }))
									}
									placeholder="MIT / Apache-2.0 / permission granted"
								/>
							</label>
							<label className="block text-xs text-ink-dim">
								<span>{t("skillsConnections.repositoryEvidence")}</span>
								<input
									className="mt-1 w-full rounded-lg border border-border bg-canvas px-3 py-2 text-xs text-ink outline-none focus:border-ink"
									value={repositoryDraft.licenseEvidence ?? ""}
									onChange={(event) =>
										setRepositoryDraft((draft) => ({
											...draft,
											licenseEvidence: event.target.value || undefined,
										}))
									}
									placeholder="LICENSE or permission URL"
								/>
							</label>
						</div>
						<div className="mt-5 flex justify-end gap-2">
							<button
								type="button"
								className="rounded-full border border-border px-3 py-2 text-xs text-ink-2 hover:bg-hover"
								onClick={() => setRepositoryDialog(false)}
							>
								{t("common.cancel")}
							</button>
							<button
								type="button"
								className="rounded-full bg-ink px-4 py-2 text-xs text-canvas hover:opacity-90 disabled:opacity-50"
								disabled={repositoryBusy === "new"}
								onClick={() => void submitSkillRepository()}
							>
								{repositoryBusy === "new"
									? t("skillsConnections.repositoryWorking")
									: t("skillsConnections.repositoryAdd")}
							</button>
						</div>
					</div>
				</div>
			)}
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
		</PageShell>
	);
}
