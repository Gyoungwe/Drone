import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	analysisPlanHash,
	createComputeAuthorization,
	type JobRecord,
	registerDatasetVersion,
	sampleSheetSchemaHash,
} from "@drone/compute";
import type { ComputeAnalysisPlan, ComputeSampleSheet } from "@drone/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillVisibility } from "../src/capabilities/resource-loader";
import { CapabilityRuntime } from "../src/capabilities/runtime";
import { JsonStore } from "../src/json-store";
import { AnalysisOrchestrationService, emptyAnalysisLedger } from "../src/services/analysis-orchestration";
import {
	type AnalysisResultReviewer,
	AnalysisTaskController,
	AnalysisTaskGateError,
} from "../src/services/analysis-task-controller";
import { ComputePreflightError, type ComputePreflightJobSpec } from "../src/services/compute-preflight";

const evidence = {
	method: { id: "DESeq2/fixed-dispersion-diagnostic", version: "1.48.2" },
	contrastResolved: true,
	referenceResolved: true,
	groupColumn: "condition",
	biologicalUnitColumn: "biologicalUnit",
};
const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function specification(technicalReplicates = false): ComputePreflightJobSpec {
	const sampleSheet: ComputeSampleSheet = {
		id: "pasilla-samples",
		version: 1,
		idColumn: "sample",
		columns: [
			{ name: "sample", type: "string", required: true, unique: true },
			{ name: "condition", type: "string", required: true },
			{ name: "biologicalUnit", type: "string", required: true },
		],
	};
	const rows = [
		{ sample: "GSM461177", condition: "untreated", biologicalUnit: "GSM461177" },
		{ sample: "GSM461180", condition: "treated", biologicalUnit: "GSM461180" },
	];
	if (technicalReplicates) rows.push(...rows.map((row) => ({ ...row, sample: `${row.sample}-lane2` })));
	const dataset = registerDatasetVersion({
		datasetId: "pasilla-unit-test",
		files: [{ path: "counts.tsv", bytes: 10, sha256: "a".repeat(64) }],
	});
	const analysisPlan: ComputeAnalysisPlan = {
		id: "pasilla-plan",
		version: 1,
		design: "two-group",
		outcome: "DESeq2 output-path smoke only",
		primaryTest: "DESeq2 fixed-dispersion diagnostic",
		alpha: 0.05,
		targetPower: 0.8,
		effectSize: 1,
		totalSampleSize: 2,
		groups: ["untreated", "treated"],
	};
	const contract = {
		datasetVersion: { datasetId: dataset.datasetId, versionId: dataset.versionId },
		sampleSheetSchemaId: sampleSheet.id,
		sampleSheetSha256: sampleSheetSchemaHash(sampleSheet),
		analysisPlanId: analysisPlan.id,
		analysisPlanSha256: analysisPlanHash(analysisPlan),
	};
	return {
		jobId: "pasilla-job",
		hostAlias: "test-host",
		workflow: { name: "drone/pasilla-deseq2", version: "1" },
		outputs: ["deseq2/summary.md", "deseq2/results.tsv"],
		dataDesign: { dataset, rows, sampleSheet, analysisPlan, contract },
		authorization: createComputeAuthorization({
			approved: true,
			hosts: ["test-host"],
			workflows: ["drone/pasilla-deseq2"],
			remoteRead: [],
			remoteWrite: [],
			budget: { maxCoreHours: 1, maxWalltimeMinutes: 30, maxConcurrentJobs: 1, maxDiskGb: 1 },
			dataDesign: contract,
		}),
	};
}

async function setup(mode: "exploratory" | "inferential" = "exploratory", reviewer?: AnalysisResultReviewer) {
	const root = await mkdtemp(join(tmpdir(), "drone-analysis-controller-"));
	roots.push(root);
	const open = () =>
		new AnalysisOrchestrationService({
			store: new JsonStore({
				path: join(root, "runs.json"),
				storageId: "analysis-test",
				defaultValue: emptyAnalysisLedger,
			}),
		});
	const analysis = open();
	const runtime = new CapabilityRuntime(new SkillVisibility());
	const activate = vi.spyOn(runtime, "activate");
	const spec = specification();
	const job: JobRecord = {
		jobId: spec.jobId,
		hostAlias: spec.hostAlias,
		spec,
		status: "queued",
		createdAt: 1,
		updatedAt: 1,
	};
	const compute = {
		submit: vi.fn(async () => job),
		status: vi.fn(async () => job),
		collect: vi.fn(async (_jobId: string, options: { targetDir: string; expected?: readonly string[] }) => {
			const { mkdir, writeFile } = await import("node:fs/promises");
			await mkdir(join(options.targetDir, "deseq2"), { recursive: true });
			await writeFile(join(options.targetDir, "deseq2/summary.md"), "Pasilla exploratory summary\n");
			await writeFile(join(options.targetDir, "deseq2/results.tsv"), "gene\tlog2FoldChange\nalpha\t0.1\n");
			return {
				manifest: {
					version: 1 as const,
					entries: [
						{
							path: "deseq2/summary.md",
							bytes: Buffer.byteLength("Pasilla exploratory summary\n"),
							sha256: createHash("sha256").update("Pasilla exploratory summary\n").digest("hex"),
						},
						{
							path: "deseq2/results.tsv",
							bytes: Buffer.byteLength("gene\tlog2FoldChange\nalpha\t0.1\n"),
							sha256: createHash("sha256").update("gene\tlog2FoldChange\nalpha\t0.1\n").digest("hex"),
						},
					],
				},
			};
		}),
	};
	const controller = new AnalysisTaskController({
		analysis,
		compute,
		capabilityRuntime: runtime,
		...(reviewer ? { reviewer } : {}),
	});
	await controller.create({ id: "pasilla", question: "Pasilla DESeq2 workflow", assay: "bulk-rnaseq", mode });
	await controller.recordDesign("pasilla");
	return { controller, analysis, open, runtime, activate, compute, spec, job };
}

describe("NGS analysis task controller", () => {
	it("loads stage capabilities and completes only after observed success and review", async () => {
		const { controller, analysis, activate, compute, spec, job } = await setup();
		const ready = await controller.prepareCompute("pasilla", spec, evidence);
		expect(ready.readiness).toMatchObject({ ok: true, inferentialClaimsAllowed: false });
		expect(ready.readiness?.warnings.join(" ")).toContain("n=1");
		await controller.approveExecution("pasilla");
		await controller.submitCompute("pasilla", spec);
		expect(compute.submit).toHaveBeenCalledOnce();
		expect((await controller.reconcile("pasilla")).stage).toBe("execution");
		compute.status.mockResolvedValue({ ...job, status: "succeeded" });
		expect((await controller.reconcile("pasilla")).stage).toBe("review");
		await controller.finishReview("pasilla", { outputsVerified: true });
		await controller.complete("pasilla");
		expect(await analysis.get("pasilla")).toMatchObject({
			status: "completed",
			readiness: { inferentialClaimsAllowed: false },
		});
		expect(activate.mock.calls.map(([packs]) => packs)).toEqual(
			expect.arrayContaining([
				["analysis", "files"],
				["analysis", "planning", "files"],
				["analysis", "files", "coding"],
				["analysis", "visualization", "literature"],
				["writing", "visualization"],
			]),
		);
	});
	it("runs model review, preserves replicate limitations, and completes delivery", async () => {
		const reviewer = vi.fn(async (request: { limitations: readonly string[] }) => ({
			approved: true,
			detail: "reviewed",
			reportMarkdown: `Takeaway: Exploratory Pasilla output path reviewed.\n\nThe output is operationally complete, but the comparison lacks biological replication. ${request.limitations.join(" ")}`,
		}));
		const { controller, compute, spec, analysis } = await setup("exploratory", reviewer);
		await controller.prepareCompute("pasilla", spec, evidence);
		await controller.approveExecution("pasilla");
		await controller.submitCompute("pasilla", spec);
		compute.status.mockResolvedValue({
			jobId: spec.jobId,
			hostAlias: spec.hostAlias,
			spec,
			status: "succeeded",
			createdAt: 1,
			updatedAt: 1,
		});
		await controller.reconcile("pasilla");
		const result = await controller.reviewAndDeliver("pasilla", {
			targetDir: roots[0],
			expected: ["deseq2/summary.md"],
		});
		expect(result.context).toMatchObject({ stage: "completed", status: "completed" });
		expect(reviewer).toHaveBeenCalledWith(
			expect.objectContaining({ limitations: [expect.stringContaining("n=1")] }),
		);
		expect((await analysis.get("pasilla"))?.review).toMatchObject({
			approved: true,
			limitations: [expect.stringContaining("n=1")],
		});
	});
	it("blocks inferential n=1 even when technical lanes appear as extra rows", async () => {
		const { controller, compute } = await setup("inferential");
		const spec = specification(true);
		const context = await controller.prepareCompute("pasilla", spec, evidence);
		expect(context.status).toBe("paused");
		expect(context.readiness?.gates.map((gate) => gate.code)).toContain("missing-biological-replicates");
		await expect(controller.approveExecution("pasilla")).rejects.toThrow("gate is closed");
		await expect(controller.submitCompute("pasilla", spec)).rejects.toBeInstanceOf(AnalysisTaskGateError);
		expect(compute.submit).not.toHaveBeenCalled();
	});
	it("persists binding and rejects changed inputs, methods, resources and approval after restart", async () => {
		const { controller, open, runtime, compute, spec } = await setup();
		await controller.prepareCompute("pasilla", spec, evidence);
		await controller.approveExecution("pasilla");
		const restored = new AnalysisTaskController({ analysis: open(), compute, capabilityRuntime: runtime });
		for (const changed of [
			{ ...spec, resources: { cpus: 32 } },
			{ ...spec, workflow: { name: "other", version: "1" } },
			{ ...spec, authorization: undefined },
			{ ...spec, dataDesign: { ...spec.dataDesign!, rows: [] } },
		]) {
			await expect(restored.submitCompute("pasilla", changed)).rejects.toBeInstanceOf(AnalysisTaskGateError);
		}
		expect(compute.submit).not.toHaveBeenCalled();
		await restored.submitCompute("pasilla", spec);
		expect(compute.submit).toHaveBeenCalledOnce();
	});
	it("fails B7 preflight and missing records before submitting or declaring readiness", async () => {
		const { controller, compute, spec, analysis } = await setup();
		await expect(
			controller.prepareCompute("pasilla", { ...spec, dataDesign: undefined }, evidence),
		).rejects.toThrow("data-design");
		await expect(
			controller.prepareCompute(
				"pasilla",
				{ ...spec, authorization: { ...spec.authorization!, approved: false } },
				evidence,
			),
		).rejects.toBeInstanceOf(ComputePreflightError);
		expect((await analysis.get("pasilla"))?.stage).toBe("design");
		expect(compute.submit).not.toHaveBeenCalled();
	});
	it("keeps unknown execution pending and blocks failed execution", async () => {
		const { controller, compute, spec, job } = await setup();
		await controller.prepareCompute("pasilla", spec, evidence);
		await controller.approveExecution("pasilla");
		await controller.submitCompute("pasilla", spec);
		compute.status.mockResolvedValue({ ...job, status: "unknown" });
		expect((await controller.reconcile("pasilla")).stage).toBe("execution");
		compute.status.mockResolvedValue({ ...job, status: "failed" });
		expect((await controller.reconcile("pasilla")).status).toBe("blocked");
		await expect(controller.complete("pasilla")).rejects.toThrow("review");
	});
});
