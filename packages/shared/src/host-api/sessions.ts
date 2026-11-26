import { Type } from "typebox";
import type { PromptIds } from "../run-state";
import type {
	AvailableModel,
	ContextUsageInfo,
	CreateSessionOptions,
	ImageInput,
	LoadedResources,
	SessionEventEnvelope,
	SessionMessage,
	SessionMeta,
	SessionStats,
	SlashCommandInfo,
} from "../session";
import type { TodoItem } from "../todo";
import { type ClientOf, defineDomain } from "./define";

const Id = Type.String({ minLength: 1 });

const CreateSessionOptionsSchema = Type.Object(
	{
		cwd: Type.String({ minLength: 1 }),
		provider: Type.Optional(Id),
		modelId: Type.Optional(Id),
		thinkingLevel: Type.Optional(Id),
	},
	{ additionalProperties: false },
);

const ImageInputSchema = Type.Object(
	{
		data: Type.String(),
		mimeType: Id,
	},
	{ additionalProperties: false },
);

const SessionMetaSchema = Type.Object(
	{
		sessionId: Id,
		cwd: Id,
		active: Type.Boolean(),
		messageCount: Type.Integer({ minimum: 0 }),
		createdAt: Type.Number(),
		sessionFile: Type.Optional(Type.String()),
		name: Type.Optional(Type.String()),
		modelLabel: Type.Optional(Type.String()),
		model: Type.Optional(
			Type.Union([Type.Null(), Type.Object({ provider: Id, modelId: Id }, { additionalProperties: false })]),
		),
		thinkingLevel: Type.Optional(Type.Union([Type.String(), Type.Null()])),
		readOnly: Type.Optional(Type.Boolean()),
		modifiedAt: Type.Optional(Type.Number()),
	},
	{ additionalProperties: false },
);

/**
 * Prompt preflight receipt: tells the renderer whether this input owns an agent run.
 *
 * NOT a running-state authority. SDK events (agent_start/agent_end/agent_settled)
 * own agentActive; this ack can resolve *after* agent_settled on a fast completion,
 * so driving running-state from it would revive an already-finished run (the exact
 * v0.7.2 regression). Consumers must keep using `sending` for preflight and SDK
 * events for the live run — do not set agentActive from this value.
 */
export type PromptReceipt = ({ kind: "agent" } | { kind: "queued" } | { kind: "command" }) & {
	/** P14 Optimistic：回执原样带回客户端生成的 id */
	clientMessageId?: string;
	assistantMessageId?: string;
};

const ReceiptIds = {
	clientMessageId: Type.Optional(Type.String()),
	assistantMessageId: Type.Optional(Type.String()),
};
const PromptReceiptSchema = Type.Union([
	Type.Object({ kind: Type.Literal("agent"), ...ReceiptIds }, { additionalProperties: false }),
	Type.Object({ kind: Type.Literal("queued"), ...ReceiptIds }, { additionalProperties: false }),
	Type.Object({ kind: Type.Literal("command"), ...ReceiptIds }, { additionalProperties: false }),
]);
const PromptIdsSchema = Type.Object(
	{ clientMessageId: Type.String({ minLength: 1 }), assistantMessageId: Type.String({ minLength: 1 }) },
	{ additionalProperties: false },
);

const QueuedMessagesSchema = Type.Object(
	{ steering: Type.Array(Type.String()), followUp: Type.Array(Type.String()) },
	{ additionalProperties: false },
);

const ExportFormatSchema = Type.Union([Type.Literal("html"), Type.Literal("jsonl")]);
const ForkRefSchema = Type.Object(
	{ entryId: Type.Optional(Id), text: Type.Optional(Type.String()) },
	{ additionalProperties: false },
);
const RecallRefSchema = Type.Object(
	{ entryId: Type.Optional(Id), text: Type.Optional(Type.String()), timestamp: Type.Optional(Type.Number()) },
	{ additionalProperties: false },
);
const RecallResultSchema = Type.Object(
	{ text: Type.String(), images: Type.Array(ImageInputSchema) },
	{ additionalProperties: false },
);

// The remaining result payloads are deliberately opaque at the transport edge. Their
// structural types remain authoritative in shared/src/session.ts; this keeps the
// migration from duplicating large SDK-shaped payloads while still validating the
// method's tuple arity and primitive arguments.
const ObjectResult = <T>() => Type.Unsafe<T>({ type: "object" });
const ArrayResult = <T>() => Type.Unsafe<T[]>({ type: "array" });

/** Host IPC contract for session methods and notifications. */
export const SessionsContract = defineDomain("sessions", {
	methods: {
		createSession: {
			args: Type.Tuple([CreateSessionOptionsSchema]),
			result: Type.Unsafe<SessionMeta>(SessionMetaSchema),
		},
		listSessions: {
			args: Type.Union([Type.Tuple([]), Type.Tuple([Type.String({ minLength: 1 })])]),
			result: Type.Array(Type.Unsafe<SessionMeta>(SessionMetaSchema)),
		},
		listAllSessions: {
			args: Type.Tuple([]),
			result: Type.Array(Type.Unsafe<SessionMeta>(SessionMetaSchema)),
		},
		openSession: {
			args: Type.Tuple([Type.String({ minLength: 1 })]),
			result: Type.Unsafe<SessionMeta>(SessionMetaSchema),
		},
		closeSession: { args: Type.Tuple([Id]), result: Type.Void() },
		deleteSession: {
			args: Type.Union([Type.Tuple([Id]), Type.Tuple([Id, Type.String({ minLength: 1 })])]),
			result: Type.Void(),
		},
		prompt: {
			args: Type.Union([
				Type.Tuple([Id, Type.String()]),
				Type.Tuple([Id, Type.String(), Type.Array(ImageInputSchema)]),
				Type.Tuple([Id, Type.String(), Type.Array(ImageInputSchema), PromptIdsSchema]),
			]),
			result: Type.Unsafe<PromptReceipt>(PromptReceiptSchema),
		},
		command: {
			args: Type.Union([
				Type.Tuple([Id, Type.String({ minLength: 1, pattern: "^[^\\s/]+$" })]),
				Type.Tuple([Id, Type.String({ minLength: 1, pattern: "^[^\\s/]+$" }), Type.String()]),
			]),
			result: Type.Unsafe<PromptReceipt>(PromptReceiptSchema),
		},
		abort: { args: Type.Tuple([Id]), result: Type.Void() },
		retry: {
			args: Type.Union([Type.Tuple([Id, Id]), Type.Tuple([Id, Id, Type.Number()])]),
			result: Type.Unsafe<PromptReceipt>(PromptReceiptSchema),
		},
		setModel: { args: Type.Tuple([Id, Id, Id]), result: Type.Void() },
		setThinkingLevel: { args: Type.Tuple([Id, Id]), result: Type.Void() },
		/** P18：模式即工具白名单（single / lead / swarm）；返回本次增减的工具，供 UI 提示 */
		setAgentMode: {
			args: Type.Tuple([
				Id,
				Type.Union([Type.Literal("single"), Type.Literal("lead"), Type.Literal("swarm")]),
			]),
			result: Type.Object(
				{ added: Type.Array(Type.String()), removed: Type.Array(Type.String()) },
				{ additionalProperties: false },
			),
		},
		setSkillNamesEnabled: {
			args: Type.Tuple([Id, Type.Array(Type.String()), Type.Boolean()]),
			result: Type.Object({ disabled: Type.Array(Type.String()) }, { additionalProperties: false }),
		},
		compact: {
			args: Type.Union([Type.Tuple([Id]), Type.Tuple([Id, Type.String()])]),
			result: Type.Void(),
		},
		getStats: { args: Type.Tuple([Id]), result: ObjectResult<SessionStats>() },
		getContextUsage: {
			args: Type.Tuple([Id]),
			result: Type.Union([Type.Null(), ObjectResult<ContextUsageInfo>()]),
		},
		clearQueue: { args: Type.Tuple([Id]), result: QueuedMessagesSchema },
		getFollowUpMessages: { args: Type.Tuple([Id]), result: Type.Array(Type.String()) },
		listSlashCommands: { args: Type.Tuple([Id]), result: ArrayResult<SlashCommandInfo>() },
		listSlashCommandsForCwd: {
			args: Type.Union([Type.Tuple([]), Type.Tuple([Type.String({ minLength: 1 })])]),
			result: ArrayResult<SlashCommandInfo>(),
		},
		setSessionName: { args: Type.Tuple([Id, Type.String()]), result: Type.Void() },
		exportSession: { args: Type.Tuple([Id, ExportFormatSchema]), result: Type.String() },
		forkSession: {
			args: Type.Tuple([Id, ForkRefSchema]),
			result: Type.Unsafe<SessionMeta>(SessionMetaSchema),
		},
		recallMessage: { args: Type.Tuple([Id, RecallRefSchema]), result: RecallResultSchema },
		getLoadedResources: { args: Type.Tuple([Id]), result: ObjectResult<LoadedResources>() },
		getSessionMessages: { args: Type.Tuple([Id]), result: ArrayResult<SessionMessage>() },
		peekSubagentMessages: {
			args: Type.Tuple([Type.String({ minLength: 1 })]),
			result: ArrayResult<SessionMessage>(),
		},
		steerSubagent: {
			args: Type.Union([
				Type.Tuple([Id, Type.String()]),
				Type.Tuple([Id, Type.String(), Type.Union([Type.Literal("steer"), Type.Literal("followUp")])]),
			]),
			result: Type.Void(),
		},
		replySubagentSupervisor: { args: Type.Tuple([Id, Id, Type.String()]), result: Type.Void() },
		getTodos: { args: Type.Tuple([Id]), result: ArrayResult<TodoItem>() },
		listModels: { args: Type.Tuple([]), result: ArrayResult<AvailableModel>() },
		listProjectFiles: {
			args: Type.Union([Type.Tuple([]), Type.Tuple([Type.String({ minLength: 1 })])]),
			result: Type.Array(Type.String()),
		},
		ensureProjectTrust: { args: Type.Tuple([Type.String({ minLength: 1 })]), result: Type.Boolean() },
	},
	events: { event: Type.Unsafe<SessionEventEnvelope>({ type: "object" }) },
});

/**
 * PiApi-compatible client shape derived from the contract. TypeBox represents
 * optional IPC arguments as a union of tuples so runtime arity remains strict;
 * this small overlay restores the ergonomic optional parameters used by the
 * existing renderer call sites while deriving every return type from the
 * contract client.
 */
type SessionClient = ClientOf<typeof SessionsContract>;
type SessionMethod = keyof typeof SessionsContract.methods;
type SessionResult<K extends SessionMethod> = Awaited<ReturnType<SessionClient[K]>>;
type OptionalSessionClient = {
	listSessions(cwd?: string): Promise<SessionResult<"listSessions">>;
	deleteSession(sessionId: string, sessionFile?: string): Promise<SessionResult<"deleteSession">>;
	prompt(
		sessionId: string,
		text: string,
		images?: ImageInput[],
		ids?: PromptIds,
	): Promise<SessionResult<"prompt">>;
	retry(
		sessionId: string,
		requestId: string,
		expectedUserTimestamp?: number,
	): Promise<SessionResult<"retry">>;
	compact(sessionId: string, customInstructions?: string): Promise<SessionResult<"compact">>;
	listSlashCommandsForCwd(cwd?: string): Promise<SessionResult<"listSlashCommandsForCwd">>;
	steerSubagent(
		sessionId: string,
		message: string,
		mode?: "steer" | "followUp",
	): Promise<SessionResult<"steerSubagent">>;
	listProjectFiles(cwd?: string): Promise<SessionResult<"listProjectFiles">>;
};
/** The backend port uses the method surface and dispatches its own two-argument session events. */
export type SessionsApi<Surface extends "methods" | "desktop" = "methods"> = Omit<
	Surface extends "desktop" ? SessionClient : Pick<SessionClient, SessionMethod>,
	keyof OptionalSessionClient
> &
	OptionalSessionClient;

/** Shared argument aliases for code that needs the migration boundary explicitly. */
export type SessionsSchemaTypes = {
	createSession: [options: CreateSessionOptions];
	listSessions: [] | [cwd: string];
	listAllSessions: [];
	openSession: [filePath: string];
	closeSession: [sessionId: string];
	deleteSession: [sessionId: string] | [sessionId: string, sessionFile: string];
	prompt:
		| [sessionId: string, text: string]
		| [sessionId: string, text: string, images: ImageInput[]]
		| [sessionId: string, text: string, images: ImageInput[], ids: PromptIds];
	command: [sessionId: string, name: string] | [sessionId: string, name: string, args: string];
	abort: [sessionId: string];
	retry:
		| [sessionId: string, requestId: string]
		| [sessionId: string, requestId: string, expectedUserTimestamp: number];
	setModel: [sessionId: string, provider: string, modelId: string];
	setThinkingLevel: [sessionId: string, level: string];
	setAgentMode: [sessionId: string, mode: "single" | "lead" | "swarm"];
	setSkillNamesEnabled: [sessionId: string, names: string[], enabled: boolean];
	compact: [sessionId: string] | [sessionId: string, customInstructions: string];
	getStats: [sessionId: string];
	getContextUsage: [sessionId: string];
	clearQueue: [sessionId: string];
	getFollowUpMessages: [sessionId: string];
	listSlashCommands: [sessionId: string];
	listSlashCommandsForCwd: [] | [cwd: string];
	setSessionName: [sessionId: string, name: string];
	exportSession: [sessionId: string, format: "html" | "jsonl"];
	forkSession: [sessionId: string, ref: { entryId?: string; text?: string }];
	recallMessage: [sessionId: string, ref: { entryId?: string; text?: string; timestamp?: number }];
	getLoadedResources: [sessionId: string];
	getSessionMessages: [sessionId: string];
	peekSubagentMessages: [filePath: string];
	steerSubagent:
		| [sessionId: string, message: string]
		| [sessionId: string, message: string, mode: "steer" | "followUp"];
	replySubagentSupervisor: [sessionId: string, requestId: string, message: string];
	getTodos: [sessionId: string];
	listModels: [];
	listProjectFiles: [] | [cwd: string];
	ensureProjectTrust: [cwd: string];
};
