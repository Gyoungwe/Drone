import type { BackendServices, SessionServicePort } from "@drone/backend";
import { IpcChannels } from "@drone/shared";
import { BrowserWindow } from "electron";
import { bindKnowledgeRoutes } from "./knowledge-routes";

/**
 * Register the routed knowledge contracts.
 *
 * The operation tables live in `knowledge-routes.ts`; this module only resolves
 * the services the host actually has and forwards knowledge events to every
 * open window.
 */

/** The legacy session surface the host still accepts for the knowledge domain. */
type LegacySessionServices = SessionServicePort & {
	knowledge?: BackendServices["knowledge"];
	knowledgeSession?: BackendServices["knowledgeSession"];
	zotero?: BackendServices["zotero"];
	startKnowledgeSetup?: BackendServices["knowledgeSession"]["startSetup"];
	reviewKnowledgeWithModel?: BackendServices["knowledgeSession"]["reviewWithModel"];
	cancelKnowledgeModelReview?: BackendServices["knowledgeSession"]["cancelModelReview"];
	resumeKnowledgeCheck?: BackendServices["knowledgeSession"]["resumeCheck"];
	getZoteroStatus?: BackendServices["zotero"]["getStatus"];
};

/** The host services the routed contracts are assembled from. */
type KnowledgeHostServices = Pick<
	BackendServices,
	"knowledge" | "knowledgeSession" | "zotero" | "knowledgeMaintenance"
> &
	Partial<Pick<BackendServices, "dailyDiscovery">>;

/** Reject a daily-discovery call when the host has no discovery service. */
async function unavailableDailyDiscovery(): Promise<never> {
	throw new Error("Daily discovery is unavailable");
}

/** The daily discovery surface, or a stub that fails every mutating call. */
function resolveDailyDiscovery(
	hostServices: Partial<Pick<BackendServices, "dailyDiscovery">> | undefined,
): Pick<
	BackendServices["dailyDiscovery"],
	"getState" | "setEnabled" | "run" | "decide" | "decideRadarPaper"
> {
	return (
		hostServices?.dailyDiscovery ?? {
			getState: async () => ({ enabled: false, lastRunAt: null, ideas: [], radar: [] }),
			setEnabled: unavailableDailyDiscovery,
			run: unavailableDailyDiscovery,
			decide: unavailableDailyDiscovery,
			decideRadarPaper: unavailableDailyDiscovery,
		}
	);
}

/** The Zotero surface, falling back to the legacy status method when present. */
function resolveZotero(
	backend: SessionServicePort,
	legacy: LegacySessionServices,
	hostServices: KnowledgeHostServices | undefined,
): BackendServices["zotero"] {
	const direct =
		hostServices?.zotero ??
		("zotero" in backend ? (backend as { zotero: BackendServices["zotero"] }).zotero : undefined);
	if (direct) return direct;
	if (legacy.zotero) return legacy.zotero;
	if (legacy.getZoteroStatus) return { getStatus: legacy.getZoteroStatus.bind(backend) };
	return {
		getStatus: async () => {
			throw new Error("Zotero service is unavailable");
		},
	};
}

/** The session-bound knowledge surface, bridged to the legacy methods when needed. */
function resolveKnowledgeSession(
	backend: SessionServicePort,
	legacy: LegacySessionServices,
	hostServices: KnowledgeHostServices | undefined,
): BackendServices["knowledgeSession"] {
	const direct =
		hostServices?.knowledgeSession ??
		("knowledgeSession" in backend
			? (backend as { knowledgeSession: BackendServices["knowledgeSession"] }).knowledgeSession
			: undefined);
	if (direct) return direct;
	return {
		startSetup: (input) =>
			legacy.startKnowledgeSetup?.(input) ??
			Promise.reject(new Error("Knowledge session service unavailable")),
		reviewWithModel: (input) =>
			legacy.reviewKnowledgeWithModel?.(input) ??
			Promise.reject(new Error("Knowledge session service unavailable")),
		cancelModelReview: (input) =>
			legacy.cancelKnowledgeModelReview?.(input) ??
			Promise.reject(new Error("Knowledge session service unavailable")),
		resumeCheck: (sessionId) =>
			legacy.resumeKnowledgeCheck?.(sessionId) ??
			Promise.reject(new Error("Knowledge session service unavailable")),
		disposeSession: () => {
			// The legacy session surface owns no knowledge session state.
		},
	};
}

/** Reject a knowledge route that did not come from the application main frame. */
function requireMainFrame(event: unknown): void {
	const invokeEvent = event as {
		sender?: Electron.WebContents;
		senderFrame?: Electron.WebFrameMain | null;
	};
	if (
		!invokeEvent.sender ||
		!BrowserWindow.fromWebContents(invokeEvent.sender) ||
		invokeEvent.senderFrame !== invokeEvent.sender.mainFrame
	)
		throw new Error("Knowledge UI requests require the application main frame");
}

export function registerKnowledgeIpc(
	backendOrServices: SessionServicePort | BackendServices,
	services?: KnowledgeHostServices,
): void {
	const backend = "sessions" in backendOrServices ? backendOrServices.sessions : backendOrServices;
	const hostServices =
		services ?? ("sessions" in backendOrServices ? (backendOrServices as BackendServices) : undefined);
	const legacy = backend as LegacySessionServices;
	const knowledge =
		hostServices?.knowledge ??
		("knowledge" in backend
			? (backend as { knowledge: BackendServices["knowledge"] }).knowledge
			: legacy.knowledge);
	if (!knowledge) throw new Error("Knowledge services are required by the desktop host");
	bindKnowledgeRoutes(
		{
			knowledge,
			knowledgeSession: resolveKnowledgeSession(backend, legacy, hostServices),
			zotero: resolveZotero(backend, legacy, hostServices),
			dailyDiscovery: resolveDailyDiscovery(hostServices) as BackendServices["dailyDiscovery"],
			knowledgeMaintenance: hostServices?.knowledgeMaintenance,
		},
		{ beforeInvoke: requireMainFrame },
	);
	knowledge.subscribe((event) => {
		for (const window of BrowserWindow.getAllWindows()) {
			if (!window.isDestroyed()) window.webContents.send(IpcChannels.KnowledgeEvent, event);
		}
	});
}
