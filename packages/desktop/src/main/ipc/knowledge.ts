import type { PiBackend } from "@percho/backend";
import type { KnowledgeApi } from "@percho/shared";
import { IpcChannels } from "@percho/shared";
import type { IpcMainInvokeEvent } from "electron";
import { BrowserWindow, ipcMain, shell } from "electron";

const upgradeChannels = {
	semanticStatus:
		(IpcChannels as unknown as Record<string, string>).KnowledgeSemanticStatus ?? "knowledge:semanticStatus",
	semanticSettingsSave:
		(IpcChannels as unknown as Record<string, string>).KnowledgeSemanticSettingsSave ??
		"knowledge:semanticSettingsSave",
	semanticProviderTest:
		(IpcChannels as unknown as Record<string, string>).KnowledgeSemanticProviderTest ??
		"knowledge:semanticProviderTest",
	semanticIndex:
		(IpcChannels as unknown as Record<string, string>).KnowledgeSemanticIndex ?? "knowledge:semanticIndex",
	semanticIndexCancel:
		(IpcChannels as unknown as Record<string, string>).KnowledgeSemanticIndexCancel ??
		"knowledge:semanticIndexCancel",
	topics: (IpcChannels as unknown as Record<string, string>).KnowledgeTopics ?? "knowledge:topics",
	topicArchive:
		(IpcChannels as unknown as Record<string, string>).KnowledgeTopicArchive ?? "knowledge:topicArchive",
};

/** Deliberately desktop-only: approvals are not a model tool or an unauthenticated LAN route. */
export function registerKnowledgeIpc(backend: PiBackend): void {
	const handle = (channel: string, fn: (input: any) => unknown) => {
		ipcMain.handle(channel, (event: IpcMainInvokeEvent, input: unknown) => {
			if (!BrowserWindow.fromWebContents(event.sender) || event.senderFrame !== event.sender.mainFrame)
				throw new Error("Knowledge UI requests require the application main frame");
			return fn(input);
		});
	};
	handle(IpcChannels.KnowledgeSpecialistsSettings, (input) => backend.knowledge.specialistSettings(input));
	handle(IpcChannels.KnowledgeOverview, (input) => backend.knowledge.overview(input));
	handle(IpcChannels.KnowledgeSetupPreview, (input) => backend.knowledge.setupPreview(input));
	handle(IpcChannels.KnowledgeSetupStart, (input) => backend.startKnowledgeSetup(input));
	handle(IpcChannels.KnowledgeJobs, (input) => backend.knowledge.jobs(input));
	handle(IpcChannels.KnowledgeReviews, (input) => backend.knowledge.reviews(input));
	handle(IpcChannels.KnowledgeReviewPreview, (input) => backend.knowledge.preview(input));
	handle(IpcChannels.KnowledgeReviewModel, (input) => backend.reviewKnowledgeWithModel(input));
	handle(IpcChannels.KnowledgeReviewModelCancel, (input) => backend.cancelKnowledgeModelReview(input));
	handle(IpcChannels.KnowledgeReviewDecide, (input) => backend.knowledge.decide(input));
	handle(IpcChannels.KnowledgeReadNote, (input) => backend.knowledge.read(input));
	handle(IpcChannels.KnowledgeMaintain, (input) => backend.knowledge.maintain(input));
	handle(IpcChannels.KnowledgeResume, (input) => backend.resumeKnowledgeCheck(input));
	handle(IpcChannels.KnowledgeOpen, async (input: Parameters<KnowledgeApi["openKnowledgeTarget"]>[0]) => {
		const target = await backend.knowledge.openTarget(input);
		if (target.kind === "note")
			await shell.openExternal(`obsidian://open?path=${encodeURIComponent(target.path)}`);
		else {
			const error = await shell.openPath(target.path);
			if (error) throw new Error(error);
		}
	});
	handle(upgradeChannels.semanticStatus, (input) => backend.knowledge.semanticStatus(input));
	handle(upgradeChannels.semanticSettingsSave, (input) => backend.knowledge.saveSemanticSettings(input));
	handle(upgradeChannels.semanticProviderTest, (input) => backend.knowledge.testSemanticProvider(input));
	handle(upgradeChannels.semanticIndex, (input) => backend.knowledge.indexSemantic(input));
	handle(upgradeChannels.semanticIndexCancel, (input) => backend.knowledge.cancelSemanticIndex(input));
	handle(upgradeChannels.topics, (input) => backend.knowledge.topics(input));
	handle(upgradeChannels.topicArchive, (input) => backend.knowledge.archiveTopic(input));
	handle(IpcChannels.ZoteroStatus, () => backend.getZoteroStatus());
	backend.knowledge.subscribe((event) => {
		for (const window of BrowserWindow.getAllWindows()) {
			if (!window.isDestroyed()) window.webContents.send(IpcChannels.KnowledgeEvent, event);
		}
	});
}
