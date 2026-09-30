import type { PiBackend } from "@drone/backend";
import { IpcChannels, SESSION_INVOKE_METHODS, SessionsContract, channelOf } from "@drone/shared";
import { bindContract, type ContractImplementation } from "./bind-contract";
import { registerInvokers } from "./register-invokers";

type SessionContractMethod = keyof typeof SessionsContract.methods & string;
const CONTRACT_METHODS = new Set<SessionContractMethod>(["create", "prompt", "list"]);

const CONTRACT_CHANNELS: Record<SessionContractMethod, string> = {
	create: IpcChannels.SessionCreate,
	prompt: IpcChannels.SessionPrompt,
	list: IpcChannels.SessionList,
};

/**
 * 会话域：Session* 通道（生命周期/提示/导出/fork/撤回）+ 模型列表 + 项目文件/信任。
 * create/prompt/list 通过 SessionsContract 做参数/结果校验；其余方法保持 1:1 透传
 * `backend[method]`。通道名与 preload 共用 INVOKE_ROUTES 事实源。
 */
export function registerSessionsIpc(backend: PiBackend): void {
	// Keep all legacy method names/channels intact while moving the three stable
	// session entry points through the schema-backed host contract.
	const legacyMethods = SESSION_INVOKE_METHODS.filter(
		(method) =>
			!((method === "createSession" && CONTRACT_METHODS.has("create")) ||
				(method === "listSessions" && CONTRACT_METHODS.has("list")) ||
				(method === "prompt" && CONTRACT_METHODS.has("prompt"))),
	) as Parameters<typeof registerInvokers>[1];
	registerInvokers(backend, legacyMethods);

	const implementation: ContractImplementation<typeof SessionsContract> = {
		create: (options) => backend.createSession(options),
		prompt: (...args) => backend.prompt(...args),
		list: (...args) => backend.listSessions(...args),
	};
	bindContract(SessionsContract, implementation, {
		channelForMethod: (_contract, method) =>
			CONTRACT_CHANNELS[method as SessionContractMethod] ?? channelOf(SessionsContract, method),
	});
}
