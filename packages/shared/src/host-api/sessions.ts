import { Type } from "typebox";
import type { PromptReceipt } from "../ipc";
import type {
	AvailableModel,
	ContextUsageInfo,
	CreateSessionOptions,
	ImageInput,
	LoadedResources,
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

const PromptReceiptSchema = Type.Union([
	Type.Object({ kind: Type.Literal("agent") }, { additionalProperties: false }),
	Type.Object({ kind: Type.Literal("queued") }, { additionalProperties: false }),
	Type.Object({ kind: Type.Literal("command") }, { additionalProperties: false }),
]);

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

/**
 * Host contract for every session IPC method. Method names intentionally match
 * PiApi/backend names so the renderer call sites stay unchanged. The desktop
 * adapter maps these methods to the historical `session:*` channel names.
 */
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
});

/**
 * PiApi-compatible client shape derived from the contract. TypeBox represents
 * optional IPC arguments as a union of tuples so runtime arity remains strict;
 * this small overlay restores the ergonomic optional parameters used by the
 * existing renderer call sites while deriving every return type from the
 * contract client.
 */
type SessionClient = ClientOf<typeof SessionsContract>;
type SessionResult<K extends keyof SessionClient> = Awaited<ReturnType<SessionClient[K]>>;
type OptionalSessionClient = {
	listSessions(cwd?: string): Promise<SessionResult<"listSessions">>;
	deleteSession(sessionId: string, sessionFile?: string): Promise<SessionResult<"deleteSession">>;
	prompt(sessionId: string, text: string, images?: ImageInput[]): Promise<SessionResult<"prompt">>;
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
export type SessionsApi = Omit<SessionClient, keyof OptionalSessionClient> & OptionalSessionClient;

/** Shared argument aliases for code that needs the migration boundary explicitly. */
export type SessionsSchemaTypes = {
	createSession: [options: CreateSessionOptions];
	listSessions: [] | [cwd: string];
	listAllSessions: [];
	openSession: [filePath: string];
	closeSession: [sessionId: string];
	deleteSession: [sessionId: string] | [sessionId: string, sessionFile: string];
	prompt: [sessionId: string, text: string] | [sessionId: string, text: string, images: ImageInput[]];
	abort: [sessionId: string];
	retry:
		| [sessionId: string, requestId: string]
		| [sessionId: string, requestId: string, expectedUserTimestamp: number];
	setModel: [sessionId: string, provider: string, modelId: string];
	setThinkingLevel: [sessionId: string, level: string];
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
