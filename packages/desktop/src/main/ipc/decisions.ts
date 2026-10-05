import type { BackendServices, InquiryServicePort } from "@drone/backend";
import { DecisionsContract, IpcChannels } from "@drone/shared";
import { BrowserWindow } from "electron";
import { bindContract, type ContractImplementation } from "./bind-contract";

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
		throw new Error("Decision UI requests require the application main frame");
}

export function registerDecisionsIpc(backendOrInquiry: BackendServices | InquiryServicePort): () => void {
	const inquiry = "inquiry" in backendOrInquiry ? backendOrInquiry.inquiry : backendOrInquiry;
	const transport = (record: Awaited<ReturnType<InquiryServicePort["revokeDecision"]>>) => ({
		...record,
		basis: [...record.basis],
		affectedArtifactIds: [...record.affectedArtifactIds],
	});
	const implementation: ContractImplementation<typeof DecisionsContract> = {
		list: async (projectId) => (await inquiry.listDecisions(projectId)).map(transport),
		revoke: async (id, reason) => transport(await inquiry.revokeDecision(id, reason)),
	};
	return bindContract(DecisionsContract, implementation, {
		channelForMethod: (_contract, method) =>
			({ list: IpcChannels.DecisionsList, revoke: IpcChannels.DecisionsRevoke })[
				method as keyof typeof DecisionsContract.methods
			],
		beforeInvoke: (event) => requireMainFrame(event),
	});
}
