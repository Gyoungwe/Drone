import { type Static, Type } from "typebox";

/**
 * The small, transport-safe contract used by an execution host.
 *
 * These records deliberately describe intent and observed state. They do not
 * carry commands, credentials, or arbitrary workflow source. The backend owns
 * the mapping from this route to an approved workflow specification.
 */
export const ExecutionRouteSchema = Type.Object(
	{
		version: Type.Literal(1),
		routeId: Type.Literal("rnaseq"),
		/** Original user text, bounded for display and audit. */
		intent: Type.String({ minLength: 1, maxLength: 400 }),
		/** Stable task/workflow direction. */
		workflow: Type.Literal("rnaseq"),
		pipeline: Type.Literal("nf-core/rnaseq"),
		inputStage: Type.Literal("fastq"),
		profile: Type.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9_.-]+$" }),
		samplesheet: Type.String({ minLength: 1, maxLength: 1024 }),
		genome: Type.Optional(Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_.-]+$" })),
		strandedness: Type.Optional(
			Type.Union([Type.Literal("unstranded"), Type.Literal("forward"), Type.Literal("reverse")]),
		),
	},
	{ additionalProperties: false },
);
export type ExecutionRoute = Static<typeof ExecutionRouteSchema>;

export const ComputeTaskBindingSchema = Type.Object(
	{
		version: Type.Literal(1),
		taskId: Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" }),
		routeId: Type.Literal("rnaseq"),
		workflowId: Type.Literal("rnaseq"),
		pipeline: Type.Literal("nf-core/rnaseq"),
		hostAlias: Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" }),
		workflowSpecSha256: Type.String({ pattern: "^[a-fA-F0-9]{64}$" }),
		samplesheet: Type.String({ minLength: 1, maxLength: 1024 }),
		revision: Type.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9_.-]+$" }),
		profile: Type.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9_.-]+$" }),
		executionMode: Type.Union([Type.Literal("fixture"), Type.Literal("production")]),
		idempotencyKey: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
	},
	{ additionalProperties: false },
);
export type ComputeTaskBinding = Static<typeof ComputeTaskBindingSchema>;

export const ExecutionReceiptStatusSchema = Type.Union([
	Type.Literal("preflight_passed"),
	Type.Literal("submitted"),
	Type.Literal("queued"),
	Type.Literal("running"),
	Type.Literal("succeeded"),
	Type.Literal("failed"),
	Type.Literal("unknown"),
	Type.Literal("blocked"),
]);
export type ExecutionReceiptStatus = Static<typeof ExecutionReceiptStatusSchema>;

export const ExecutionReceiptSchema = Type.Object(
	{
		version: Type.Literal(1),
		executionId: Type.String({ minLength: 1, maxLength: 128 }),
		status: ExecutionReceiptStatusSchema,
		fixture: Type.Boolean(),
		route: Type.Optional(ExecutionRouteSchema),
		binding: Type.Optional(ComputeTaskBindingSchema),
		workflowSpecSha256: Type.String({ pattern: "^[a-fA-F0-9]{64}$" }),
		preflight: Type.Object(
			{
				ok: Type.Boolean(),
				errors: Type.Array(Type.String({ maxLength: 512 }), { maxItems: 64 }),
				warnings: Type.Array(Type.String({ maxLength: 512 }), { maxItems: 64 }),
			},
			{ additionalProperties: false },
		),
		jobId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
		remoteId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
		createdAt: Type.String({ minLength: 1, maxLength: 64 }),
		submittedAt: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
		finishedAt: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
		error: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
	},
	{ additionalProperties: false },
);
export type ExecutionReceipt = Static<typeof ExecutionReceiptSchema>;
