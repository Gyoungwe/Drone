import { type Static, type TSchema, Type } from "typebox";
import { defineDomain } from "./host-api/define";

const Id = Type.String({ minLength: 1, maxLength: 256 });
const Alias = Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" });
const JobState = Type.Union([
	Type.Literal("draft"),
	Type.Literal("authorized"),
	Type.Literal("prepared"),
	Type.Literal("submitting"),
	Type.Literal("queued"),
	Type.Literal("running"),
	Type.Literal("collecting"),
	Type.Literal("cancelling"),
	Type.Literal("succeeded"),
	Type.Literal("failed"),
	Type.Literal("cancelled"),
	Type.Literal("unknown"),
	Type.Literal("needs_login"),
	Type.Literal("needs-login"),
	Type.Literal("blocked"),
	Type.Literal("partial"),
]);

/** Persisted host configuration. Authentication secrets never cross this contract. */
export const ComputeHostSchema = Type.Object(
	{
		alias: Alias,
		host: Id,
		port: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535 })),
		username: Type.Optional(Id),
		transport: Type.Optional(Type.Union([Type.Literal("builtin-ssh"), Type.Literal("openssh")])),
		identityFile: Type.Optional(Type.String({ minLength: 1 })),
		jumpHosts: Type.Optional(Type.Array(Alias, { maxItems: 8 })),
		hostKeyFingerprint: Type.Optional(Type.String({ minLength: 1 })),
	},
	{ additionalProperties: false },
);
export type ComputeHost = Static<typeof ComputeHostSchema>;

export const ComputeCapabilitySchema = Type.Object(
	{
		alias: Alias,
		runnerVersion: Id,
		protocolVersion: Type.Integer({ minimum: 1 }),
		scheduler: Type.Union([Type.Literal("direct"), Type.Literal("slurm"), Type.Literal("unsupported")]),
		containerRuntime: Type.Optional(Type.Union([Type.String(), Type.Null()])),
		nextflowVersion: Type.Optional(Type.Union([Type.String(), Type.Null()])),
		cpuCount: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
		memoryBytes: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
		diskBytes: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
		maxUploadBytes: Type.Optional(Type.Integer({ minimum: 0 })),
		maxCollectBytes: Type.Optional(Type.Integer({ minimum: 0 })),
		loginNode: Type.Optional(Type.Boolean()),
		probedAt: Type.Number({ minimum: 0 }),
	},
	{ additionalProperties: false },
);
export type ComputeCapability = Static<typeof ComputeCapabilitySchema>;

const WorkflowModuleSchema = Type.Object(
	{
		id: Id,
		source: Type.Union([Type.Literal("nf-core"), Type.Literal("user"), Type.Literal("agent")]),
		name: Id,
		version: Id,
		commit: Type.Optional(Id),
		containerDigest: Type.Optional(Id),
	},
	{ additionalProperties: false },
);
const WorkflowStepSchema = Type.Object(
	{
		id: Id,
		module: WorkflowModuleSchema,
		dependsOn: Type.Optional(Type.Array(Id)),
		parameters: Type.Optional(
			Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Boolean()])),
		),
	},
	{ additionalProperties: false },
);
export const WorkflowSpecSchema = Type.Object(
	{
		version: Type.Literal(1),
		modules: Type.Array(WorkflowModuleSchema),
		steps: Type.Array(WorkflowStepSchema),
		inputs: Type.Optional(Type.Record(Type.String(), Type.String())),
		outputs: Type.Optional(Type.Array(Type.String())),
	},
	{ additionalProperties: false },
);
export type WorkflowSpec = Static<typeof WorkflowSpecSchema>;

/** Compact identity for a workflow already registered on the remote host. */
export const WorkflowRefSchema = Type.Object(
	{
		name: Id,
		version: Id,
		source: Type.Optional(Id),
		specHash: Type.Optional(Id),
	},
	{ additionalProperties: false },
);
export type WorkflowRef = Static<typeof WorkflowRefSchema>;

export const ArtifactExpectationSchema = Type.Object(
	{
		path: Type.String({ minLength: 1 }),
		bytes: Type.Optional(Type.Integer({ minimum: 0 })),
		sha256: Type.Optional(Type.String({ pattern: "^[a-fA-F0-9]{64}$" })),
		maxBytes: Type.Optional(Type.Integer({ minimum: 0 })),
	},
	{ additionalProperties: false },
);

export const JobSpecSchema = Type.Object(
	{
		jobId: Type.Optional(Id),
		idempotencyKey: Type.Optional(Id),
		hostAlias: Alias,
		workflow: Type.Union([WorkflowSpecSchema, WorkflowRefSchema]),
		workDir: Type.Optional(Type.String({ minLength: 1 })),
		remoteWorkDir: Type.Optional(Type.String({ minLength: 1 })),
		resources: Type.Optional(
			Type.Object(
				{
					cpus: Type.Optional(Type.Integer({ minimum: 1 })),
					memoryBytes: Type.Optional(Type.Integer({ minimum: 0 })),
					wallTimeSeconds: Type.Optional(Type.Integer({ minimum: 1 })),
				},
				{ additionalProperties: false },
			),
		),
		remoteRead: Type.Optional(Type.Array(Type.String())),
		remoteWrite: Type.Optional(Type.Array(Type.String())),
		outputs: Type.Optional(Type.Array(Type.Union([Type.String(), ArtifactExpectationSchema]))),
	},
	{ additionalProperties: false },
);
export type ComputeJobSpec = Static<typeof JobSpecSchema>;

const JobSummarySchema = Type.Object(
	{
		jobId: Id,
		hostAlias: Alias,
		status: JobState,
		createdAt: Type.Number({ minimum: 0 }),
		updatedAt: Type.Number({ minimum: 0 }),
		remoteId: Type.Optional(Id),
		pid: Type.Optional(Type.Integer({ minimum: 1 })),
		cursor: Type.Optional(Type.String()),
		error: Type.Optional(
			Type.Union([
				Type.String(),
				Type.Object({ code: Id, message: Type.String() }, { additionalProperties: false }),
			]),
		),
	},
	{ additionalProperties: false },
);
export type ComputeJobSummary = Static<typeof JobSummarySchema>;

const LogChunkSchema = Type.Object(
	{
		events: Type.Array(
			Type.Object(
				{
					type: Id,
					at: Type.Optional(Type.Number()),
					text: Type.Optional(Type.String()),
				},
				{ additionalProperties: true },
			),
		),
		cursor: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

const ModuleEntrySchema = Type.Object(
	{
		id: Id,
		name: Id,
		source: Type.Union([Type.Literal("nf-core"), Type.Literal("user"), Type.Literal("agent")]),
		version: Id,
		containerDigest: Type.Optional(Id),
	},
	{ additionalProperties: false },
);

const OneObject = (schema: TSchema) => Type.Tuple([schema]);

/** Shared desktop/LAN host API for remote compute. No method accepts a command string. */
export const ComputeContract = defineDomain("compute", {
	methods: {
		listHosts: { args: Type.Tuple([]), result: Type.Array(ComputeHostSchema) },
		upsertHost: { args: OneObject(ComputeHostSchema), result: ComputeHostSchema },
		removeHost: { args: Type.Tuple([Alias]), result: Type.Boolean() },
		probeHost: { args: Type.Tuple([Alias]), result: ComputeCapabilitySchema },
		listJobs: { args: Type.Tuple([]), result: Type.Array(JobSummarySchema), access: "lan-read" },
		getJob: {
			args: Type.Tuple([Id]),
			result: Type.Union([Type.Null(), JobSummarySchema]),
			access: "lan-read",
		},
		getJobLogs: {
			args: Type.Union([Type.Tuple([Id]), Type.Tuple([Id, Type.String()])]),
			result: LogChunkSchema,
			access: "desktop",
		},
		cancelJob: { args: Type.Tuple([Id]), result: JobSummarySchema },
		collectJob: {
			args: OneObject(
				Type.Object(
					{
						jobId: Id,
						targetDir: Type.String({ minLength: 1 }),
						expected: Type.Optional(Type.Array(Type.String())),
					},
					{ additionalProperties: false },
				),
			),
			result: Type.Unknown(),
		},
		listWorkflowModules: { args: Type.Tuple([]), result: Type.Array(ModuleEntrySchema), access: "lan-read" },
	},
});

export type ComputeContractClient = import("./host-api/define").ClientOf<typeof ComputeContract>;
export type ComputeSchemaTypes = {
	listHosts: [];
	upsertHost: [host: ComputeHost];
	removeHost: [alias: string];
	probeHost: [alias: string];
	listJobs: [];
	getJob: [jobId: string];
	getJobLogs: [jobId: string] | [jobId: string, cursor: string];
	cancelJob: [jobId: string];
	collectJob: [input: { jobId: string; targetDir: string; expected?: string[] }];
	listWorkflowModules: [];
};
