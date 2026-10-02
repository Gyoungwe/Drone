import { type Static, Type } from "typebox";

/** Stable identifiers shared by the compute host, desktop and task adapters. */
export const ComputeIdSchema = Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9._:-]+$" });
export type ComputeId = Static<typeof ComputeIdSchema>;

export const ComputeHostKindSchema = Type.Union([
	Type.Literal("ssh"),
	Type.Literal("scheduler"),
	Type.Literal("local"),
]);
export type ComputeHostKind = Static<typeof ComputeHostKindSchema>;

export const ComputeHealthStatusSchema = Type.Union([
	Type.Literal("unknown"),
	Type.Literal("checking"),
	Type.Literal("healthy"),
	Type.Literal("degraded"),
	Type.Literal("offline"),
	Type.Literal("blocked"),
]);
export type ComputeHealthStatus = Static<typeof ComputeHealthStatusSchema>;

export const ComputeAuthStateSchema = Type.Union([
	Type.Literal("not_configured"),
	Type.Literal("ready"),
	Type.Literal("needs_login"),
	Type.Literal("rejected"),
]);
export type ComputeAuthState = Static<typeof ComputeAuthStateSchema>;

export const ComputeCapabilitySchema = Type.Object(
	{
		name: Type.String({ minLength: 1, maxLength: 128 }),
		version: Type.Optional(Type.String({ maxLength: 128 })),
		available: Type.Boolean(),
		details: Type.Optional(Type.String({ maxLength: 512 })),
	},
	{ additionalProperties: false },
);

export const ComputeResourcesSchema = Type.Object(
	{
		cpuCores: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000_000 })),
		memoryBytes: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
		gpuCount: Type.Optional(Type.Integer({ minimum: 0, maximum: 1_000_000 })),
		diskFreeBytes: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
	},
	{ additionalProperties: false },
);

/** A persisted host record deliberately contains no private key, password or token. */
export const ComputeHostSchema = Type.Object(
	{
		id: ComputeIdSchema,
		alias: Type.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9._-]+$" }),
		displayName: Type.String({ minLength: 1, maxLength: 160 }),
		kind: ComputeHostKindSchema,
		endpoint: Type.Optional(Type.String({ maxLength: 512, pattern: "^[^@]*$" })),
		port: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535 })),
		user: Type.Optional(Type.String({ maxLength: 128 })),
		platform: Type.Optional(Type.String({ maxLength: 64 })),
		arch: Type.Optional(Type.String({ maxLength: 64 })),
		workspaceRoot: Type.Optional(Type.String({ maxLength: 1024 })),
		authState: ComputeAuthStateSchema,
		managed: Type.Boolean(),
		health: Type.Object(
			{
				status: ComputeHealthStatusSchema,
				checkedAt: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
				latencyMs: Type.Optional(Type.Number({ minimum: 0 })),
				version: Type.Optional(Type.String({ maxLength: 128 })),
				details: Type.Optional(Type.String({ maxLength: 512 })),
				errorCode: Type.Optional(Type.String({ maxLength: 128 })),
			},
			{ additionalProperties: false },
		),
		capabilities: Type.Array(ComputeCapabilitySchema, { maxItems: 256 }),
		resources: Type.Optional(ComputeResourcesSchema),
		createdAt: Type.String({ minLength: 1, maxLength: 64 }),
		updatedAt: Type.String({ minLength: 1, maxLength: 64 }),
	},
	{ additionalProperties: false },
);
export type ComputeHost = Static<typeof ComputeHostSchema>;

export const ComputeHostInputSchema = Type.Object(
	{
		alias: Type.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9._-]+$" }),
		displayName: Type.String({ minLength: 1, maxLength: 160 }),
		kind: ComputeHostKindSchema,
		endpoint: Type.Optional(Type.String({ maxLength: 512, pattern: "^[^@]*$" })),
		port: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535 })),
		user: Type.Optional(Type.String({ maxLength: 128 })),
		workspaceRoot: Type.Optional(Type.String({ maxLength: 1024 })),
		managed: Type.Optional(Type.Boolean()),
	},
	{ additionalProperties: false },
);
export type ComputeHostInput = Static<typeof ComputeHostInputSchema>;

export const ComputeBudgetSchema = Type.Object(
	{
		/** Total CPU core-hours allowed for this task. */
		maxCoreHours: Type.Number({ minimum: 0, maximum: 1_000_000_000 }),
		/** Longest wall-clock duration of one job. */
		maxWalltimeMinutes: Type.Integer({ minimum: 1, maximum: 2_000_000 }),
		maxConcurrentJobs: Type.Integer({ minimum: 1, maximum: 10_000 }),
		maxDiskGb: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
	},
	{ additionalProperties: false },
);
export type ComputeBudget = Static<typeof ComputeBudgetSchema>;

/** Optional section of a task contract. Its exact value is included in contractHash. */
export const ComputeAuthorizationSchema = Type.Object(
	{
		hosts: Type.Array(ComputeIdSchema, { minItems: 1, maxItems: 32 }),
		remoteRead: Type.Array(Type.String({ minLength: 1, maxLength: 1024 }), { maxItems: 64 }),
		remoteWrite: Type.Array(Type.String({ minLength: 1, maxLength: 1024 }), { maxItems: 64 }),
		budget: ComputeBudgetSchema,
		workflows: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: 128 }),
		agentCode: Type.Optional(Type.Boolean()),
	},
	{ additionalProperties: false },
);
export type ComputeAuthorization = Static<typeof ComputeAuthorizationSchema>;

export const ComputeUsageSchema = Type.Object(
	{
		coreHours: Type.Number({ minimum: 0 }),
		activeJobs: Type.Integer({ minimum: 0 }),
		diskBytes: Type.Integer({ minimum: 0 }),
	},
	{ additionalProperties: false },
);
export type ComputeUsage = Static<typeof ComputeUsageSchema>;

export interface ComputePolicyDecision {
	readonly allowed: boolean;
	readonly code:
		| "ok"
		| "missing_authorization"
		| "host_not_allowed"
		| "workflow_not_allowed"
		| "remote_read_out_of_scope"
		| "remote_write_out_of_scope"
		| "agent_code_not_allowed"
		| "wall_time_exceeded"
		| "core_budget_exceeded"
		| "concurrency_exceeded"
		| "disk_budget_exceeded";
	readonly detail: string;
}

export interface ComputeJobRequest {
	readonly host: string;
	readonly workflow: string;
	readonly readPaths?: readonly string[];
	readonly writePaths?: readonly string[];
	readonly wallMinutes: number;
	readonly coreHours: number;
	readonly diskBytes?: number;
	readonly agentCode?: boolean;
}

function pathWithin(root: string, candidate: string): boolean {
	const segments = (value: string): string[] | null => {
		if (!value.startsWith("/") || value.includes("\0")) return null;
		const result: string[] = [];
		for (const segment of value.replace(/\\/g, "/").split("/")) {
			if (!segment || segment === ".") continue;
			if (segment === "..") return null;
			result.push(segment);
		}
		return result;
	};
	const base = segments(root);
	const target = segments(candidate);
	return Boolean(
		base &&
			target &&
			target.length >= base.length &&
			base.every((segment, index) => target[index] === segment),
	);
}

/**
 * Host-side, fail-closed budget and scope check. The model never decides this
 * result; B1's service calls it immediately before a remote side effect.
 */
export function checkComputeAuthorization(
	authorization: ComputeAuthorization | null | undefined,
	request: ComputeJobRequest,
	usage: ComputeUsage = { coreHours: 0, activeJobs: 0, diskBytes: 0 },
): ComputePolicyDecision {
	if (!authorization)
		return {
			allowed: false,
			code: "missing_authorization",
			detail: "Compute is not part of the approved task contract.",
		};
	if (
		!Number.isFinite(request.wallMinutes) ||
		request.wallMinutes < 0 ||
		!Number.isFinite(request.coreHours) ||
		request.coreHours < 0 ||
		(request.diskBytes !== undefined && (!Number.isFinite(request.diskBytes) || request.diskBytes < 0)) ||
		!Number.isFinite(usage.coreHours) ||
		usage.coreHours < 0 ||
		!Number.isInteger(usage.activeJobs) ||
		usage.activeJobs < 0 ||
		!Number.isInteger(usage.diskBytes) ||
		usage.diskBytes < 0
	)
		return {
			allowed: false,
			code: "core_budget_exceeded",
			detail: "Compute budget values must be finite and non-negative.",
		};
	if (!authorization.hosts.includes(request.host))
		return {
			allowed: false,
			code: "host_not_allowed",
			detail: "The host is outside the approved compute scope.",
		};
	if (!authorization.workflows.includes("*") && !authorization.workflows.includes(request.workflow))
		return {
			allowed: false,
			code: "workflow_not_allowed",
			detail: "The workflow is outside the approved module list.",
		};
	for (const path of request.readPaths ?? []) {
		if (!authorization.remoteRead.some((root) => pathWithin(root, path)))
			return {
				allowed: false,
				code: "remote_read_out_of_scope",
				detail: "A remote read path is outside the approved roots.",
			};
	}
	for (const path of request.writePaths ?? []) {
		if (!authorization.remoteWrite.some((root) => pathWithin(root, path)))
			return {
				allowed: false,
				code: "remote_write_out_of_scope",
				detail: "A remote write path is outside the approved roots.",
			};
	}
	if (request.agentCode && authorization.agentCode !== true)
		return {
			allowed: false,
			code: "agent_code_not_allowed",
			detail: "Agent-authored compute code is not approved.",
		};
	if (request.wallMinutes > authorization.budget.maxWalltimeMinutes)
		return {
			allowed: false,
			code: "wall_time_exceeded",
			detail: "The requested wall-clock limit exceeds the approved budget.",
		};
	if (
		!Number.isFinite(request.coreHours) ||
		usage.coreHours + request.coreHours > authorization.budget.maxCoreHours
	)
		return {
			allowed: false,
			code: "core_budget_exceeded",
			detail: "The requested core-hours exceed the remaining approved budget.",
		};
	if (usage.activeJobs >= authorization.budget.maxConcurrentJobs)
		return {
			allowed: false,
			code: "concurrency_exceeded",
			detail: "The approved concurrent-job limit has been reached.",
		};
	if ((usage.diskBytes ?? 0) + (request.diskBytes ?? 0) > authorization.budget.maxDiskGb * 1024 ** 3)
		return {
			allowed: false,
			code: "disk_budget_exceeded",
			detail: "The requested disk use exceeds the remaining approved budget.",
		};
	return {
		allowed: true,
		code: "ok",
		detail: "The request is within the approved compute scope and budget.",
	};
}

export type ComputeJobState = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "unknown";
export const ComputeJobSchema = Type.Object(
	{
		id: ComputeIdSchema,
		hostId: ComputeIdSchema,
		taskId: Type.Optional(ComputeIdSchema),
		sessionId: Type.Optional(ComputeIdSchema),
		state: Type.Union([
			Type.Literal("queued"),
			Type.Literal("running"),
			Type.Literal("succeeded"),
			Type.Literal("failed"),
			Type.Literal("cancelled"),
			Type.Literal("unknown"),
		]),
		label: Type.Optional(Type.String({ maxLength: 160 })),
		startedAt: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
		finishedAt: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
		exitCode: Type.Optional(Type.Integer()),
		budget: Type.Object(
			{
				coreHours: Type.Number({ minimum: 0 }),
				wallMinutes: Type.Number({ minimum: 0 }),
				diskBytes: Type.Number({ minimum: 0 }),
			},
			{ additionalProperties: false },
		),
		publicSummary: Type.Optional(Type.String({ maxLength: 1000 })),
		artifacts: Type.Array(
			Type.Object(
				{
					name: Type.String({ minLength: 1, maxLength: 256 }),
					path: Type.String({ maxLength: 1024 }),
					sha256: Type.Optional(Type.String({ maxLength: 128 })),
				},
				{ additionalProperties: false },
			),
			{ maxItems: 256 },
		),
		updatedAt: Type.String({ minLength: 1, maxLength: 64 }),
	},
	{ additionalProperties: false },
);
export type ComputeJob = Static<typeof ComputeJobSchema>;

export const ComputeLogChunkSchema = Type.Object(
	{
		jobId: ComputeIdSchema,
		cursor: Type.String({ minLength: 0, maxLength: 256 }),
		text: Type.String({ maxLength: 1_048_576 }),
		truncated: Type.Boolean(),
		at: Type.String({ minLength: 1, maxLength: 64 }),
	},
	{ additionalProperties: false },
);
export type ComputeLogChunk = Static<typeof ComputeLogChunkSchema>;

export const ComputeTerminalSchema = Type.Object(
	{
		id: ComputeIdSchema,
		hostId: ComputeIdSchema,
		jobId: Type.Optional(ComputeIdSchema),
		cwd: Type.String({ maxLength: 1024 }),
		mode: Type.Union([Type.Literal("shell"), Type.Literal("command")]),
		state: Type.Union([
			Type.Literal("connecting"),
			Type.Literal("open"),
			Type.Literal("needs_login"),
			Type.Literal("closed"),
			Type.Literal("error"),
		]),
		output: Type.String({ maxLength: 131_072 }),
		truncated: Type.Boolean(),
		startedAt: Type.String({ minLength: 1, maxLength: 64 }),
		endedAt: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
	},
	{ additionalProperties: false },
);
export type ComputeTerminal = Static<typeof ComputeTerminalSchema>;

export const ComputeOnboardingStepSchema = Type.Union([
	Type.Literal("model"),
	Type.Literal("project"),
	Type.Literal("knowledge"),
	Type.Literal("literature"),
	Type.Literal("mcp"),
	Type.Literal("remote-host"),
	Type.Literal("example-task"),
]);
export type ComputeOnboardingStep = Static<typeof ComputeOnboardingStepSchema>;

export const ComputeOnboardingStatusSchema = Type.Object(
	{
		step: ComputeOnboardingStepSchema,
		state: Type.Union([
			Type.Literal("ready"),
			Type.Literal("needs_action"),
			Type.Literal("not_configured"),
			Type.Literal("checking"),
		]),
		summary: Type.String({ maxLength: 512 }),
		checkedAt: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
		action: Type.Optional(Type.String({ maxLength: 128 })),
	},
	{ additionalProperties: false },
);
export type ComputeOnboardingStatus = Static<typeof ComputeOnboardingStatusSchema>;
