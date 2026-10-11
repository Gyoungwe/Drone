import { describe, expect, it } from "vitest";
import {
	AnalysisOrchestrator,
	assessAnalysisReadiness,
	capabilitiesForAnalysisStage,
	capabilityLoadRequest,
} from "./analysis-orchestration";

const adequate = {
	mode: "inferential" as const,
	assay: "bulk-rnaseq",
	assessment: { ok: true, inferentialClaimsAllowed: true, gates: [], warnings: [] },
	computeAuthorized: true,
};

describe("analysis orchestrator", () => {
	it("maps stages to the smallest capability set", () => {
		expect(capabilitiesForAnalysisStage("intake")).toEqual(["analysis", "files"]);
		expect(capabilitiesForAnalysisStage("execution")).toEqual(["analysis", "files", "coding"]);
		expect(capabilitiesForAnalysisStage("delivery")).toEqual([
			"analysis",
			"visualization",
			"writing",
			"literature",
		]);
	});

	it("keeps adapter failures and host authorization independent", () => {
		const assessed = assessAnalysisReadiness({
			...adequate,
			computeAuthorized: false,
			assessment: {
				ok: false,
				inferentialClaimsAllowed: false,
				gates: [{ code: "missing-data", severity: "pause", message: "Input missing", evidenceKey: "input" }],
				warnings: ["Limited evidence"],
			},
		});
		expect(assessed.ok).toBe(false);
		expect(assessed.gates.map((gate) => gate.code)).toEqual([
			"missing-data",
			"compute-authorization-required",
		]);
		expect(assessed.warnings).toEqual(["Limited evidence"]);
	});
	it("requires explicit adapter assessment rather than interpreting scientific fields", () => {
		expect(
			assessAnalysisReadiness({
				...adequate,
				assay: "assembly",
				assessment: { ok: true, inferentialClaimsAllowed: false, gates: [], warnings: [] },
			}).ok,
		).toBe(true);
	});

	it("keeps execution and delivery behind explicit gates", () => {
		const now = () => "2026-10-11T00:00:00.000Z";
		const orchestrator = new AnalysisOrchestrator({ now });
		let context = orchestrator.create({
			id: "pasilla",
			question: "Compare treated and control RNA-seq samples",
			assay: "bulk-rnaseq",
			mode: "inferential",
		});
		context = orchestrator.recordDesign(context);
		expect(context.stage).toBe("design");
		expect(capabilityLoadRequest(context)).toMatchObject({ capabilities: ["analysis", "planning", "files"] });
		context = orchestrator.assessReadiness(context, { ...adequate, publicationRequested: true });
		expect(context.stage).toBe("readiness");
		context = orchestrator.approveExecution(context);
		context = orchestrator.recordExecution(context, { ok: true });
		expect(context.stage).toBe("review");
		context = orchestrator.finishReview(context, { outputsVerified: true });
		context = orchestrator.complete(context, { publicationApproved: false });
		expect(context.status).toBe("paused");
		context = orchestrator.resume(context);
		context = orchestrator.complete(context, { publicationApproved: true });
		expect(context).toMatchObject({ stage: "completed", status: "completed" });
	});
});
