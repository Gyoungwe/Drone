import { evaluateMetacognitivePublication } from "@drone/knowledge/metacognitive-policy";
import { registerAnswerPublication } from "@drone/knowledge/publication";
import { AnalysisOrchestrator, assessAnalysisReadiness } from "@drone/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * REDLINE-01 is intentionally an isolated, deterministic acceptance fixture.
 * It exercises the same publication and analysis gates used by the host while
 * keeping user Vaults, sessions, credentials and external services out of the
 * report. Each case returns a sealed proof that can be attached to a run audit.
 */

const ANSWER = "UNVERIFIED_REDLINE_ANSWER";

function publicationHarness({ validate, metacognition } = {}) {
	const events = new Map();
	const gate = registerAnswerPublication(
		{ on: (name, handler) => events.set(name, handler) },
		{
			getCurrent: () => ({
				service: {
					validateAnswer:
						validate || (async () => ({ status: "ready", sources: [], scientificallyVerified: false })),
				},
				ticket: "redline-fixture",
			}),
			...(metacognition ? { getMetacognition: async () => metacognition } : {}),
		},
	);
	gate.begin(true);
	return async (message = {}) =>
		(
			await events.get("message_end")(
				{
					message: {
						role: "assistant",
						content: [{ type: "text", text: ANSWER }],
						timestamp: 1,
						stopReason: "stop",
						...message,
					},
				},
				{ cwd: "/redline-fixture" },
			)
		).message;
}

function redlineAudit(caseId, proof) {
	return {
		caseId,
		status: proof?.knowledgePublication?.status || proof?.status || "unknown",
		reason: proof?.knowledgePublication?.reason || null,
		proofId: proof?.knowledgePublication?.id || null,
		paths: proof?.knowledgePublication?.paths || [],
		metacognition: proof?.knowledgePublication?.metacognition || null,
	};
}

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("REDLINE-01 isolated acceptance", () => {
	it("blocks missing-source and stale-source publication with bounded evidence paths", async () => {
		vi.stubEnv("DRONE_KNOWLEDGE_DIR", "/redline-fixture/knowledge");
		vi.stubEnv("DRONE_REVIEW_MODE", "strict");
		const missing = publicationHarness({
			validate: async () => {
				throw Object.assign(new Error("source was not read"), {
					code: "source-unread",
					paths: ["Library/Papers/missing.md"],
					verified: { sources: [], unverifiedCitations: ["Library/Papers/missing.md"] },
				});
			},
		});
		const missingMessage = await missing();
		const missingAudit = redlineAudit("missing-source", missingMessage);
		expect(missingAudit).toMatchObject({
			caseId: "missing-source",
			status: "blocked",
			reason: "source-unread",
			paths: ["Library/Papers/missing.md"],
		});
		expect(missingAudit.proofId).toMatch(/^[0-9a-f-]{36}$/);
		expect(missingMessage.content[0].text).not.toContain(ANSWER);

		const stale = publicationHarness({
			validate: async () => {
				throw Object.assign(new Error("source changed after read"), {
					code: "source-changed",
					paths: ["Library/Papers/source.md"],
					verified: {
						sources: [{ path: "Library/Papers/source.md", hash: "old" }],
						unverifiedCitations: ["Library/Papers/source.md"],
					},
				});
			},
		});
		const staleMessage = await stale();
		const staleAudit = redlineAudit("stale-source", staleMessage);
		expect(staleAudit).toMatchObject({
			caseId: "stale-source",
			status: "blocked",
			reason: "source-changed",
			paths: ["Library/Papers/source.md"],
		});
		expect(staleAudit.proofId).toMatch(/^[0-9a-f-]{36}$/);
		expect(staleMessage.content[0].text).not.toContain(ANSWER);
	});

	it("blocks numerical tampering and method drift with redacted metacognitive diffs", async () => {
		const artifact = {
			path: "runs/r1/report.tsv",
			sha256: "a".repeat(64),
			currentSha256: "a".repeat(64),
			text: "observed count = 10",
		};
		const numberSnapshot = {
			enabled: true,
			artifacts: [artifact],
			numbers: [{ id: "count", value: 10, rendered: "12", artifactPath: artifact.path }],
		};
		const numberEvaluation = evaluateMetacognitivePublication(
			`The observed count is 12 [[${artifact.path}]].`,
			numberSnapshot,
		);
		expect(numberEvaluation.ok).toBe(false);
		expect(numberEvaluation.failures).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "report-number-unbound", path: artifact.path }),
			]),
		);
		const numberMessage = await publicationHarness({ metacognition: numberSnapshot })({
			content: [{ type: "text", text: `The observed count is 12 [[${artifact.path}]].` }],
		});
		const numberAudit = redlineAudit("number-tamper", numberMessage);
		expect(numberAudit).toMatchObject({
			caseId: "number-tamper",
			status: "blocked",
			reason: "metacognitive-inconsistency",
		});
		expect(numberAudit.metacognition.failures).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "report-number-unbound" })]),
		);
		expect(numberMessage.content[0].text).not.toContain("The observed count is 12");

		const methodSnapshot = {
			enabled: true,
			executed: { workflows: ["rnaseq-v1"], modules: ["salmon"], params: { strandedness: "auto" } },
			methods: [
				{
					id: "method",
					description: "The run used STAR with two-pass alignment.",
					workflow: "rnaseq-v1",
					modules: ["star"],
					params: { strandedness: "reverse" },
				},
			],
		};
		const methodEvaluation = evaluateMetacognitivePublication(
			"The run used STAR with two-pass alignment.",
			methodSnapshot,
		);
		expect(methodEvaluation.ok).toBe(false);
		expect(methodEvaluation.failures).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "method-mismatch" })]),
		);
		const methodMessage = await publicationHarness({ metacognition: methodSnapshot })({
			content: [{ type: "text", text: "The run used STAR with two-pass alignment." }],
		});
		const methodAudit = redlineAudit("method-drift", methodMessage);
		expect(methodAudit).toMatchObject({
			caseId: "method-drift",
			status: "blocked",
			reason: "metacognitive-inconsistency",
		});
		expect(methodAudit.metacognition.failures).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "method-mismatch" })]),
		);
	});

	it("blocks insufficient replicates and pauses execution on authorization refusal", () => {
		const now = () => "2026-10-18T00:00:00.000Z";
		const orchestrator = new AnalysisOrchestrator({ now });
		let context = orchestrator.create({
			id: "redline-replicates",
			question: "Compare treatment groups",
			assay: "bulk-rnaseq",
			mode: "inferential",
		});
		context = orchestrator.recordDesign(context);
		const replicateAssessment = assessAnalysisReadiness({
			mode: "inferential",
			assay: "bulk-rnaseq",
			assessment: {
				ok: false,
				inferentialClaimsAllowed: false,
				gates: [
					{
						code: "missing-biological-replicates",
						severity: "block",
						message: "At least two biological replicates per group are required.",
						evidenceKey: "design.replicates",
					},
				],
				warnings: [],
			},
			computeAuthorized: true,
		});
		expect(replicateAssessment).toMatchObject({ ok: false, inferentialClaimsAllowed: false });
		expect(replicateAssessment.gates).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "missing-biological-replicates", severity: "block" }),
			]),
		);
		context = orchestrator.assessReadiness(context, {
			mode: "inferential",
			assay: "bulk-rnaseq",
			assessment: replicateAssessment,
			computeAuthorized: true,
		});
		expect(context.status).toBe("blocked");
		expect(context.events.at(-1)).toMatchObject({ type: "readiness-assessed", detail: "gated" });
		expect(() => orchestrator.approveExecution(context)).toThrow("readiness gate is closed");

		const authorization = assessAnalysisReadiness({
			mode: "inferential",
			assay: "bulk-rnaseq",
			assessment: { ok: true, inferentialClaimsAllowed: true, gates: [], warnings: [] },
			computeAuthorized: false,
		});
		expect(authorization).toMatchObject({ ok: false, inferentialClaimsAllowed: false });
		expect(authorization.gates).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "compute-authorization-required", severity: "pause" }),
			]),
		);
	});

	it("seals a blocked interruption when the host loses the connection", async () => {
		vi.stubEnv("DRONE_KNOWLEDGE_DIR", "/redline-fixture/knowledge");
		vi.stubEnv("DRONE_REVIEW_MODE", "strict");
		const interrupted = publicationHarness();
		const message = await interrupted({
			stopReason: "aborted",
			errorMessage: "request aborted by transport",
		});
		const audit = redlineAudit("disconnect", message);
		expect(audit).toMatchObject({ caseId: "disconnect", status: "blocked", reason: "interrupted" });
		expect(audit.proofId).toMatch(/^[0-9a-f-]{36}$/);
		expect(message.content[0].text).not.toContain(ANSWER);
	});
});
