import type { BackendServices, SessionServicePort } from "@drone/backend";
import { IpcChannels, KnowledgeContract } from "@drone/shared";
import { BrowserWindow, shell } from "electron";
import { bindContract, type ContractImplementation } from "./bind-contract";

/** Deliberately desktop-only: approvals are not a model tool or an unauthenticated LAN route. */
export function registerKnowledgeIpc(
	backendOrServices: SessionServicePort | BackendServices,
	services?: Pick<BackendServices, "knowledge" | "knowledgeSession" | "zotero">,
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
				}));
	if (!knowledge || !zotero || !knowledgeSession)
		throw new Error("Knowledge services are required by the desktop host");
	const implementation: ContractImplementation<typeof KnowledgeContract> = {
		setSpecialistSettings: (input) => knowledge.specialistSettings(input),
		getOverview: (...args) => knowledge.overview(args[0]),
		previewSetup: (input) => knowledge.setupPreview(input),
		startSetup: (input) => knowledgeSession.startSetup(input),
		getJobs: (...args) => knowledge.jobs(args[0]),
		getReviews: (input) => knowledge.reviews(input),
		previewReview: (input) => knowledge.preview(input),
		reviewWithModel: (input) => knowledgeSession.reviewWithModel(input),
		cancelModelReview: (input) => knowledgeSession.cancelModelReview(input),
		decideReview: (input) => knowledge.decide(input),
		readNote: (input) => knowledge.read(input),
		maintain: (input) => knowledge.maintain(input),
		openTarget: async (input) => {
			const target = await knowledge.openTarget(input);
			if (target.kind === "note") {
				await shell.openExternal(`obsidian://open?path=${encodeURIComponent(target.path)}`);
				return;
			}
			const error = await shell.openPath(target.path);
			if (error) throw new Error(error);
		},
		resumeCheck: (sessionId) => knowledgeSession.resumeCheck(sessionId),
		getSemanticStatus: (...args) => knowledge.semanticStatus(args[0]),
		saveSemanticSettings: (input) => knowledge.saveSemanticSettings(input),
		testSemanticProvider: (input) => knowledge.testSemanticProvider(input),
		indexSemantic: (input) => knowledge.indexSemantic(input),
		cancelSemanticIndex: (input) => knowledge.cancelSemanticIndex(input),
		getTopics: (input) => knowledge.topics(input),
		archiveTopic: (input) => knowledge.archiveTopic(input),
		getZoteroStatus: () => zotero.getStatus(),
	};
	bindContract(KnowledgeContract, implementation, {
		channelForMethod: (_contract, method) =>
			({
				setSpecialistSettings: IpcChannels.KnowledgeSpecialistsSettings,
				getOverview: IpcChannels.KnowledgeOverview,
				previewSetup: IpcChannels.KnowledgeSetupPreview,
				startSetup: IpcChannels.KnowledgeSetupStart,
				getJobs: IpcChannels.KnowledgeJobs,
				getReviews: IpcChannels.KnowledgeReviews,
				previewReview: IpcChannels.KnowledgeReviewPreview,
				reviewWithModel: IpcChannels.KnowledgeReviewModel,
				cancelModelReview: IpcChannels.KnowledgeReviewModelCancel,
				decideReview: IpcChannels.KnowledgeReviewDecide,
				readNote: IpcChannels.KnowledgeReadNote,
				maintain: IpcChannels.KnowledgeMaintain,
				openTarget: IpcChannels.KnowledgeOpen,
				resumeCheck: IpcChannels.KnowledgeResume,
				getSemanticStatus: IpcChannels.KnowledgeSemanticStatus,
				saveSemanticSettings: IpcChannels.KnowledgeSemanticSettingsSave,
				testSemanticProvider: IpcChannels.KnowledgeSemanticProviderTest,
				indexSemantic: IpcChannels.KnowledgeSemanticIndex,
				cancelSemanticIndex: IpcChannels.KnowledgeSemanticIndexCancel,
				getTopics: IpcChannels.KnowledgeTopics,
				archiveTopic: IpcChannels.KnowledgeTopicArchive,
				getZoteroStatus: IpcChannels.ZoteroStatus,
			})[method as keyof typeof KnowledgeContract.methods],
		beforeInvoke: (event, _contract, method) => {
			if (method === "getZoteroStatus") return;
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
	});
	knowledge.subscribe((event) => {
		for (const window of BrowserWindow.getAllWindows()) {
			if (!window.isDestroyed()) window.webContents.send(IpcChannels.KnowledgeEvent, event);
		}
	});
}
