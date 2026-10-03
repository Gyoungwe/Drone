import type { BackendServices, DiscoveryServicePort } from "@drone/backend";
import { DiscoveryContract, IpcChannels } from "@drone/shared";
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
		throw new Error("Discovery UI requests require the application main frame");
}

/** Bind the renderer-facing, project-scoped B5 discovery projections. */
export function registerDiscoveryIpc(backendOrDiscovery: BackendServices | DiscoveryServicePort): () => void {
	const discovery = "discovery" in backendOrDiscovery ? backendOrDiscovery.discovery : backendOrDiscovery;
	const implementation: ContractImplementation<typeof DiscoveryContract> = {
		getCapabilities: (language) => discovery.getCapabilities(language),
		listKernelSessions: async () => [...(await discovery.listKernelSessions())],
		getKernelSession: (id) => discovery.getKernelSession(id),
		closeKernelSession: (id) => discovery.closeKernelSession(id),
		listCriticReviews: async () => [...(await discovery.listCriticReviews())],
		listMultipathAssessments: async () => [...(await discovery.listMultipathAssessments())],
		listExplorationPlans: async () => [...(await discovery.listExplorationPlans())],
		listEvaluations: async () => [...(await discovery.listEvaluations())],
	};
	return bindContract(DiscoveryContract, implementation, {
		channelForMethod: (_contract, method) =>
			({
				getCapabilities: IpcChannels.DiscoveryCapabilities,
				listKernelSessions: IpcChannels.DiscoveryKernelSessions,
				getKernelSession: IpcChannels.DiscoveryKernelSession,
				closeKernelSession: IpcChannels.DiscoveryCloseKernelSession,
				listCriticReviews: IpcChannels.DiscoveryCriticReviews,
				listMultipathAssessments: IpcChannels.DiscoveryMultipathAssessments,
				listExplorationPlans: IpcChannels.DiscoveryExplorationPlans,
				listEvaluations: IpcChannels.DiscoveryEvaluations,
			})[method as keyof typeof DiscoveryContract.methods],
		beforeInvoke: (event) => requireMainFrame(event),
	});
}
