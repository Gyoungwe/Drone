import type { BackendServices, PiBackend } from "@drone/backend";
import { IpcChannels, KnowledgeContract } from "@drone/shared";
import { BrowserWindow, shell } from "electron";
import { bindContract, type ContractImplementation } from "./bind-contract";

/** Deliberately desktop-only: approvals are not a model tool or an unauthenticated LAN route. */
export function registerKnowledgeIpc(
	backend: PiBackend,
	services?: Pick<BackendServices, "knowledge" | "zotero">,
): void {
	// Knowledge reads/writes are owned by the explicit domain service. Keep the
	// façade for session-bound orchestration until those methods move as well.
	const knowledge = services?.knowledge ?? backend.knowledge;
	const zotero = services?.zotero ?? backend.zotero;
	const implementation: ContractImplementation<typeof KnowledgeContract> = {
		setSpecialistSettings: (input) => knowledge.specialistSettings(input),
		getOverview: (...args) => knowledge.overview(args[0]),
		previewSetup: (input) => knowledge.setupPreview(input),
		startSetup: (input) => backend.startKnowledgeSetup(input),
		getJobs: (...args) => knowledge.jobs(args[0]),
		getReviews: (input) => knowledge.reviews(input),
		previewReview: (input) => knowledge.preview(input),
		reviewWithModel: (input) => backend.reviewKnowledgeWithModel(input),
		cancelModelReview: (input) => backend.cancelKnowledgeModelReview(input),
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
		resumeCheck: (sessionId) => backend.resumeKnowledgeCheck(sessionId),
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
