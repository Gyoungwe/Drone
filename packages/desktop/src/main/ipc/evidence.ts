import type { AnalysisEvidenceService } from "@drone/backend";
import { EvidenceContract } from "@drone/shared";
import { BrowserWindow } from "electron";
import { bindContract, type ContractImplementation } from "./bind-contract";

export function registerEvidenceIpc(evidence: AnalysisEvidenceService): () => void {
	const implementation: ContractImplementation<typeof EvidenceContract> = {
		getEvidenceOverview: () => evidence.overview(),
		freezeAnalysisEvidence: (id, root) => evidence.freezeRecorded(id, root),
		forkEvidenceCheckpoint: async (checkpointId, id) => {
			await evidence.fork(checkpointId, id);
			const branch = await evidence.branch(id);
			if (!branch) throw new Error("Branch record not found");
			return { id, ...branch };
		},
		exportEvidenceCapsule: (id, audience) => evidence.exportCapsule(id, audience),
		importEvidenceCapsule: async (path) => evidence.summary(await evidence.importCapsule(path)),
		replayEvidenceCheckpoint: async (id) => {
			const receipt = await evidence.replay(id);
			return { ...receipt, outputChecks: [...receipt.outputChecks] };
		},
	};
	return bindContract(EvidenceContract, implementation, {
		beforeInvoke: (event) => {
			const request = event as Electron.IpcMainInvokeEvent;
			if (
				!request.sender ||
				!BrowserWindow.fromWebContents(request.sender) ||
				request.senderFrame !== request.sender.mainFrame
			)
				throw new Error("Evidence requests require the application main frame");
		},
	});
}
