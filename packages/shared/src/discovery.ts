import { type Static, Type } from "typebox";

export const DiscoveryKernelLanguageSchema = Type.Union([Type.Literal("python"), Type.Literal("r")]);
export type DiscoveryKernelLanguage = Static<typeof DiscoveryKernelLanguageSchema>;
export const DiscoveryDataClassificationSchema = Type.Union([
	Type.Literal("public"),
	Type.Literal("internal"),
	Type.Literal("controlled"),
	Type.Literal("restricted"),
]);
export type DiscoveryDataClassification = Static<typeof DiscoveryDataClassificationSchema>;
export const DiscoveryKernelStatusSchema = Type.Union([
	Type.Literal("ready"),
	Type.Literal("running"),
	Type.Literal("closed"),
	Type.Literal("idle-timeout"),
	Type.Literal("needs-container"),
]);
export type DiscoveryKernelStatus = Static<typeof DiscoveryKernelStatusSchema>;
export const DiscoveryRunnerKindSchema = Type.Union([
	Type.Literal("container"),
	Type.Literal("fixture"),
	Type.Literal("unavailable"),
]);
export type DiscoveryRunnerKind = Static<typeof DiscoveryRunnerKindSchema>;

export const DiscoveryCapabilitiesSchema = Type.Object(
	{
		kind: DiscoveryRunnerKindSchema,
		languages: Type.Array(DiscoveryKernelLanguageSchema, { maxItems: 2 }),
		networkDisabled: Type.Boolean(),
		writesOnlyToRunDirectory: Type.Boolean(),
	},
	{ additionalProperties: false },
);
export type DiscoveryCapabilities = Static<typeof DiscoveryCapabilitiesSchema>;

export const DiscoveryKernelSessionSchema = Type.Object(
	{
		sessionId: Type.String({ minLength: 1, maxLength: 128 }),
		language: DiscoveryKernelLanguageSchema,
		dataClassification: DiscoveryDataClassificationSchema,
		runDirectory: Type.String({ pattern: "^runs/" }),
		status: DiscoveryKernelStatusSchema,
		executionCount: Type.Integer({ minimum: 0 }),
		remainingExecutions: Type.Integer({ minimum: 0 }),
		expiresAt: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
		capabilities: DiscoveryCapabilitiesSchema,
	},
	{ additionalProperties: false },
);
export type DiscoveryKernelSession = Static<typeof DiscoveryKernelSessionSchema>;

export const DiscoveryExecutionSchema = Type.Object(
	{
		id: Type.String({ minLength: 1, maxLength: 128 }),
		status: Type.Union([Type.Literal("succeeded"), Type.Literal("failed"), Type.Literal("blocked")]),
		output: Type.String({ maxLength: 1_000_000 }),
		outputClassification: DiscoveryDataClassificationSchema,
		contentKinds: Type.Array(
			Type.Union([Type.Literal("summary"), Type.Literal("plot"), Type.Literal("table"), Type.Literal("raw")]),
			{ maxItems: 4 },
		),
		producedBytes: Type.Integer({ minimum: 0 }),
		redactedBytes: Type.Integer({ minimum: 0 }),
		blockedReason: Type.Optional(Type.String({ maxLength: 256 })),
	},
	{ additionalProperties: false },
);
export type DiscoveryExecution = Static<typeof DiscoveryExecutionSchema>;

export const DiscoveryCriticQuestionSchema = Type.Object(
	{
		checklistItem: Type.String({ minLength: 1, maxLength: 64 }),
		question: Type.String({ minLength: 1, maxLength: 10_000 }),
		severity: Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")]),
		evidenceArtifactIds: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { maxItems: 128 }),
	},
	{ additionalProperties: false },
);
export type DiscoveryCriticQuestion = Static<typeof DiscoveryCriticQuestionSchema>;

export const DiscoveryCriticReviewSchema = Type.Object(
	{
		findingId: Type.String({ minLength: 1, maxLength: 128 }),
		status: Type.Union([
			Type.Literal("complete"),
			Type.Literal("blocked"),
			Type.Literal("needs-independent-provider"),
		]),
		providerId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
		questions: Type.Array(DiscoveryCriticQuestionSchema, { maxItems: 256 }),
		reason: Type.Optional(Type.String({ maxLength: 10_000 })),
	},
	{ additionalProperties: false },
);
export type DiscoveryCriticReview = Static<typeof DiscoveryCriticReviewSchema>;

export const DiscoveryMultipathAssessmentSchema = Type.Object(
	{
		planId: Type.String({ minLength: 1, maxLength: 128 }),
		findingId: Type.String({ minLength: 1, maxLength: 128 }),
		grade: Type.Union([
			Type.Literal("robust"),
			Type.Literal("sensitive"),
			Type.Literal("unstable"),
			Type.Literal("unknown"),
		]),
		intent: Type.Union([Type.Literal("exploratory"), Type.Literal("confirmatory")]),
		attemptCount: Type.Integer({ minimum: 0 }),
		consistentCount: Type.Integer({ minimum: 0 }),
		consistency: Type.Number({ minimum: 0, maximum: 1 }),
	},
	{ additionalProperties: false },
);
export type DiscoveryMultipathAssessment = Static<typeof DiscoveryMultipathAssessmentSchema>;

export const DiscoveryExplorationPlanSchema = Type.Object(
	{
		id: Type.String({ minLength: 1, maxLength: 128 }),
		projectId: Type.String({ minLength: 1, maxLength: 128 }),
		hypothesisId: Type.String({ minLength: 1, maxLength: 128 }),
		prior: Type.Unknown(),
		budget: Type.Object(
			{
				maxExecutions: Type.Integer({ minimum: 1 }),
				maxWallTimeMs: Type.Integer({ minimum: 1 }),
				maxOutputBytes: Type.Integer({ minimum: 1 }),
				maxCostUnits: Type.Number({ exclusiveMinimum: 0 }),
			},
			{ additionalProperties: false },
		),
		rankedCandidateIds: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { maxItems: 1024 }),
		createdAt: Type.String({ minLength: 1, maxLength: 64 }),
	},
	{ additionalProperties: false },
);
export type DiscoveryExplorationPlan = Static<typeof DiscoveryExplorationPlanSchema>;

export const DiscoveryEvaluationMetricSchema = Type.Union([
	Type.Literal("bixbench-regression"),
	Type.Literal("rediscovery-rate"),
	Type.Literal("inconsistency-interception-rate"),
	Type.Literal("confounder-detection-rate"),
	Type.Literal("clue-hit-rate"),
	Type.Literal("verification-time-ms"),
	Type.Literal("repeated-failure-count"),
]);
export type DiscoveryEvaluationMetric = Static<typeof DiscoveryEvaluationMetricSchema>;
export const DiscoveryEvaluationSchema = Type.Object(
	{
		runId: Type.String({ minLength: 1, maxLength: 128 }),
		status: Type.Union([Type.Literal("complete"), Type.Literal("needs-data"), Type.Literal("blocked")]),
		startedAt: Type.String({ minLength: 1, maxLength: 64 }),
		finishedAt: Type.String({ minLength: 1, maxLength: 64 }),
		missingData: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { maxItems: 256 }),
		blockedCases: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { maxItems: 256 }),
		metrics: Type.Array(
			Type.Object(
				{
					metric: DiscoveryEvaluationMetricSchema,
					value: Type.Number({ minimum: 0 }),
					baseline: Type.Optional(Type.Number({ minimum: 0 })),
					delta: Type.Optional(Type.Number()),
					passed: Type.Boolean(),
					baselineAvailable: Type.Boolean(),
					caseIds: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { maxItems: 256 }),
				},
				{ additionalProperties: false },
			),
			{ maxItems: 16 },
		),
	},
	{ additionalProperties: false },
);
export type DiscoveryEvaluation = Static<typeof DiscoveryEvaluationSchema>;
