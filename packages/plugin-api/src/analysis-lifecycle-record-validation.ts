import type { AnalysisLifecycleLedger, AnalysisLifecycleResult } from "./analysis-lifecycle.js";

type Check = (value: unknown) => boolean;
type Fields = Readonly<Record<string, Check>>;

function plainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return (
		(prototype === Object.prototype || prototype === null) &&
		Reflect.ownKeys(value).length === Object.keys(value).length &&
		Object.values(Object.getOwnPropertyDescriptors(value)).every((field) => Object.hasOwn(field, "value"))
	);
}

function shape(required: Fields, optional: Fields = {}): Check {
	return (value) =>
		plainObject(value) &&
		Object.entries(required).every(([key, check]) => Object.hasOwn(value, key) && check(value[key])) &&
		Object.keys(value).every(
			(key) =>
				Object.hasOwn(required, key) ||
				(Object.hasOwn(optional, key) && optional[key]?.(value[key]) === true),
		);
}

function array(check: Check): Check {
	return (value) => {
		if (!Array.isArray(value) || Object.keys(value).length !== value.length) return false;
		if (Reflect.ownKeys(value).length !== value.length + 1) return false;
		if (
			!Object.values(Object.getOwnPropertyDescriptors(value)).every((field) => Object.hasOwn(field, "value"))
		)
			return false;
		for (let index = 0; index < value.length; index++) {
			if (!Object.hasOwn(value, index) || !check(value[index])) return false;
		}
		return true;
	};
}

function dictionary(check: Check): Check {
	return (value) => plainObject(value) && Object.values(value).every(check);
}

function oneOf(...values: readonly unknown[]): Check {
	return (value) => values.includes(value);
}

const text: Check = (value) => typeof value === "string";
const boolean = oneOf(true, false);
const finite: Check = (value) => typeof value === "number" && Number.isFinite(value);
const strings = array(text);
const identity = shape({ id: text, version: text });
const stages = oneOf("intake", "design", "readiness", "execution", "review", "delivery", "completed");
const capability = oneOf(
	"knowledge",
	"research",
	"analysis",
	"literature",
	"writing",
	"planning",
	"coding",
	"web",
	"files",
	"visualization",
	"external",
);
const gate = shape({
	code: oneOf(
		"scientific-ambiguity",
		"missing-data",
		"missing-biological-replicates",
		"reference-mismatch",
		"unsupported-method",
		"unsupported-assay",
		"compute-authorization-required",
		"destructive-operation-requires-review",
		"publication-requires-review",
	),
	severity: oneOf("pause", "block"),
	message: text,
	evidenceKey: text,
});
const readiness = shape({
	ok: boolean,
	inferentialClaimsAllowed: boolean,
	gates: array(gate),
	warnings: strings,
});
const causalId: Check = (value) => text(value) && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value as string);
const lineageShape = shape(
	{ schemaVersion: oneOf(1), eventId: causalId },
	{ causationId: causalId, runAttemptId: causalId },
);
const lineage: Check = (value) =>
	lineageShape(value) &&
	(value as Record<string, unknown>).eventId !== (value as Record<string, unknown>).causationId;
const artifact = shape(
	{
		artifactId: text,
		versionId: text,
		path: text,
		sha256: text,
		bytes: finite,
		role: oneOf("input", "output", "review"),
		parentVersionIds: strings,
	},
	{ accessLevel: oneOf("public", "restricted", "private"), producedByJobId: text },
);
const executionContext = shape({
	schemaVersion: oneOf(1),
	revision: text,
	observedAt: text,
	source: oneOf("runner", "host", "replay"),
	values: dictionary((value) => value === null || text(value) || boolean(value) || finite(value)),
});
const provenance = shape(
	{
		adapter: identity,
		workflow: identity,
		method: identity,
		specSha256: text,
		artifacts: array(artifact),
		reproducibility: shape(
			{ status: oneOf("not-assessed", "recorded", "verified", "failed"), detail: text },
			{ environmentFingerprint: text, checkpointId: text },
		),
	},
	{ adapterSnapshotSha256: text, toolContractSha256: text, executionContext, lineage },
);
const review = shape(
	{ approved: boolean, detail: text, limitations: strings },
	{
		reportPath: text,
		checks: array(shape({ id: text, passed: boolean, detail: text })),
		modelStatus: oneOf("approved", "rejected", "unavailable"),
	},
);
const event = shape(
	{
		type: oneOf(
			"created",
			"design-recorded",
			"readiness-assessed",
			"execution-approved",
			"execution-finished",
			"review-finished",
			"delivered",
			"paused",
			"resumed",
		),
		at: text,
	},
	{ detail: text },
);
const context = shape(
	{
		version: oneOf(1),
		id: text,
		question: text,
		assay: text,
		mode: oneOf("exploratory", "inferential"),
		stage: stages,
		status: oneOf("active", "paused", "blocked", "completed"),
		capabilities: array(capability),
		readiness: (value) => value === null || readiness(value),
		publicationRequested: boolean,
		events: array(event),
	},
	{
		adapter: identity,
		branchOf: shape({ analysisId: text, checkpointId: text, workspace: text }),
		review,
		provenance,
	},
);
const binding = shape(
	{
		jobId: text,
		specSha256: text,
		adapter: identity,
		workflow: identity,
		method: identity,
		adapterSnapshotSha256: text,
		toolContractSha256: text,
		requiredOutputs: strings,
		inputs: array(artifact),
	},
	{ executionContext, lineage },
);
const ledger = shape({ version: oneOf(1), runs: dictionary(context) }, { bindings: dictionary(binding) });

export function assertAnalysisLifecycleLedger(value: unknown): asserts value is AnalysisLifecycleLedger {
	if (!ledger(value)) throw new Error("Analysis lifecycle record must match the exact v1 JSON shape");
	const record = value as AnalysisLifecycleLedger;
	if (Object.entries(record.runs).some(([key, run]) => key !== run.id))
		throw new Error("Analysis lifecycle run key must match its id");
	if (record.bindings && Object.keys(record.bindings).some((key) => !Object.hasOwn(record.runs, key)))
		throw new Error("Analysis lifecycle binding must belong to a run");
}

export function assertAnalysisLifecycleResultShape(value: unknown): asserts value is AnalysisLifecycleResult {
	if (!shape({ record: ledger, events: array(event) })(value))
		throw new Error("Analysis lifecycle result must contain only a v1 record and event array");
	assertAnalysisLifecycleLedger((value as AnalysisLifecycleResult).record);
}
