import type { PiBackend } from "@drone/backend";
import { IpcChannels, KnowledgeContract } from "@drone/shared";
import { BrowserWindow, shell } from "electron";
import { bindContract, type ContractImplementation } from "./bind-contract";

/** Deliberately desktop-only: approvals are not a model tool or an unauthenticated LAN route. */
export function registerKnowledgeIpc(backend: PiBackend): void {
	const implementation: ContractImplementation<typeof KnowledgeContract> = {
		setSpecialistSettings: (input) => backend.knowledge.specialistSettings(input),
		getOverview: (...args) => backend.knowledge.overview(args[0]),
		previewSetup: (input) => backend.knowledge.setupPreview(input),
		startSetup: (input) => backend.startKnowledgeSetup(input),
		getJobs: (...args) => backend.knowledge.jobs(args[0]),
		getReviews: (input) => backend.knowledge.reviews(input),
		previewReview: (input) => backend.knowledge.preview(input),
		reviewWithModel: (input) => backend.reviewKnowledgeWithModel(input),
		cancelModelReview: (input) => backend.cancelKnowledgeModelReview(input),
		decideReview: (input) => backend.knowledge.decide(input),
		readNote: (input) => backend.knowledge.read(input),
		maintain: (input) => backend.knowledge.maintain(input),
		openTarget: async (input) => {
			const target = await backend.knowledge.openTarget(input);
			if (target.kind === "note") {
				await shell.openExternal(`obsidian://open?path=${encodeURIComponent(target.path)}`);
				return;
			}
			const error = await shell.openPath(target.path);
			if (error) throw new Error(error);
		},
		resumeCheck: (sessionId) => backend.resumeKnowledgeCheck(sessionId),
		getSemanticStatus: (...args) => backend.knowledge.semanticStatus(args[0]),
		saveSemanticSettings: (input) => backend.knowledge.saveSemanticSettings(input),
		testSemanticProvider: (input) => backend.knowledge.testSemanticProvider(input),
		indexSemantic: (input) => backend.knowledge.indexSemantic(input),
		cancelSemanticIndex: (input) => backend.knowledge.cancelSemanticIndex(input),
		getTopics: (input) => backend.knowledge.topics(input),
		archiveTopic: (input) => backend.knowledge.archiveTopic(input),
		getZoteroStatus: () => backend.getZoteroStatus(),
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
	backend.knowledge.subscribe((event) => {
		for (const window of BrowserWindow.getAllWindows()) {
			if (!window.isDestroyed()) window.webContents.send(IpcChannels.KnowledgeEvent, event);
		}
	});
}
