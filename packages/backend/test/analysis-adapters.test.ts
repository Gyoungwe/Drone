import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
import { AnalysisAdapterRegistry, AssemblyAdapter } from "@gyoungwe/pi-analysis/host";
import type { AnalysisAdapter } from "@gyoungwe/plugin-api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillVisibility } from "../src/capabilities/resource-loader";
import { CapabilityRuntime } from "../src/capabilities/runtime";
import { JsonStore } from "../src/json-store";
import { AnalysisOrchestrationService, emptyAnalysisLedger } from "../src/services/analysis-orchestration";
import { AnalysisTaskController } from "../src/services/analysis-task-controller";
import type { ComputePreflightJobSpec } from "../src/services/compute-preflight";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function assemblySpec(): ComputePreflightJobSpec {
	const sampleSheet: ComputeSampleSheet = {
		id: "assembly-inputs",
		version: 1,
		idColumn: "sample",
		columns: [{ name: "sample", type: "string", required: true, unique: true }],
	};
	const rows = [{ sample: "reads-1" }];
	const dataset = registerDatasetVersion({
		datasetId: "assembly-dataset",
		files: [{ path: "reads-1.fastq.gz", bytes: 100, sha256: "a".repeat(64) }],
	});
	const analysisPlan: ComputeAnalysisPlan = {
		id: "assembly-plan",
		version: 1,
		design: "descriptive",
		outcome: "de novo assembly",
		primaryTest: "assembly",
	};
	const contract = {
		datasetVersion: { datasetId: dataset.datasetId, versionId: dataset.versionId },
		sampleSheetSchemaId: sampleSheet.id,
		sampleSheetSha256: sampleSheetSchemaHash(sampleSheet),
		analysisPlanId: analysisPlan.id,
		analysisPlanSha256: analysisPlanHash(analysisPlan),
	};
	return {
		jobId: "assembly-job",
		hostAlias: "assembly-host",
		workflow: { name: "drone/assembly", version: "1.0.0" },
		outputs: [
			"assembly/contigs.fasta",
			"assembly/assembly-metrics.json",
			"assembly/busco.json",
			"assembly/contamination.json",
		],
		dataDesign: { dataset, rows, sampleSheet, analysisPlan, contract },
		authorization: createComputeAuthorization({
			approved: true,
			hosts: ["assembly-host"],
			workflows: ["drone/assembly"],
			remoteRead: [],
			remoteWrite: [],
			budget: { maxCoreHours: 1, maxWalltimeMinutes: 30, maxConcurrentJobs: 1, maxDiskGb: 1 },
			dataDesign: contract,
		}),
	};
}

async function setup(evidence: "valid" | "missing" | "percentages-only") {
	const root = await mkdtemp(join(tmpdir(), "drone-assembly-"));
	roots.push(root);
	const spec = assemblySpec();
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
		status: vi.fn(async () => ({ ...job, status: "succeeded" as const })),
		collect: vi.fn(async (_id: string, options: { targetDir: string }) => {
			await mkdir(join(options.targetDir, "assembly"), { recursive: true });
			const files =
				evidence !== "missing"
					? [
							{ path: "assembly/contigs.fasta", text: ">contig-1\nACGTACGT\n" },
							{
								path: "assembly/assembly-metrics.json",
								text: JSON.stringify({ totalLength: 8, contigs: 1, n50: 8 }),
							},
							{
								path: "assembly/busco.json",
								text: JSON.stringify(
									evidence === "percentages-only"
										? { complete: 95, single: 94, duplicated: 1, fragmented: 2, missing: 3 }
										: {
												tool: { id: "BUSCO", version: "6.1.0" },
												lineage: { id: "eukaryota_odb12", version: "2025-07-01" },
												complete: 95,
												single: 94,
												duplicated: 1,
												fragmented: 2,
												missing: 3,
												counts: {
													complete: 95,
													single: 94,
													duplicated: 1,
													fragmented: 2,
													missing: 3,
													total: 100,
												},
											},
								),
							},
							{ path: "assembly/contamination.json", text: JSON.stringify({ contaminationRate: 0.01 }) },
						]
					: [{ path: "assembly/contigs.fasta", text: "invalid FASTA" }];
			for (const file of files) await writeFile(join(options.targetDir, file.path), file.text);
			return {
				manifest: {
					version: 1 as const,
					entries: files.map((file) => ({
						path: file.path,
						bytes: Buffer.byteLength(file.text),
						sha256: createHash("sha256").update(file.text).digest("hex"),
					})),
				},
			};
		}),
	};
	const analysis = new AnalysisOrchestrationService({
		store: new JsonStore({
			path: join(root, "runs.json"),
			storageId: "assembly-test",
			defaultValue: emptyAnalysisLedger,
		}),
	});
	const controller = new AnalysisTaskController({
		analysis,
		compute,
		capabilityRuntime: new CapabilityRuntime(new SkillVisibility()),
		adapters: new AnalysisAdapterRegistry([new AssemblyAdapter()]),
		reviewer: async () => ({
			approved: true,
			detail: "model-approved",
			reportMarkdown: "Takeaway: assembly reviewed.",
		}),
	});
	await controller.create({
		id: "assembly",
		question: "Assemble reads",
		assay: "assembly",
		mode: "exploratory",
	});
	await controller.recordDesign("assembly");
	return { controller, analysis, compute, spec, root };
}

describe("analysis adapter registry", () => {
	it("runs assembly through readiness, Compute binding, review and delivery without groups", async () => {
		const { controller, analysis, compute, spec, root } = await setup("valid");
		const ready = await controller.prepareCompute("assembly", spec, {
			readsValidated: true,
			assemblyGoalResolved: true,
			method: { id: "spades", version: "4.0.0" },
			executionContext: { host: "local", scheduler: "direct", cpus: 8 },
		});
		expect(ready).toMatchObject({
			assay: "assembly",
			stage: "readiness",
			status: "active",
			adapter: { id: "assembly", version: "1.0.0" },
		});
		expect(ready.provenance?.adapterSnapshotSha256).toMatch(/^[a-f0-9]{64}$/);
		expect(ready.provenance?.toolContractSha256).toMatch(/^[a-f0-9]{64}$/);
		expect(ready.provenance?.executionContext).toMatchObject({
			schemaVersion: 1,
			source: "host",
			values: { host: "local", scheduler: "direct", cpus: 8 },
		});
		expect(ready.provenance?.executionContext?.revision).toMatch(/^[a-f0-9]{64}$/);
		await controller.approveExecution("assembly");
		await controller.submitCompute("assembly", spec);
		await controller.reconcile("assembly");
		const delivered = await controller.reviewAndDeliver("assembly", {
			targetDir: root,
			expected: spec.outputs ?? [],
		});
		expect(delivered.context).toMatchObject({
			stage: "completed",
			status: "completed",
			provenance: {
				workflow: { id: "drone/assembly" },
				method: { id: "spades" },
				reproducibility: { status: "recorded" },
			},
		});
		expect(compute.submit).toHaveBeenCalledOnce();
		const review = (await analysis.get("assembly"))?.review;
		expect(review).toMatchObject({ approved: true, modelStatus: "approved" });
		expect(review?.checks).toHaveLength(5);
		expect(review?.checks?.every((check) => check.passed)).toBe(true);
		const restored = new AnalysisOrchestrationService({
			store: new JsonStore({
				path: join(root, "runs.json"),
				storageId: "assembly-test",
				defaultValue: emptyAnalysisLedger,
			}),
		});
		expect((await restored.get("assembly"))?.provenance?.artifacts.map((item) => item.role)).toEqual([
			"input",
			"output",
			"output",
			"output",
			"output",
			"review",
		]);
		expect((await restored.getComputeBinding("assembly"))?.adapter).toEqual({
			id: "assembly",
			version: "1.0.0",
		});
	});
	it("keeps delivery paused for percentage-only BUSCO evidence despite model approval", async () => {
		const { controller, analysis, spec, root } = await setup("percentages-only");
		await controller.prepareCompute("assembly", spec, {
			readsValidated: true,
			assemblyGoalResolved: true,
			method: { id: "spades", version: "4.0.0" },
		});
		await controller.approveExecution("assembly");
		await controller.submitCompute("assembly", spec);
		await controller.reconcile("assembly");
		const reviewed = await controller.reviewAndDeliver("assembly", {
			targetDir: root,
			expected: spec.outputs ?? [],
		});
		expect(reviewed.context).toMatchObject({ stage: "review", status: "paused" });
		const review = (await analysis.get("assembly"))?.review;
		expect(review).toMatchObject({ approved: false, modelStatus: "approved" });
		expect(review?.checks?.filter((check) => !check.passed).map((check) => check.id)).toEqual([
			"assembly-busco",
		]);
	});
	it("pauses when assembly output evidence is missing or malformed", async () => {
		const { controller, analysis, spec } = await setup("missing");
		await controller.prepareCompute("assembly", spec, {
			readsValidated: true,
			assemblyGoalResolved: true,
			method: { id: "spades", version: "4.0.0" },
		});
		await controller.approveExecution("assembly");
		await controller.submitCompute("assembly", spec);
		await controller.reconcile("assembly");
		const reviewed = await controller.reviewAndDeliver("assembly", {
			targetDir: roots[0],
			expected: spec.outputs ?? [],
		});
		expect(reviewed.context.status).toBe("paused");
		expect((await analysis.get("assembly"))?.review?.approved).toBe(false);
		expect((await analysis.get("assembly"))?.review?.modelStatus).toBe("approved");
		expect((await analysis.get("assembly"))?.review?.checks?.some((check) => !check.passed)).toBe(true);
	});
	it("rejects model approval when deterministic checks fail", async () => {
		const adapter = new AssemblyAdapter();
		const checks = adapter.reviewResults({} as never, [{ path: "assembly/contigs.fasta", text: ">c\nNN" }]);
		expect(checks.some((check) => !check.passed)).toBe(true);
	});
	it("rejects an adapter contract with duplicate schema fields", () => {
		const adapter = new AssemblyAdapter();
		const invalid = {
			...adapter,
			contract: { ...adapter.contract, inputs: [...adapter.contract.inputs, adapter.contract.inputs[0]] },
		} as AnalysisAdapter;
		expect(() => new AnalysisAdapterRegistry([invalid])).toThrow("duplicate input fields");
	});
	it("treats malformed assembly QC as a review gate", () => {
		const checks = new AssemblyAdapter().reviewResults({} as never, [
			{ path: "assembly/contigs.fasta", text: ">c\nACGT" },
			{
				path: "assembly/assembly-metrics.json",
				text: JSON.stringify({ totalLength: 4, contigs: 1, n50: 4 }),
			},
			{ path: "assembly/busco.json", text: JSON.stringify({ complete: 95, fragmented: 2, duplicated: 1 }) },
			{ path: "assembly/contamination.json", text: JSON.stringify({ contaminationRate: 0.25 }) },
		]);
		expect(checks.find((check) => check.id === "assembly-busco")?.passed).toBe(false);
		expect(checks.find((check) => check.id === "assembly-contamination")?.passed).toBe(false);
	});
});
