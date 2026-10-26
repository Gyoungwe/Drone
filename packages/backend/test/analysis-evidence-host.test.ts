import { describe, expect, it, vi } from "vitest";
import {
	ANALYSIS_PREPARE_EVIDENCE_TOOL,
	type AnalysisEvidencePluginHost,
	EVIDENCE_VALIDATE_MANIFEST_TOOL,
	prepareAnalysisEvidence,
} from "../src/services/analysis-evidence-host";

const analysis = {
	version: 1,
	id: "analysis-1",
	question: "Check evidence",
	assay: "assembly",
	mode: "exploratory",
	stage: "review",
	status: "active",
} as never;
const manifest = {
	version: 1,
	entries: [
		{
			artifactId: "artifact-1",
			versionId: "version-1",
			path: "result.txt",
			sha256: "a".repeat(64),
			bytes: 2,
			role: "output",
			parentVersionIds: [],
		},
	],
};

function host(
	prepare: (input: unknown) => unknown,
	validate: (input: unknown) => unknown,
	tools = [ANALYSIS_PREPARE_EVIDENCE_TOOL, EVIDENCE_VALIDATE_MANIFEST_TOOL],
): AnalysisEvidencePluginHost {
	return {
		manifest: { tools },
		tools: {
			[ANALYSIS_PREPARE_EVIDENCE_TOOL]: { execute: vi.fn(prepare) },
			[EVIDENCE_VALIDATE_MANIFEST_TOOL]: { execute: vi.fn(validate) },
		},
	};
}

describe("analysis/evidence host composition", () => {
	it("reports unavailable when the optional plugin host is absent or undeclared", async () => {
		await expect(prepareAnalysisEvidence(undefined, { analysis, manifest })).resolves.toMatchObject({
			status: "unavailable",
			execution: "host-required",
		});
		await expect(
			prepareAnalysisEvidence(
				host(
					() => ({}),
					() => ({ valid: true }),
					[EVIDENCE_VALIDATE_MANIFEST_TOOL],
				),
				{
					analysis,
					manifest,
				},
			),
		).resolves.toMatchObject({
			status: "unavailable",
			reason: expect.stringContaining("analysis_prepare_evidence"),
		});
	});

	it("invokes only declared read-only tools and returns a stable receipt", async () => {
		const prepare = vi.fn(() => ({ details: { execution: "host-required", planVersion: 1 } }));
		const validate = vi.fn(() => ({ details: { valid: true, entries: 1 } }));
		const plugin = host(prepare, validate);
		const first = await prepareAnalysisEvidence(plugin, {
			analysis,
			manifest,
			request: { purpose: "review" },
		});
		const second = await prepareAnalysisEvidence(plugin, {
			analysis,
			manifest,
			request: { purpose: "review" },
		});
		expect(first).toEqual(second);
		expect(first).toMatchObject({
			status: "ready",
			plan: { execution: "host-required" },
			validation: { valid: true },
		});
		expect(first.receiptSha256).toMatch(/^[a-f0-9]{64}$/);
		expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ analysis, manifest }));
		expect(validate).toHaveBeenCalledWith({ manifest });
	});

	it("never reports ready for a non-host plan or an invalid validator result", async () => {
		await expect(
			prepareAnalysisEvidence(
				host(
					() => ({ execution: "local" }),
					() => ({ valid: true }),
				),
				{ analysis, manifest },
			),
		).resolves.toMatchObject({ status: "invalid", reason: expect.stringContaining("host-required") });
		await expect(
			prepareAnalysisEvidence(
				host(
					() => ({ execution: "host-required" }),
					() => ({ valid: false, errors: ["bad"] }),
				),
				{
					analysis,
					manifest,
				},
			),
		).resolves.toMatchObject({ status: "invalid", validation: { valid: false } });
	});
});
