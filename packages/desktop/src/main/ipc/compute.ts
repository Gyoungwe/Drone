import type { BackendServices, ComputeHostAdapter } from "@drone/backend";
import { ComputeContract, IpcChannels } from "@drone/shared";
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
		throw new Error("Compute UI requests require the application main frame");
}

/** Bind the renderer-facing compute projection to the B1 adapter port. */
export function registerComputeIpc(
	backendOrCompute: BackendServices | ComputeHostAdapter,
	sendEvent: (channel: string, payload: unknown) => void = () => {},
): () => void {
	const compute = "computeAdapter" in backendOrCompute ? backendOrCompute.computeAdapter : backendOrCompute;
	const inquiry = "inquiry" in backendOrCompute ? backendOrCompute.inquiry : undefined;
	const authorized = async <T>(
		operation: Parameters<ComputeHostAdapter["authorizeRemoteOperation"]>[0],
		action: () => Promise<T>,
	): Promise<T> => {
		await compute.authorizeRemoteOperation(operation);
		return action();
	};
	const implementation: ContractImplementation<typeof ComputeContract> = {
		listHosts: () => compute.listHosts(),
		getHost: (id) => compute.getHost(id),
		saveHost: (input) => compute.saveHost(input),
		removeHost: (id) => compute.removeHost(id),
		probeHost: (id) => authorized({ kind: "probe_host", hostId: id }, () => compute.probeHost(id)),
		getHealthSnapshot: () => compute.getHealthSnapshot(),
		listJobs: (filter) => compute.listJobs(filter),
		getJob: (id) => compute.getJob(id),
		submitJob: async (input) => {
			const job = await authorized({ kind: "submit_job", hostId: input.hostId }, () =>
				compute.submitJob(input),
			);
			void inquiry
				?.recordDecision({
					id: `compute-submit:${job.id}`,
					kind: "compute-submit",
					summary: `Submitted compute workflow ${input.workflow.name}`,
					basis: [job.id, ...(input.workflow.specHash ? [input.workflow.specHash] : [])],
					projectId: (input as { workDir?: string }).workDir,
					at: new Date().toISOString(),
				})
				.catch(() => {});
			return job;
		},
		getLogs: (id, cursor) => compute.getLogs(id, cursor),
		cancelJob: (id) => authorized({ kind: "cancel_job", jobId: id }, () => compute.cancelJob(id)),
		openTerminal: (input) =>
			authorized({ kind: "open_terminal", hostId: input.hostId }, () => compute.openTerminal(input)),
		getTerminal: (id) => compute.getTerminal(id),
		writeTerminal: (id, text) =>
			authorized({ kind: "write_terminal", terminalId: id }, () => compute.writeTerminal(id, text)),
		closeTerminal: (id) =>
			authorized({ kind: "close_terminal", terminalId: id }, () => compute.closeTerminal(id)),
		getOnboardingStatus: () => compute.getOnboardingStatus(),
		checkOnboardingStep: (step) => compute.checkOnboardingStep(step),
	};
	const unbind = bindContract(ComputeContract, implementation, {
		channelForMethod: (_contract, method) =>
			({
				listHosts: IpcChannels.ComputeListHosts,
				getHost: IpcChannels.ComputeGetHost,
				saveHost: IpcChannels.ComputeSaveHost,
				removeHost: IpcChannels.ComputeRemoveHost,
				probeHost: IpcChannels.ComputeProbeHost,
				getHealthSnapshot: IpcChannels.ComputeHealth,
				listJobs: IpcChannels.ComputeJobs,
				getJob: IpcChannels.ComputeJob,
				submitJob: IpcChannels.ComputeSubmitJob,
				getLogs: IpcChannels.ComputeLogs,
				cancelJob: IpcChannels.ComputeCancelJob,
				openTerminal: IpcChannels.ComputeOpenTerminal,
				getTerminal: IpcChannels.ComputeGetTerminal,
				writeTerminal: IpcChannels.ComputeWriteTerminal,
				closeTerminal: IpcChannels.ComputeCloseTerminal,
				getOnboardingStatus: IpcChannels.ComputeOnboarding,
				checkOnboardingStep: IpcChannels.ComputeCheckOnboarding,
			})[method as keyof typeof ComputeContract.methods],
		beforeInvoke: (event) => requireMainFrame(event),
	});

	const unsubscribers = [
		compute.onHealthChanged((snapshot) => sendEvent(IpcChannels.ComputeHealthEvent, snapshot)),
		compute.onJobUpdated((job) => sendEvent(IpcChannels.ComputeJobEvent, job)),
		compute.onLogChunk((chunk) => sendEvent(IpcChannels.ComputeLogEvent, chunk)),
		compute.onTerminalOutput((event) => sendEvent(IpcChannels.ComputeTerminalOutputEvent, event)),
		compute.onTerminalClosed((event) => sendEvent(IpcChannels.ComputeTerminalClosedEvent, event)),
	];
	return () => {
		unbind();
		for (const unsubscribe of unsubscribers) unsubscribe();
	};
}
