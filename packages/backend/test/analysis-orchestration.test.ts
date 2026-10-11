import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JsonStore } from "../src/json-store";
import { AnalysisOrchestrationService, emptyAnalysisLedger } from "../src/services/analysis-orchestration";

const readiness = {
	mode: "inferential" as const,
	assay: "bulk-rnaseq",
	assessment: { ok: true, inferentialClaimsAllowed: true, gates: [], warnings: [] },
	computeAuthorized: true,
};

describe("durable analysis orchestration service", () => {
	it("persists snapshots and reopens them without weakening gates", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-analysis-"));
		try {
			const store = new JsonStore({
				path: join(root, "analysis.json"),
				storageId: "test-analysis",
				defaultValue: emptyAnalysisLedger,
			});
			const service = new AnalysisOrchestrationService({ store });
			await service.create({
				id: "pasilla",
				question: "Compare groups",
				assay: "bulk-rnaseq",
				mode: "inferential",
			});
			await service.recordDesign("pasilla");
			const paused = await service.assessReadiness("pasilla", {
				...readiness,
				assessment: {
					ok: false,
					inferentialClaimsAllowed: false,
					gates: [
						{ code: "missing-data", severity: "pause", message: "Input unavailable", evidenceKey: "input" },
					],
					warnings: [],
				},
			});
			expect(paused.status).toBe("paused");
			const reopened = new AnalysisOrchestrationService({
				store: new JsonStore({
					path: join(root, "analysis.json"),
					storageId: "test-analysis",
					defaultValue: emptyAnalysisLedger,
				}),
			});
			expect(await reopened.get("pasilla")).toMatchObject({ status: "paused", stage: "readiness" });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
