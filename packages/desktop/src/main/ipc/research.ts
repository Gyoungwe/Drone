import type { BackendServices } from "@drone/backend";
import { IpcChannels, ResearchContract } from "@drone/shared";
import { BrowserWindow } from "electron";
import { bindContract, type ContractImplementation } from "./bind-contract";

/** Renderer-facing adapter for provenance-aware research capture and search. */
export function registerResearchIpc(backend: BackendServices): void {
	const implementation: ContractImplementation<typeof ResearchContract> = {
		captureResource: (input) => backend.research.captureResearchResource(input),
		approveCapture: (input) => backend.research.approve(input.id),
		revokeCapture: (input) => backend.research.revoke(input.id),
		listCaptures: async (...args) => ({ items: [...(await backend.research.list(args[0]?.cwd))] }),
		searchResources: async (input) => {
			const result = await backend.research.search(input);
			return {
				...result,
				hits: [...result.hits],
				failures: [...result.failures],
				connectors: [...result.connectors],
			};
		},
		listConnectors: async () => ({ connectors: [...(await backend.research.listConnectors())] }),
		setConnectorEnabled: (input) => backend.research.setConnectorEnabled(input.id, input.enabled),
	};
	bindContract(ResearchContract, implementation, {
		channelForMethod: (_contract, method) =>
			({
				captureResource: IpcChannels.ResearchCapture,
				approveCapture: IpcChannels.ResearchApproveCapture,
				revokeCapture: IpcChannels.ResearchRevokeCapture,
				listCaptures: IpcChannels.ResearchListCaptures,
				searchResources: IpcChannels.ResearchSearch,
				listConnectors: IpcChannels.ResearchListConnectors,
				setConnectorEnabled: IpcChannels.ResearchSetConnectorEnabled,
			})[method as keyof typeof ResearchContract.methods],
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
				throw new Error("Research requests require the application main frame");
		},
	});
}
