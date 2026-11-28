import { type BackendServices, type ComputeHostAdapter, canonicalProjectId } from "@drone/backend";
import { ComputeContract, channelOf } from "@drone/shared";
import { BrowserWindow } from "electron";
import { bindContract, type ContractImplementation } from "./bind-contract";

type HostEventPublisher = { publish(topic: string, payload: unknown): void };

function resolveHostEvents(source: object): HostEventPublisher | undefined {
	const sessions =
		"sessions" in source && source.sessions && typeof source.sessions === "object"
			? source.sessions
			: undefined;
	const candidate =
		sessions && "hostEvents" in sessions
			? sessions.hostEvents
			: "hostEvents" in source
				? source.hostEvents
				: undefined;
	return candidate &&
		typeof candidate === "object" &&
		"publish" in candidate &&
		typeof candidate.publish === "function"
		? (candidate as HostEventPublisher)
		: undefined;
}

/**
 * Resolve the local project directory for a submitted compute job.
 * Never fall back to `input.remoteWorkDir`, which names a remote SSH/HPC path
 * rather than a local Drone workspace and would misattribute the decision.
 */
async function resolveSubmitWorkDir(
	source: object,
	input: unknown,
	job: { id: string; sessionId?: string },
): Promise<string | undefined> {
	const inputWorkDir =
		input && typeof input === "object" && "workDir" in input && typeof input.workDir === "string"
			? input.workDir.trim()
			: "";
	if (inputWorkDir) return inputWorkDir;
	try {
		const computeService =
			"compute" in source &&
			source.compute &&
			typeof source.compute === "object" &&
			"getJob" in source.compute &&
			typeof source.compute.getJob === "function"
				? (source.compute as { getJob(id: string): Promise<{ spec?: { workDir?: string } } | null> })
				: undefined;
		const stored = await computeService?.getJob(job.id);
		const specWorkDir = typeof stored?.spec?.workDir === "string" ? stored.spec.workDir.trim() : "";
		if (specWorkDir) return specWorkDir;
	} catch (error) {
		void error;
	}
	if (job.sessionId) {
		try {
			const sessions =
				"sessions" in source &&
				source.sessions &&
				typeof source.sessions === "object" &&
				"getPluginCallerContext" in source.sessions &&
				typeof source.sessions.getPluginCallerContext === "function"
					? (source.sessions as {
							getPluginCallerContext(id: string): { scope?: { workspaceDirectory?: string } } | undefined;
						})
					: undefined;
			const sessionDir = sessions?.getPluginCallerContext(job.sessionId)?.scope?.workspaceDirectory?.trim();
			if (sessionDir) return sessionDir;
		} catch (error) {
			void error;
		}
	}
	return undefined;
}

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
	const hostEvents = resolveHostEvents(backendOrCompute);
	const authorized = async <T>(
		operation: Parameters<ComputeHostAdapter["authorizeRemoteOperation"]>[0],
		action: () => Promise<T>,
	): Promise<T> => {
		await compute.authorizeRemoteOperation(operation);
		return action();
	};
	const implementation: ContractImplementation<typeof ComputeContract> = {
		listHosts: () => compute.listHosts(),
		listSshConfig: () => compute.listSshConfig?.() ?? Promise.resolve([]),
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
			const workDir = hostEvents ? await resolveSubmitWorkDir(backendOrCompute, input, job) : undefined;
			if (hostEvents && workDir) {
				try {
					hostEvents.publish("inquiry.decision", {
						id: `compute-submit:${job.id}`,
						kind: "compute-submit",
						summary: `Submitted compute workflow ${input.workflow.name}`,
						basis: [job.id, ...(input.workflow.specHash ? [input.workflow.specHash] : [])],
						projectId: canonicalProjectId(workDir),
						at: new Date().toISOString(),
					});
				} catch (error) {
					void error;
				}
			}
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
		beforeInvoke: (event) => requireMainFrame(event),
	});

	const unsubscribers = [
		compute.onHealthChanged((snapshot) => sendEvent(channelOf(ComputeContract, "healthChanged"), snapshot)),
		compute.onJobUpdated((job) => sendEvent(channelOf(ComputeContract, "jobUpdated"), job)),
		compute.onLogChunk((chunk) => sendEvent(channelOf(ComputeContract, "logChunk"), chunk)),
		compute.onTerminalOutput((event) => sendEvent(channelOf(ComputeContract, "terminalOutput"), event)),
		compute.onTerminalClosed((event) => sendEvent(channelOf(ComputeContract, "terminalClosed"), event)),
	];
	return () => {
		unbind();
		for (const unsubscribe of unsubscribers) unsubscribe();
	};
}
