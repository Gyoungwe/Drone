import { Type } from "typebox";
import type {
	SubagentDispatchInput,
	SubagentDispatchReceipt,
	SubagentPanelAgent,
	SubagentPanelRun,
	SubagentPanelSnapshot,
} from "../subagent";
import { defineDomain } from "./define";

const SubagentPanelSourceSchema = Type.Union([
	Type.Literal("builtin"),
	Type.Literal("user"),
	Type.Literal("project"),
]);

const SubagentPanelRunStatusSchema = Type.Union([
	Type.Literal("queued"),
	Type.Literal("running"),
	Type.Literal("needs_reply"),
	Type.Literal("waiting_approval"),
	Type.Literal("done"),
	Type.Literal("error"),
	Type.Literal("aborted"),
]);

const SubagentPanelContextStateSchema = Type.Union([
	Type.Literal("none"),
	Type.Literal("pending"),
	Type.Literal("delivered"),
]);

const SupervisorRequestSchema = Type.Object(
	{
		id: Type.String({ minLength: 1 }),
		reason: Type.Union([
			Type.Literal("need_decision"),
			Type.Literal("interview_request"),
			Type.Literal("progress_update"),
		]),
		message: Type.String(),
		expectsReply: Type.Boolean(),
	},
	{ additionalProperties: false },
);

const SubagentPanelAgentSchema = Type.Object(
	{
		name: Type.String({ minLength: 1 }),
		description: Type.String(),
		source: SubagentPanelSourceSchema,
		tools: Type.Array(Type.String()),
		model: Type.Optional(Type.String()),
		mcpAccess: Type.Union([Type.Literal("none"), Type.Literal("read-local")]),
		trusted: Type.Boolean(),
		path: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

const SubagentPanelSnapshotSchema = Type.Object(
	{
		sessionId: Type.String({ minLength: 1 }),
		cwd: Type.String({ minLength: 1 }),
		agents: Type.Array(SubagentPanelAgentSchema),
		maxConcurrent: Type.Integer({ minimum: 1 }),
		projectTrusted: Type.Boolean(),
		userAgentsDir: Type.String({ minLength: 1 }),
		projectAgentsDir: Type.String({ minLength: 1 }),
		readOnly: Type.Boolean(),
	},
	{ additionalProperties: false },
);

const SubagentDispatchTaskSchema = Type.Object(
	{
		agent: Type.String({ minLength: 1 }),
		task: Type.String({ minLength: 1 }),
		requiredTools: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
	},
	{ additionalProperties: false },
);

const SubagentDispatchInputSchema = Type.Object(
	{
		tasks: Type.Array(SubagentDispatchTaskSchema, { minItems: 1, maxItems: 8 }),
		cwd: Type.Optional(Type.String({ minLength: 1 })),
		followUp: Type.Optional(Type.Boolean()),
		trustProjectAgents: Type.Optional(Type.Boolean()),
	},
	{ additionalProperties: false },
);

const SubagentPanelRunSchema = Type.Object(
	{
		runId: Type.String({ minLength: 1 }),
		dispatchId: Type.String({ minLength: 1 }),
		parentSessionId: Type.String({ minLength: 1 }),
		agent: Type.String({ minLength: 1 }),
		source: SubagentPanelSourceSchema,
		task: Type.String({ minLength: 1 }),
		cwd: Type.String({ minLength: 1 }),
		requiredTools: Type.Array(Type.String({ minLength: 1 })),
		followUp: Type.Boolean(),
		status: SubagentPanelRunStatusSchema,
		contextState: SubagentPanelContextStateSchema,
		queuePosition: Type.Optional(Type.Integer({ minimum: 1 })),
		createdAt: Type.Number(),
		startedAt: Type.Optional(Type.Number()),
		endedAt: Type.Optional(Type.Number()),
		childSessionId: Type.Optional(Type.String({ minLength: 1 })),
		sessionFile: Type.Optional(Type.String({ minLength: 1 })),
		model: Type.Optional(Type.String()),
		tokens: Type.Optional(Type.Number({ minimum: 0 })),
		exitCode: Type.Optional(Type.Integer()),
		error: Type.Optional(Type.String()),
		content: Type.Optional(Type.String()),
		statusText: Type.Optional(Type.String()),
		statusPhase: Type.Optional(Type.String()),
		currentAction: Type.Optional(Type.String()),
		currentTool: Type.Optional(Type.String()),
		lastSteerAt: Type.Optional(Type.Number()),
		supervisorRequest: Type.Optional(Type.Union([SupervisorRequestSchema, Type.Null()])),
		pendingApprovalIds: Type.Array(Type.String({ minLength: 1 })),
	},
	{ additionalProperties: false },
);

const SubagentDispatchReceiptSchema = Type.Object(
	{
		dispatchId: Type.String({ minLength: 1 }),
		runs: Type.Array(SubagentPanelRunSchema),
	},
	{ additionalProperties: false },
);

/** Host API contract for the in-session subagent panel and run controls. */
export const SubagentsContract = defineDomain("subagents", {
	methods: {
		list: {
			args: Type.Tuple([Type.String({ minLength: 1 })]),
			result: SubagentPanelSnapshotSchema,
		},
		dispatch: {
			args: Type.Tuple([Type.String({ minLength: 1 }), SubagentDispatchInputSchema]),
			result: SubagentDispatchReceiptSchema,
		},
		abort: {
			args: Type.Tuple([Type.String({ minLength: 1 })]),
			result: Type.Boolean(),
		},
		runs: {
			args: Type.Tuple([Type.String({ minLength: 1 })]),
			result: Type.Array(SubagentPanelRunSchema),
		},
	},
});

export type SubagentsSchemaTypes = {
	list: [sessionId: string];
	dispatch: [sessionId: string, input: SubagentDispatchInput];
	abort: [runId: string];
	runs: [sessionId: string];
};

export type {
	SubagentDispatchInput,
	SubagentDispatchReceipt,
	SubagentPanelAgent,
	SubagentPanelRun,
	SubagentPanelSnapshot,
};
