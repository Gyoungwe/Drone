import type { PiBackend } from "@percho/backend";
import type { KnowledgeApi } from "@percho/shared";
import { IpcChannels } from "@percho/shared";
import type { IpcMainInvokeEvent } from "electron";
import { BrowserWindow, ipcMain, shell } from "electron";

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
	backend.knowledge.subscribe((event) => {
		for (const window of BrowserWindow.getAllWindows()) {
			if (!window.isDestroyed()) window.webContents.send(IpcChannels.KnowledgeEvent, event);
		}
	});
}
