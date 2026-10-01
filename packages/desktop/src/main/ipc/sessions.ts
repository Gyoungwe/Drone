import type { BackendServices, PiBackend } from "@drone/backend";
import { IpcChannels, SessionsContract } from "@drone/shared";
import { bindContract, type ContractImplementation } from "./bind-contract";

type SessionContractMethod = keyof typeof SessionsContract.methods & string;

/** Keep the historical singular `session:*` channels stable during migration. */
const CONTRACT_CHANNELS = {
	createSession: IpcChannels.SessionCreate,
	listSessions: IpcChannels.SessionList,
	listAllSessions: IpcChannels.SessionListAll,
	openSession: IpcChannels.SessionOpen,
	closeSession: IpcChannels.SessionClose,
	deleteSession: IpcChannels.SessionDelete,
	prompt: IpcChannels.SessionPrompt,
	abort: IpcChannels.SessionAbort,
	retry: IpcChannels.SessionRetry,
	setModel: IpcChannels.SessionSetModel,
	setThinkingLevel: IpcChannels.SessionSetThinkingLevel,
	compact: IpcChannels.SessionCompact,
	getStats: IpcChannels.SessionStats,
	getContextUsage: IpcChannels.SessionGetContextUsage,
	clearQueue: IpcChannels.SessionClearQueue,
	getFollowUpMessages: IpcChannels.SessionGetFollowUpMessages,
	listSlashCommands: IpcChannels.SessionListSlashCommands,
	listSlashCommandsForCwd: IpcChannels.SessionListSlashCommandsForCwd,
	setSessionName: IpcChannels.SessionSetName,
	exportSession: IpcChannels.SessionExport,
	forkSession: IpcChannels.SessionFork,
	recallMessage: IpcChannels.SessionRecall,
	getLoadedResources: IpcChannels.SessionGetLoadedResources,
	getSessionMessages: IpcChannels.SessionGetMessages,
	peekSubagentMessages: IpcChannels.SessionPeekSubagentMessages,
	steerSubagent: IpcChannels.SessionSteerSubagent,
	replySubagentSupervisor: IpcChannels.SessionReplySubagentSupervisor,
	getTodos: IpcChannels.SessionGetTodos,
	listModels: IpcChannels.ModelsList,
	listProjectFiles: IpcChannels.ProjectListFiles,
	ensureProjectTrust: IpcChannels.ProjectEnsureTrust,
} satisfies Record<SessionContractMethod, string>;

/**
 * Register every session method through the schema-backed host contract.
 * Renderer method names and legacy channel names remain unchanged while
 * transport registration is kept behind the schema-backed binder.
 */
export function registerSessionsIpc(backendOrServices: PiBackend | BackendServices): void {
	const backend = "sessions" in backendOrServices ? backendOrServices.sessions : backendOrServices;
	const implementation = Object.fromEntries(
		(Object.keys(SessionsContract.methods) as SessionContractMethod[]).map((method) => {
			const fn = backend[method as keyof PiBackend] as unknown;
			if (typeof fn !== "function") throw new Error(`Missing backend session method: ${method}`);
			return [
				method,
				(...args: unknown[]) => Reflect.apply(fn as (...args: unknown[]) => unknown, backend, args),
			];
		}),
	) as unknown as ContractImplementation<typeof SessionsContract>;

	bindContract(SessionsContract, implementation, {
		channelForMethod: (_contract, method) => CONTRACT_CHANNELS[method as SessionContractMethod],
	});
}
