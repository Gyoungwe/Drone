import type { BackendServices, SessionServicePort } from "@drone/backend";
import { IpcChannels, SubagentsContract } from "@drone/shared";
import { bindContract, type ContractImplementation } from "./bind-contract";

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
	const inquiry = "inquiry" in backendOrServices ? backendOrServices.inquiry : undefined;
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
			void inquiry
				?.recordDecision({
					id: `subagent-dispatch:${receipt.runs.map((run) => run.runId).join(",") || sessionId}`,
					kind: "subagent-dispatch",
					summary: `Dispatched ${receipt.runs.length} subagent run(s)`,
					basis: receipt.runs.map((run) => run.runId),
					projectId: receipt.runs[0]?.cwd,
					at: new Date().toISOString(),
				})
				.catch(() => {});
			return receipt;
		},
		abort: (runId) => subagents.abort(runId),
		runs: (sessionId) => subagents.listRuns(sessionId),
	};
	bindContract(SubagentsContract, implementation, {
		channelForMethod: (_contract, method) =>
			({
				list: IpcChannels.SubagentsList,
				dispatch: IpcChannels.SubagentsDispatch,
				abort: IpcChannels.SubagentsAbort,
				runs: IpcChannels.SubagentsRuns,
			})[method as keyof typeof SubagentsContract.methods],
	});
}
