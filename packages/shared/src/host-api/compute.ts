import { type Static, Type } from "typebox";
import {
	ComputeHealthStatusSchema,
	ComputeHostInputSchema,
	ComputeHostSchema,
	ComputeIdSchema,
	ComputeJobSchema,
	ComputeLogChunkSchema,
	ComputeOnboardingStatusSchema,
	ComputeTerminalSchema,
} from "../compute";
import { defineDomain } from "./define";

const IdArgs = Type.Tuple([ComputeIdSchema]);
const EmptyArgs = Type.Tuple([]);
const HealthSnapshotSchema = Type.Object(
	{
		checkedAt: Type.String({ minLength: 1, maxLength: 64 }),
		hosts: Type.Array(
			Type.Object(
				{
					id: ComputeIdSchema,
					alias: Type.String({ minLength: 1, maxLength: 64 }),
					status: ComputeHealthStatusSchema,
					checkedAt: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
					latencyMs: Type.Optional(Type.Number({ minimum: 0 })),
					details: Type.Optional(Type.String({ maxLength: 512 })),
					errorCode: Type.Optional(Type.String({ maxLength: 128 })),
				},
				{ additionalProperties: false },
			),
			{ maxItems: 256 },
		),
	},
	{ additionalProperties: false },
);
export type ComputeHealthSnapshot = Static<typeof HealthSnapshotSchema>;

const JobFilterSchema = Type.Object(
	{
		states: Type.Optional(
			Type.Array(
				Type.Union([
					Type.Literal("queued"),
					Type.Literal("running"),
					Type.Literal("succeeded"),
					Type.Literal("failed"),
					Type.Literal("cancelled"),
					Type.Literal("unknown"),
				]),
				{ maxItems: 6 },
			),
		),
		hostId: Type.Optional(ComputeIdSchema),
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
	},
	{ additionalProperties: false },
);

const LogArgsSchema = Type.Tuple([
	ComputeIdSchema,
	Type.Optional(Type.String({ minLength: 0, maxLength: 256 })),
]);
const TerminalOpenSchema = Type.Object(
	{
		hostId: ComputeIdSchema,
		cwd: Type.Optional(Type.String({ maxLength: 1024 })),
		mode: Type.Optional(Type.Union([Type.Literal("shell"), Type.Literal("command")])),
	},
	{ additionalProperties: false },
);
const TerminalWriteSchema = Type.Tuple([ComputeIdSchema, Type.String({ maxLength: 16_384 })]);
const OnboardingStepArgs = Type.Tuple([
	Type.Union([
		Type.Literal("model"),
		Type.Literal("project"),
		Type.Literal("knowledge"),
		Type.Literal("literature"),
		Type.Literal("mcp"),
		Type.Literal("remote-host"),
		Type.Literal("example-task"),
	]),
]);

/**
 * Desktop projection for host inventory, health and read-only job observation.
 * Mutating methods stay desktop-only and all remote effects are
 * still gated by the backend approval/compute adapter.
 */
export const ComputeContract = defineDomain("compute", {
	methods: {
		listHosts: { args: EmptyArgs, result: Type.Array(ComputeHostSchema, { maxItems: 256 }) },
		getHost: { args: IdArgs, result: Type.Union([ComputeHostSchema, Type.Null()]) },
		saveHost: { args: Type.Tuple([ComputeHostInputSchema]), result: ComputeHostSchema },
		removeHost: { args: IdArgs, result: Type.Void() },
		probeHost: { args: IdArgs, result: ComputeHostSchema },
		// LAN has no compute projection yet; keep these desktop-only until the
		// authenticated observer exposes the same schemas through its GET routes.
		getHealthSnapshot: { args: EmptyArgs, result: HealthSnapshotSchema },
		listJobs: {
			args: Type.Tuple([Type.Optional(JobFilterSchema)]),
			result: Type.Array(ComputeJobSchema, { maxItems: 100 }),
		},
		getJob: { args: IdArgs, result: Type.Union([ComputeJobSchema, Type.Null()]) },
		getLogs: { args: LogArgsSchema, result: ComputeLogChunkSchema },
		cancelJob: { args: IdArgs, result: Type.Void() },
		openTerminal: { args: Type.Tuple([TerminalOpenSchema]), result: ComputeTerminalSchema },
		getTerminal: { args: IdArgs, result: Type.Union([ComputeTerminalSchema, Type.Null()]) },
		writeTerminal: { args: TerminalWriteSchema, result: Type.Void() },
		closeTerminal: { args: IdArgs, result: Type.Void() },
		getOnboardingStatus: {
			args: EmptyArgs,
			result: Type.Array(ComputeOnboardingStatusSchema, { maxItems: 16 }),
		},
		checkOnboardingStep: { args: OnboardingStepArgs, result: ComputeOnboardingStatusSchema },
	},
	events: {
		healthChanged: HealthSnapshotSchema,
		jobUpdated: ComputeJobSchema,
		logChunk: ComputeLogChunkSchema,
		terminalOutput: Type.Object(
			{ terminalId: ComputeIdSchema, text: Type.String({ maxLength: 16_384 }), truncated: Type.Boolean() },
			{ additionalProperties: false },
		),
		terminalClosed: Type.Object({ terminalId: ComputeIdSchema }, { additionalProperties: false }),
	},
});

export type ComputeApi = import("./define").ClientOf<typeof ComputeContract>;
