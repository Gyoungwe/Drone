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
export function registerKnowledgeIpc(
	backendOrServices: SessionServicePort | BackendServices,
	services?: Pick<
		BackendServices,
		"knowledge" | "knowledgeSession" | "zotero" | "knowledgeMaintenance"
	> &
		Partial<Pick<BackendServices, "dailyDiscovery">>,
): void {
	const backend = "sessions" in backendOrServices ? backendOrServices.sessions : backendOrServices;
	const hostServices =
		services ?? ("sessions" in backendOrServices ? (backendOrServices as BackendServices) : undefined);
	const legacy = backend as SessionServicePort & {
		knowledge?: BackendServices["knowledge"];
		knowledgeSession?: BackendServices["knowledgeSession"];
		zotero?: BackendServices["zotero"];
		startKnowledgeSetup?: BackendServices["knowledgeSession"]["startSetup"];
		reviewKnowledgeWithModel?: BackendServices["knowledgeSession"]["reviewWithModel"];
		cancelKnowledgeModelReview?: BackendServices["knowledgeSession"]["cancelModelReview"];
		resumeKnowledgeCheck?: BackendServices["knowledgeSession"]["resumeCheck"];
		getZoteroStatus?: BackendServices["zotero"]["getStatus"];
	};
	const knowledge =
		hostServices?.knowledge ??
		("knowledge" in backend
			? (backend as SessionServicePort & Pick<BackendServices, "knowledge">).knowledge
			: legacy.knowledge);
	const unavailable = async (): Promise<never> => {
		throw new Error("Daily discovery is unavailable");
	};
	const dailyDiscovery: Pick<
		BackendServices["dailyDiscovery"],
		"getState" | "setEnabled" | "run" | "decide" | "decideRadarPaper"
	> = (hostServices as Partial<Pick<BackendServices, "dailyDiscovery">> | undefined)?.dailyDiscovery ?? {
		getState: async () => ({ enabled: false, lastRunAt: null, ideas: [], radar: [] }),
		setEnabled: unavailable,
		run: unavailable,
		decide: unavailable,
		decideRadarPaper: unavailable,
	};
	const zotero =
		hostServices?.zotero ??
		("zotero" in backend
			? (backend as SessionServicePort & Pick<BackendServices, "zotero">).zotero
			: (legacy.zotero ??
				(legacy.getZoteroStatus
					? { getStatus: legacy.getZoteroStatus.bind(backend) }
					: {
							getStatus: async () => {
								throw new Error("Zotero service is unavailable");
							},
						})));
	const knowledgeSession =
		hostServices?.knowledgeSession ??
		("knowledgeSession" in backend
			? (backend as SessionServicePort & Pick<BackendServices, "knowledgeSession">).knowledgeSession
			: (legacy.knowledgeSession ?? {
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
					disposeSession: () => {},
				}));
	if (!knowledge || !zotero || !knowledgeSession)
		throw new Error("Knowledge services are required by the desktop host");
	bindKnowledgeRoutes(
		{
			knowledge,
			knowledgeSession,
			zotero,
			dailyDiscovery: dailyDiscovery as BackendServices["dailyDiscovery"],
			knowledgeMaintenance: hostServices?.knowledgeMaintenance,
		},
		{
			beforeInvoke: (event) => {
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
			},
		},
	);
	knowledge.subscribe((event) => {
		for (const window of BrowserWindow.getAllWindows()) {
			if (!window.isDestroyed()) window.webContents.send(IpcChannels.KnowledgeEvent, event);
		}
	});
}
