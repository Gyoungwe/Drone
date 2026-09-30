import type { PiBackend } from "@drone/backend";
import { IpcChannels, SubagentsContract } from "@drone/shared";
import { bindContract, type ContractImplementation } from "./bind-contract";

/**
 * 子智能体面板（会话内专属派发）：可用列表 / 派发 / 中止 / 本会话运行，四条通道全部 1:1 透传
 * `backend[method]`（校验、排队、结果入会话都在 backend 的 SubagentPanelService）。
 */
export function registerSubagentsIpc(backend: PiBackend): void {
	const implementation: ContractImplementation<typeof SubagentsContract> = {
		list: (sessionId) => backend.listSessionSubagents(sessionId),
		dispatch: (sessionId, input) => backend.dispatchSubagents(sessionId, input),
		abort: (runId) => backend.abortSubagentRun(runId),
		runs: (sessionId) => backend.listSubagentRuns(sessionId),
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
