import { describe, expect, it } from "vitest";
import { evaluateMetacognitivePublication } from "../src/metacognitive-policy";

const HASH = "a".repeat(64);
const artifact = (path = "Runs/run-1/report.md", text = "n=12.3") => ({
	path,
	sha256: HASH,
	currentSha256: HASH,
	text,
	numbers: [{ value: 12.3 }],
});

describe("metacognitive publication policy", () => {
	it("accepts a rounded report number tied to a current cited artifact", () => {
		const result = evaluateMetacognitivePublication("Result: 12.3 [[Runs/run-1/report]]", {
			numbers: [{ value: 12.3, rendered: "12.3", artifactPath: "Runs/run-1/report.md" }],
			artifacts: [artifact()],
		});
		expect(result).toMatchObject({ ok: true, failures: [] });
	});

	it("blocks a number that is absent from the cited artifact", () => {
		const result = evaluateMetacognitivePublication("Result: 13.0 [[Runs/run-1/report]]", {
			numbers: [{ value: 13, rendered: "13.0", artifactPath: "Runs/run-1/report.md" }],
			artifacts: [artifact()],
		});
		expect(result.ok).toBe(false);
		expect(result.failures.some((item) => item.code === "report-number-unbound")).toBe(true);
	});

	it("fails closed when a cited artifact is pending review", () => {
		const result = evaluateMetacognitivePublication("Result: 12.3 [[Runs/run-1/report]]", {
			numbers: [{ value: 12.3, rendered: "12.3", artifactPath: "Runs/run-1/report.md" }],
			artifacts: [{ ...artifact(), status: "pending-review" }],
		});
		expect(result.ok).toBe(false);
		expect(result.failures[0]).toMatchObject({ code: "artifact-pending-review" });
	});

	it("ignores pending artifacts that are not referenced by this publication", () => {
		const result = evaluateMetacognitivePublication("A clean answer [[Runs/run-1/report]]", {
			artifacts: [artifact(), { ...artifact("Runs/run-2/unused.md"), status: "pending-review" }],
		});
		expect(result).toMatchObject({ ok: true, failures: [] });
	});

	it("allows a cited artifact after user confirmation restores valid status", () => {
		const result = evaluateMetacognitivePublication("Confirmed output [[Runs/run-1/report]]", {
			artifacts: [
				{
					...artifact(),
					status: "valid",
					reviews: [
						{ decisionId: "decision-1", confirmedBy: "user", confirmedAt: "2026-01-02T00:00:00.000Z" },
					],
				},
			],
		});
		expect(result).toMatchObject({ ok: true, failures: [] });
	});

	it("blocks stale checksums, method drift and diagnostic drift together", () => {
		const result = evaluateMetacognitivePublication("Used wrong method [[Runs/run-1/report]]", {
			artifacts: [{ ...artifact(), currentSha256: "b".repeat(64) }],
			methods: [
				{ description: "Used wrong method", workflow: "rnaseq", modules: ["salmon"], params: { reads: 2 } },
			],
			executed: { workflows: ["chipseq"], modules: ["macs"], params: { reads: 1 } },
			diagnostics: [{ id: "control", reported: "enabled", observed: "disabled" }],
		});
		expect(result.ok).toBe(false);
		expect(result.failures.map((item) => item.code)).toEqual(
			expect.arrayContaining(["artifact-checksum-stale", "method-mismatch", "diagnostic-drift"]),
		);
	});

	it("does not let exploratory or overturned findings support conclusions", () => {
		const result = evaluateMetacognitivePublication("Conclusion: candidate signal [[Runs/run-1/report]]", {
			artifacts: [artifact()],
			findings: [
				{ id: "f1", text: "candidate signal", label: "exploratory", citationPaths: ["Runs/run-1/report.md"] },
				{ id: "f2", text: "old signal", label: "overturned", citationPaths: ["Runs/run-1/report.md"] },
			],
			uses: [
				{ findingId: "f1", role: "conclusion" },
				{ findingId: "f2", role: "evidence" },
			],
		});
		expect(result.ok).toBe(false);
		expect(result.failures.filter((item) => item.code === "finding-label-conflict")).toHaveLength(2);
	});

	it("returns finding records as citable evidence", () => {
		const result = evaluateMetacognitivePublication("A note [[Runs/run-1/report]]", {
			artifacts: [artifact()],
			findings: [{ id: "f1", text: "A note", label: "validation", citationPaths: ["Runs/run-1/report.md"] }],
		});
		expect(result.ok).toBe(true);
		expect(result.findings).toEqual([
			{ id: "f1", text: "A note", label: "validation", citationPaths: ["Runs/run-1/report.md"] },
		]);
	});
});
