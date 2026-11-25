import type { BackendServices } from "@drone/backend";
import { DailyContract, KnowledgeContract, ZoteroContract } from "@drone/shared";
import { shell } from "electron";
import { bindContract, type ContractImplementation } from "./bind-contract";

/**
 * Host-coordinated knowledge routing.
 *
 * The desktop main process is the host's coordination layer: it knows a domain
 * group and an operation name, never a business method.  Each domain group
 * keeps one channel, and the operation name inside the envelope selects the
 * implementation.
 *
 * Two kinds of implementation sit behind a route:
 *
 * - Plugin-owned operations (overview, search, read, graph, reviews, topics,
 *   semantic index) are served by the installed knowledge plugin through the
 *   existing host port.  The host never reimplements them.
 * - Host-owned operations (WebDAV cloud, session-bound setup and review,
 *   maintenance settings, daily discovery, Zotero authorization) run in the
 *   host and are wired here directly.
 *
 * The table is also the authorization boundary: an operation that is not
 * listed never reaches an implementation.  The domain schemas and the
 * validation behind each operation belong to the plugin that owns the domain.
 */

/** One routed call: the operation name inside its domain group, plus its payload. */
interface Route {
	readonly operation: string;
	readonly run: (input: unknown) => unknown;
}

/** A domain group's operation table. */
type RouteTable = ReadonlyMap<string, (input: unknown) => unknown>;

/**
 * Build one domain group's operation table.
 *
 * A missing service simply omits its operations, so an absent capability
 * fails closed instead of reaching an unimplemented handler.
 */
function buildRoutes(routes: readonly Route[]): RouteTable {
	const table = new Map<string, (input: unknown) => unknown>();
	for (const route of routes) table.set(route.operation, route.run);
	return table;
}

/**
 * Resolve one routed call.
 *
 * An unknown operation is rejected before any implementation runs, so a
 * mistyped or unauthorized name never reaches a domain.
 */
function runRoute(table: RouteTable, operation: string, input: unknown): unknown {
	const run = table.get(operation);
	if (!run) throw new Error(`Unknown knowledge operation: ${operation}`);
	return run(input);
}

/** The services the route tables are assembled from. */
export interface KnowledgeRouteServices {
	readonly knowledge: BackendServices["knowledge"];
	readonly knowledgeSession: BackendServices["knowledgeSession"];
	readonly zotero: BackendServices["zotero"];
	readonly dailyDiscovery: BackendServices["dailyDiscovery"];
	readonly knowledgeMaintenance?: BackendServices["knowledgeMaintenance"];
}

/**
 * Assemble the three domain route tables.
 *
 * The operation names live here, in one place, as the host's allowlist.  Adding
 * a domain operation is one line in this file plus the implementation it names
 * — no new IPC channel, preload entry or generated projection.
 */
export function buildKnowledgeRouteTables(services: KnowledgeRouteServices): {
	knowledge: RouteTable;
	daily: RouteTable;
	zotero: RouteTable;
} {
	return {
		knowledge: buildKnowledgeRoutes(services),
		daily: buildDailyRoutes(services),
		zotero: buildZoteroRoutes(services),
	};
}

/** The knowledge group's operations: the plugin's domain plus the host's cloud and session routes. */
function buildKnowledgeRoutes(services: KnowledgeRouteServices): RouteTable {
	const { knowledge, knowledgeSession, knowledgeMaintenance } = services;
	return buildRoutes([
		{ operation: "cloud.status", run: () => knowledge.getCloudStatus() },
		{ operation: "cloud.probe", run: () => knowledge.probeCloud() },
		{ operation: "cloud.initialize", run: () => knowledge.initializeCloud() },
		{ operation: "cloud.setPassword", run: (input) => knowledge.setCloudPassword(input as never) },
		{ operation: "cloud.readNote", run: (input) => knowledge.readCloudNote(input as never) },
		{ operation: "cloud.writeNote", run: (input) => knowledge.writeCloudNote(input as never) },
		{ operation: "cloud.sync", run: (input) => knowledge.syncCloud(input as never) },
		{ operation: "specialist.settings", run: (input) => knowledge.specialistSettings(input as never) },
		{ operation: "overview", run: (input) => knowledge.overview(input as never) },
		{ operation: "research.runs", run: (input) => knowledge.researchRuns(input as never) },
		{ operation: "research.run", run: (input) => knowledge.researchRun(input as never) },
		{ operation: "setup.preview", run: (input) => knowledge.setupPreview(input as never) },
		{ operation: "setup.start", run: (input) => knowledgeSession.startSetup(input as never) },
		{ operation: "jobs", run: (input) => knowledge.jobs(input as never) },
		{ operation: "reviews.list", run: (input) => knowledge.reviews(input as never) },
		{ operation: "reviews.preview", run: (input) => knowledge.preview(input as never) },
		{ operation: "reviews.withModel", run: (input) => knowledgeSession.reviewWithModel(input as never) },
		{
			operation: "reviews.cancelModel",
			run: (input) => knowledgeSession.cancelModelReview(input as never),
		},
		{ operation: "reviews.decide", run: (input) => knowledge.decide(input as never) },
		{ operation: "read", run: (input) => knowledge.read(input as never) },
		{ operation: "maintain", run: (input) => knowledge.maintain(input as never) },
		{
			operation: "openTarget",
			run: async (input) => {
				const target = await knowledge.openTarget(input as never);
				if (target.kind === "note") {
					await shell.openExternal(`obsidian://open?path=${encodeURIComponent(target.path)}`);
					return;
				}
				const error = await shell.openPath(target.path);
				if (error) throw new Error(error);
			},
		},
		{ operation: "setup.resume", run: (input) => knowledgeSession.resumeCheck(input as string) },
		{ operation: "semantic.status", run: (input) => knowledge.semanticStatus(input as never) },
		{ operation: "semantic.saveSettings", run: (input) => knowledge.saveSemanticSettings(input as never) },
		{ operation: "semantic.testProvider", run: (input) => knowledge.testSemanticProvider(input as never) },
		{ operation: "semantic.index", run: (input) => knowledge.indexSemantic(input as never) },
		{ operation: "semantic.cancelIndex", run: (input) => knowledge.cancelSemanticIndex(input as never) },
		{ operation: "search", run: (input) => knowledge.search(input as never) },
		{ operation: "noteLinks", run: (input) => knowledge.noteLinks(input as never) },
		{ operation: "graph", run: (input) => knowledge.graph(input as never) },
		{ operation: "topics.list", run: (input) => knowledge.topics(input as never) },
		{ operation: "topics.archive", run: (input) => knowledge.archiveTopic(input as never) },
		{
			operation: "maintenance.settings",
			run: () =>
				knowledgeMaintenance?.getSettings() ??
				Promise.reject(new Error("Knowledge maintenance service unavailable")),
		},
		{
			operation: "maintenance.saveSettings",
			run: (input) =>
				knowledgeMaintenance?.saveSettings(input as never) ??
				Promise.reject(new Error("Knowledge maintenance service unavailable")),
		},
		{
			operation: "maintenance.run",
			run: (input) =>
				knowledgeMaintenance?.runNow((input as { cwd: string }).cwd) ??
				Promise.reject(new Error("Knowledge maintenance service unavailable")),
		},
		{
			operation: "maintenance.runs",
			run: () =>
				knowledgeMaintenance?.getRuns() ??
				Promise.reject(new Error("Knowledge maintenance service unavailable")),
		},
	]);
}

/** The daily discovery group's operations. */
function buildDailyRoutes(services: KnowledgeRouteServices): RouteTable {
	const { dailyDiscovery } = services;
	return buildRoutes([
		{ operation: "state", run: () => dailyDiscovery.getState() },
		{
			operation: "update",
			run: async (input) => {
				const payload = input as { enabled?: boolean; run?: boolean };
				if (typeof payload.enabled === "boolean") await dailyDiscovery.setEnabled(payload.enabled);
				return payload.run ? dailyDiscovery.run() : dailyDiscovery.getState();
			},
		},
		{
			operation: "decideIdea",
			run: (input) => {
				const { id, action } = input as { id: string; action: "save" | "dismiss" };
				return dailyDiscovery.decide(id, action);
			},
		},
		{
			operation: "decideRadarPaper",
			run: (input) => {
				const { id, action } = input as { id: string; action: "capture" | "dismiss" };
				return dailyDiscovery.decideRadarPaper(id, action);
			},
		},
	]);
}

/** The Zotero group's operations. */
function buildZoteroRoutes(services: KnowledgeRouteServices): RouteTable {
	const { zotero } = services;
	return buildRoutes([
		{ operation: "status", run: () => zotero.getStatus() },
		{
			operation: "webApi.get",
			run: async () => ({
				configured: false,
				source: null,
				libraryType: "users",
				libraryId: null,
				username: null,
				write: null,
				keyHint: null,
			}),
		},
		{
			operation: "webApi.save",
			run: async () => {
				throw new Error(
					"Zotero Web API keys are now saved under Settings → Plugins → pi-research → credentials",
				);
			},
		},
		{
			operation: "webApi.clear",
			run: async () => {
				throw new Error(
					"Zotero Web API keys are now saved under Settings → Plugins → pi-research → credentials",
				);
			},
		},
		{
			operation: "localWrite.get",
			run: () =>
				zotero.getLocalWrite
					? zotero.getLocalWrite()
					: Promise.reject(new Error("Zotero local write is unavailable")),
		},
		{
			operation: "localWrite.authorize",
			run: () =>
				zotero.authorizeLocalWrite
					? zotero.authorizeLocalWrite()
					: Promise.reject(new Error("Zotero local write is unavailable")),
		},
		{
			operation: "localWrite.clear",
			run: () =>
				zotero.clearLocalWrite
					? zotero.clearLocalWrite()
					: Promise.reject(new Error("Zotero local write is unavailable")),
		},
	]);
}

/**
 * Bind the three routed contracts to the main process.
 *
 * The main-frame guard runs before argument validation, so a child frame can
 * never probe the route table.
 */
export function bindKnowledgeRoutes(
	services: KnowledgeRouteServices,
	options: { readonly beforeInvoke?: (event: unknown) => void } = {},
): void {
	const tables = buildKnowledgeRouteTables(services);
	const implementation = <TContract extends typeof KnowledgeContract>(
		table: RouteTable,
	): ContractImplementation<TContract> =>
		({
			invoke: (route: { operation: string; input?: unknown }) =>
				runRoute(table, route.operation, route.input),
		}) as unknown as ContractImplementation<TContract>;
	bindContract(KnowledgeContract, implementation(tables.knowledge), {
		beforeInvoke: options.beforeInvoke,
	});
	bindContract(DailyContract, implementation(tables.daily), {
		beforeInvoke: options.beforeInvoke,
	});
	bindContract(ZoteroContract, implementation(tables.zotero), {
		beforeInvoke: options.beforeInvoke,
	});
}
