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
	const implementation = createDiscoveryIpcImplementation(backendOrDiscovery);
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

/** Build the renderer implementation with an installed discovery host preferred for migrated reads. */
export function createDiscoveryIpcImplementation(
	backendOrDiscovery: BackendServices | DiscoveryServicePort,
): ContractImplementation<typeof DiscoveryContract> {
	const discovery = "discovery" in backendOrDiscovery ? backendOrDiscovery.discovery : backendOrDiscovery;
	const discoveryHost = "discoveryHost" in backendOrDiscovery ? backendOrDiscovery.discoveryHost : undefined;
	const hostRead = <T>(
		operation: "listCriticReviews" | "listMultipathAssessments" | "listExplorationPlans" | "listEvaluations",
		fallback: () => Promise<T>,
	): Promise<T> => {
		const method = discoveryHost?.[operation];
		return method ? (method.call(discoveryHost, {}) as Promise<T>) : fallback();
	};
	return {
		getCapabilities: (language) => discovery.getCapabilities(language),
		listKernelSessions: async () => [...(await discovery.listKernelSessions())],
		getKernelSession: (id) => discovery.getKernelSession(id),
		closeKernelSession: (id) => discovery.closeKernelSession(id),
		listCriticReviews: () =>
			hostRead("listCriticReviews", async () => [...(await discovery.listCriticReviews())]),
		listMultipathAssessments: () =>
			hostRead("listMultipathAssessments", async () => [...(await discovery.listMultipathAssessments())]),
		listExplorationPlans: () =>
			hostRead("listExplorationPlans", async () => [...(await discovery.listExplorationPlans())]),
		listEvaluations: () => hostRead("listEvaluations", async () => [...(await discovery.listEvaluations())]),
	};
}
