import type { BackendServices, SessionServicePort } from "@drone/backend";
import { IpcChannels, SubagentsContract } from "@drone/shared";
import { bindContract, type ContractImplementation } from "./bind-contract";

/**
 * 子智能体面板（会话内专属派发）：可用列表 / 派发 / 中止 / 本会话运行，四条通道全部 1:1 透传
 * `backend[method]`（校验、排队、结果入会话都在 backend 的 SubagentPanelService）。
 */
export function registerSubagentsIpc(
	backend: SessionServicePort,
	services?: Pick<BackendServices, "subagents">,
): void {
	const legacy = backend as SessionServicePort & {
		listSessionSubagents?: BackendServices["subagents"]["listSession"];
		dispatchSubagents?: BackendServices["subagents"]["dispatch"];
		abortSubagentRun?: BackendServices["subagents"]["abort"];
		listSubagentRuns?: BackendServices["subagents"]["listRuns"];
		listSubagents?: BackendServices["subagents"]["listAvailable"];
	};
	const subagents =
		services?.subagents ??
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
		dispatch: (sessionId, input) => subagents.dispatch(sessionId, input),
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
