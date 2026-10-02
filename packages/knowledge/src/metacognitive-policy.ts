/**
 * Deterministic publication checks for host-observed research claims.
 *
 * The host supplies this snapshot; the policy never executes a workflow or
 * infers scientific truth. It only compares the final draft with bounded,
 * current receipts and returns actionable, redacted diffs. A finding that
 * passes these structural checks is citable evidence of what was observed,
 * never a claim that the underlying science is true.
 */

export type MetacognitiveLabel = "exploratory" | "validation" | "validated" | "overturned" | "unstable";
export type MetacognitiveUseRole = "evidence" | "exploratory" | "validation" | "conclusion";

export interface MetacognitiveArtifactNumber {
	value: number | string;
	tolerance?: number;
}

export interface MetacognitiveArtifact {
	path: string;
	/** Hash recorded when the artifact was cited. */
	sha256?: string;
	/** Hash observed immediately before publication. */
	currentSha256?: string;
	/** Optional bounded text/number index supplied by the host. */
	text?: string;
	numbers?: readonly MetacognitiveArtifactNumber[];
}

export interface MetacognitiveNumberClaim {
	id?: string;
	value: number | string;
	/** Exact representation expected in the final answer (supports rounding). */
	rendered?: string;
	artifactPath: string;
	rounding?: { digits?: number; tolerance?: number };
}

export interface MetacognitiveExecutedWorkflow {
	workflows?: readonly string[];
	modules?: readonly string[];
	params?: Readonly<Record<string, unknown>>;
}

export interface MetacognitiveMethodClaim {
	id?: string;
	/** A bounded method sentence from the final answer. */
	description: string;
	workflow?: string;
	modules?: readonly string[];
	params?: Readonly<Record<string, unknown>>;
}

export interface MetacognitiveFinding {
	id: string;
	text: string;
	label: MetacognitiveLabel;
	citationPaths?: readonly string[];
}

export interface MetacognitiveFindingUse {
	findingId: string;
	role: MetacognitiveUseRole;
}

export interface MetacognitiveDiagnostic {
	id: string;
	reported: unknown;
	observed: unknown;
}

export interface MetacognitiveSnapshot {
	/** A host may turn this off for operational/setup turns. */
	enabled?: boolean;
	artifacts?: readonly MetacognitiveArtifact[];
	numbers?: readonly MetacognitiveNumberClaim[];
	executed?: MetacognitiveExecutedWorkflow;
	methods?: readonly MetacognitiveMethodClaim[];
	findings?: readonly MetacognitiveFinding[];
	uses?: readonly MetacognitiveFindingUse[];
	diagnostics?: readonly MetacognitiveDiagnostic[];
}

export type MetacognitiveFailureCode =
	| "report-number-unbound"
	| "artifact-checksum-stale"
	| "method-mismatch"
	| "finding-label-conflict"
	| "diagnostic-drift"
	| "metacognition-invalid";

export interface MetacognitiveFailure {
	code: MetacognitiveFailureCode;
	subject: string;
	detail: string;
	path?: string;
}

export interface MetacognitiveEvidenceFinding {
	id: string;
	text: string;
	label: MetacognitiveLabel;
	citationPaths: string[];
}

export interface MetacognitiveEvaluation {
	ok: boolean;
	failures: MetacognitiveFailure[];
	/** Finding records are copied into the publication proof for citation. */
	findings: MetacognitiveEvidenceFinding[];
}

const MAX_FAILURES = 16;
const MAX_TEXT = 600;
const SHA256 = /^[a-f0-9]{64}$/i;

function bounded(value: unknown, max = MAX_TEXT): string {
	const text = typeof value === "string" ? value : JSON.stringify(value);
	return String(text ?? "").replace(/[\r\n]+/g, " ").slice(0, max);
}

function sameValue(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) return true;
	if (typeof left === "number" && typeof right === "number" && Number.isFinite(left) && Number.isFinite(right))
		return left === right;
	try {
		return JSON.stringify(left) === JSON.stringify(right);
	} catch {
		return false;
	}
}

function hasKey(value: object, key: string): boolean {
	return Object.hasOwn(value, key);
}

function subset(expected: Readonly<Record<string, unknown>> | undefined, observed: Readonly<Record<string, unknown>> | undefined): string[] {
	if (!expected) return [];
	if (!observed) return Object.keys(expected);
	return Object.keys(expected).filter((key) => !hasKey(observed, key) || !sameValue(expected[key], observed[key]));
}

function numberValue(value: number | string): number | null {
	if (typeof value === "number") return Number.isFinite(value) ? value : null;
	const parsed = Number(value);
	return Number.isFinite(parsed) && value.trim() !== "" ? parsed : null;
}

function numberMatches(expected: number | string, observed: number | string, tolerance = 0): boolean {
	const left = numberValue(expected);
	const right = numberValue(observed);
	if (left !== null && right !== null) return Math.abs(left - right) <= Math.max(0, tolerance);
	return String(expected).trim() === String(observed).trim();
}

function artifactHasNumber(artifact: MetacognitiveArtifact, claim: MetacognitiveNumberClaim): boolean {
	const tolerance =
		claim.rounding?.tolerance ??
		(typeof claim.rounding?.digits === "number" && claim.rounding.digits >= 0 ? 0.5 * 10 ** -claim.rounding.digits : 0);
	if (artifact.numbers?.some((item) => numberMatches(claim.value, item.value, item.tolerance ?? tolerance))) return true;
	if (typeof artifact.text !== "string") return false;
	const rendered = claim.rendered ?? String(claim.value);
	if (artifact.text.includes(rendered)) return true;
	return artifact.text.includes(String(claim.value));
}

function citedPaths(answer: string): Set<string> {
	return new Set(
		Array.from(answer.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g), (match) => {
			const path = (match[1] || "").trim();
			return path.endsWith(".md") ? path : `${path}.md`;
		}),
	);
}

function addFailure(failures: MetacognitiveFailure[], failure: MetacognitiveFailure): void {
	if (failures.length < MAX_FAILURES) failures.push(failure);
}

/** Compare a final answer with host-observed reports, workflows and findings. */
export function evaluateMetacognitivePublication(
	answer: string,
	snapshot: unknown,
): MetacognitiveEvaluation {
	if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
		return { ok: true, failures: [], findings: [] };
	const input = snapshot as MetacognitiveSnapshot;
	if (input.enabled === false) return { ok: true, failures: [], findings: [] };
	const failures: MetacognitiveFailure[] = [];
	const citations = citedPaths(answer);
	const artifacts = new Map<string, MetacognitiveArtifact>();
	for (const artifact of Array.isArray(input.artifacts) ? input.artifacts : []) {
		if (artifact && typeof artifact.path === "string") artifacts.set(artifact.path, artifact);
	}
	const checkedPaths = new Set<string>();
	const checkArtifact = (path: string, subject: string): MetacognitiveArtifact | undefined => {
		const artifact = artifacts.get(path);
		if (!artifact) {
			addFailure(failures, {
				code: "artifact-checksum-stale",
				subject,
				detail: `No current checksum receipt for ${bounded(path, 240)}`,
				path,
			});
			return undefined;
		}
		if (!SHA256.test(String(artifact.sha256 || "")) || !SHA256.test(String(artifact.currentSha256 || ""))) {
			addFailure(failures, {
				code: "artifact-checksum-stale",
				subject,
				detail: `Missing or malformed checksum receipt for ${bounded(path, 240)}`,
				path,
			});
		} else if (artifact.sha256?.toLowerCase() !== artifact.currentSha256?.toLowerCase()) {
			addFailure(failures, {
				code: "artifact-checksum-stale",
				subject,
				detail: `Cited artifact changed after observation (${bounded(artifact.sha256, 16)}… → ${bounded(artifact.currentSha256, 16)}…)`,
				path,
			});
		}
		checkedPaths.add(path);
		return artifact;
	};

	for (const claim of Array.isArray(input.numbers) ? input.numbers : []) {
		if (!claim || typeof claim.artifactPath !== "string") {
			addFailure(failures, {
				code: "metacognition-invalid",
				subject: "report-number",
				detail: "A report number has no cited artifact path",
			});
			continue;
		}
		const rendered = claim.rendered ?? String(claim.value);
		if (!answer.includes(rendered)) {
			addFailure(failures, {
				code: "report-number-unbound",
				subject: claim.id || rendered,
				detail: `Reported number ${bounded(rendered, 80)} is not present in the final answer`,
				path: claim.artifactPath,
			});
		}
		if (!citations.has(claim.artifactPath)) {
			addFailure(failures, {
				code: "report-number-unbound",
				subject: claim.id || rendered,
				detail: `Reported number ${bounded(rendered, 80)} is not tied to citation ${bounded(claim.artifactPath, 240)}`,
				path: claim.artifactPath,
			});
		}
		const artifact = checkArtifact(claim.artifactPath, claim.id || rendered);
		if (artifact && !artifactHasNumber(artifact, claim))
			addFailure(failures, {
				code: "report-number-unbound",
				subject: claim.id || rendered,
				detail: `Artifact does not contain ${bounded(String(claim.value), 80)} with the declared rounding`,
				path: claim.artifactPath,
			});
	}

	for (const path of citations) {
		// Only snapshots explicitly provided by the host participate in the new gate.
		if (artifacts.has(path) && !checkedPaths.has(path)) checkArtifact(path, "citation");
	}

	for (const method of Array.isArray(input.methods) ? input.methods : []) {
		const executed = input.executed;
		if (!method || typeof method.description !== "string" || !method.description.trim()) {
			addFailure(failures, { code: "metacognition-invalid", subject: "method", detail: "Method description is empty" });
			continue;
		}
		if (!answer.includes(method.description))
			addFailure(failures, {
				code: "method-mismatch",
				subject: method.id || method.description,
				detail: "Method description is not present in the final answer",
			});
		if (!executed) {
			addFailure(failures, {
				code: "method-mismatch",
				subject: method.id || method.description,
				detail: "No host-observed workflow execution was supplied",
			});
			continue;
		}
		if (method.workflow && !executed.workflows?.includes(method.workflow))
			addFailure(failures, {
				code: "method-mismatch",
				subject: method.id || method.workflow,
				detail: `Workflow ${bounded(method.workflow, 120)} was not observed`,
			});
		for (const module of method.modules || [])
			if (!executed.modules?.includes(module))
				addFailure(failures, {
					code: "method-mismatch",
					subject: method.id || module,
					detail: `Module ${bounded(module, 120)} was not observed`,
				});
		for (const key of subset(method.params, executed.params))
			addFailure(failures, {
				code: "method-mismatch",
				subject: method.id || key,
				detail: `Parameter ${bounded(key, 120)} differs from the observed workflow`,
			});
	}

	const findingMap = new Map<string, MetacognitiveFinding>();
	const findingEvidence: MetacognitiveEvidenceFinding[] = [];
	for (const rawFinding of Array.isArray(input.findings) ? input.findings : []) {
		const finding = rawFinding as MetacognitiveFinding;
		if (!finding || typeof finding.id !== "string" || typeof finding.text !== "string") {
			addFailure(failures, { code: "metacognition-invalid", subject: "finding", detail: "Finding is malformed" });
			continue;
		}
		findingMap.set(finding.id, finding);
		const paths: string[] = Array.from(
			new Set(
				(Array.isArray(finding.citationPaths) ? finding.citationPaths : ([] as unknown[])).filter(
					(path): path is string => typeof path === "string",
				),
			),
		);
		findingEvidence.push({ id: finding.id, text: bounded(finding.text), label: finding.label, citationPaths: paths });
		for (const path of paths) {
			if (!citations.has(path))
				addFailure(failures, {
					code: "finding-label-conflict",
					subject: finding.id,
					detail: `Finding is missing its cited artifact ${bounded(path, 240)}`,
					path,
				});
			else checkArtifact(path, finding.id);
		}
	}
	for (const use of Array.isArray(input.uses) ? input.uses : []) {
		const finding = findingMap.get(use?.findingId || "");
		if (!finding) {
			addFailure(failures, {
				code: "finding-label-conflict",
				subject: use?.findingId || "finding",
				detail: "The final answer references an unknown finding",
			});
			continue;
		}
		if (["exploratory", "overturned", "unstable"].includes(finding.label)) {
			const invalidRole =
				finding.label === "exploratory"
					? ["conclusion", "validation"].includes(use.role)
					: use.role !== "exploratory";
			if (invalidRole)
				addFailure(failures, {
					code: "finding-label-conflict",
					subject: finding.id,
					detail: `Finding labelled ${finding.label} cannot be used as ${use.role}`,
				});
		}
	}

	for (const diagnostic of Array.isArray(input.diagnostics) ? input.diagnostics : []) {
		if (!diagnostic || typeof diagnostic.id !== "string" || !sameValue(diagnostic.reported, diagnostic.observed))
			addFailure(failures, {
				code: "diagnostic-drift",
				subject: diagnostic?.id || "diagnostic",
				detail: `Reported diagnostic differs from the observed control/result (${bounded(diagnostic?.reported)} vs ${bounded(diagnostic?.observed)})`,
			});
	}

	return { ok: failures.length === 0, failures, findings: findingEvidence };
}
