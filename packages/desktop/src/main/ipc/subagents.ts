import { type BackendServices, canonicalProjectId, type SessionServicePort } from "@drone/backend";
import { SubagentsContract } from "@drone/shared";
import { bindContract, type ContractImplementation } from "./bind-contract";

type HostEventPublisher = { publish(topic: string, payload: unknown): void };

function resolveHostEvents(source: unknown): HostEventPublisher | undefined {
	if (!source || typeof source !== "object") return undefined;
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
 * 子智能体面板（会话内专属派发）：可用列表 / 派发 / 中止 / 本会话运行，四条通道全部 1:1 透传
 * `backend[method]`（校验、排队、结果入会话都在 backend 的 SubagentPanelService）。
 */
export function registerSubagentsIpc(
	backendOrServices: BackendServices | SessionServicePort,
	services?: Pick<BackendServices, "subagents">,
): void {
	const backend = "sessions" in backendOrServices ? backendOrServices.sessions : backendOrServices;
	const hostServices = services ?? ("sessions" in backendOrServices ? backendOrServices : undefined);
	const hostEvents =
		resolveHostEvents(hostServices) ?? resolveHostEvents(backendOrServices) ?? resolveHostEvents(backend);
	const legacy = backend as SessionServicePort & {
		listSessionSubagents?: BackendServices["subagents"]["listSession"];
		dispatchSubagents?: BackendServices["subagents"]["dispatch"];
		abortSubagentRun?: BackendServices["subagents"]["abort"];
		listSubagentRuns?: BackendServices["subagents"]["listRuns"];
		listSubagents?: BackendServices["subagents"]["listAvailable"];
	};
	const subagents =
		hostServices?.subagents ??
		("subagents" in backend
			? (backend as SessionServicePort & Pick<BackendServices, "subagents">).subagents
			: legacy.listSessionSubagents &&
					legacy.dispatchSubagents &&
					legacy.abortSubagentRun &&
					legacy.listSubagentRuns
				? {
						listSession: legacy.listSessionSubagents.bind(backend),
						dispatch: legacy.dispatchSubagents.bind(backend),
						abort: legacy.abortSubagentRun.bind(backend),
						listRuns: legacy.listSubagentRuns.bind(backend),
						listAvailable: () => legacy.listSubagents?.() ?? Promise.resolve([]),
					}
				: undefined);
	if (!subagents) throw new Error("Subagent service is required by the desktop host");
	const implementation: ContractImplementation<typeof SubagentsContract> = {
		list: (sessionId) => subagents.listSession(sessionId),
		dispatch: async (sessionId, input) => {
			const receipt = await subagents.dispatch(sessionId, input);
			const cwd = receipt.runs[0]?.cwd;
			if (hostEvents && typeof cwd === "string" && cwd.length > 0) {
				try {
					hostEvents.publish("inquiry.decision", {
						id: `subagent-dispatch:${receipt.runs.map((run) => run.runId).join(",") || sessionId}`,
						kind: "subagent-dispatch",
						summary: `Dispatched ${receipt.runs.length} subagent run(s)`,
						basis: receipt.runs.map((run) => run.runId),
						projectId: canonicalProjectId(cwd),
						at: new Date().toISOString(),
					});
				} catch {
					// Host event publishing is advisory and must not fail subagent dispatch.
				}
			}
			return receipt;
		},
		abort: (runId) => subagents.abort(runId),
		runs: (sessionId) => subagents.listRuns(sessionId),
	};
	bindContract(SubagentsContract, implementation);
}
