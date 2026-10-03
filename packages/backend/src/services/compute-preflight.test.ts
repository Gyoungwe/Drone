import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	analysisPlanHash,
	type ComputeAuthorization,
	createComputeAuthorization,
	type DatasetVersionInput,
	registerDatasetVersion,
	sampleSheetSchemaHash,
} from "@drone/compute";
import type { ComputeAnalysisPlan, ComputeDataDesignContract, ComputeSampleSheet } from "@drone/shared";
import { describe, expect, it } from "vitest";
import { StorageRegistry } from "../storage/registry";
import type { ComputeExecutor } from "./compute";
import { ComputeService } from "./compute";
import { ComputePreflightError, preflightComputeSubmission } from "./compute-preflight";

const sampleSheet: ComputeSampleSheet = {
	id: "sample-v1",
	version: 1,
	idColumn: "sampleId",
	columns: [
		{ name: "sampleId", type: "string", required: true, unique: true },
		{ name: "treatment", type: "string", required: true, allowedValues: ["control", "treated"] },
	],
};

const analysisPlan: ComputeAnalysisPlan = {
	id: "analysis-v1",
	version: 1,
	outcome: "response",
	design: "two-group",
	primaryTest: "two-sample t test",
	alpha: 0.05,
	targetPower: 0.8,
	effectSize: 0.6,
	totalSampleSize: 4,
	groups: ["control", "treated"],
	sampleSheetSchemaId: sampleSheet.id,
};

const rows = [
	{ sampleId: "s1", treatment: "control" },
	{ sampleId: "s2", treatment: "control" },
	{ sampleId: "s3", treatment: "treated" },
	{ sampleId: "s4", treatment: "treated" },
] as const;

function design() {
	const datasetInput: DatasetVersionInput = {
		datasetId: "study",
		files: [{ path: "inputs/counts.tsv", bytes: 12, sha256: "a".repeat(64) }],
	};
	const dataset = registerDatasetVersion(datasetInput);
	const contract: ComputeDataDesignContract = {
		datasetVersion: { datasetId: dataset.datasetId, versionId: dataset.versionId },
		sampleSheetSchemaId: sampleSheet.id,
		sampleSheetSha256: sampleSheetSchemaHash(sampleSheet),
		analysisPlanId: analysisPlan.id,
		analysisPlanSha256: analysisPlanHash(analysisPlan),
	};
	return { dataset, contract, sampleSheet, analysisPlan, rows };
}

function authorization(contract: ComputeDataDesignContract): ComputeAuthorization {
	return createComputeAuthorization({
		approved: true,
		hosts: ["local"],
		remoteRead: [],
		remoteWrite: [],
		workflows: ["*"],
		budget: { maxCoreHours: 10, maxWalltimeMinutes: 60, maxConcurrentJobs: 1, maxDiskGb: 10 },
		dataDesign: contract,
	});
}

describe("compute data-design preflight", () => {
	it("accepts an approved immutable design contract", () => {
		const value = design();
		const result = preflightComputeSubmission({
			jobId: "job-1",
			hostAlias: "local",
			workflow: { version: 1, modules: [], steps: [] },
			dataDesign: value,
			authorization: authorization(value.contract),
		});
		expect(result.ok).toBe(true);
		expect(result.designPresent).toBe(true);
		expect(result.authorizationContractHash).toMatch(/^[a-f0-9]{64}$/);
		expect(result.designContractHash).toBeTruthy();
	});

	it("turns a changed sample schema into actionable proposal questions", () => {
		const value = design();
		const changed = { ...value.sampleSheet, version: 2 };
		const result = preflightComputeSubmission({
			jobId: "job-1",
			hostAlias: "local",
			workflow: { version: 1, modules: [], steps: [] },
			dataDesign: { ...value, sampleSheet: changed },
			authorization: authorization(value.contract),
		});
		expect(result.ok).toBe(false);
		expect(result.errors.some((issue) => issue.code === "sample-schema-hash-mismatch")).toBe(true);
		expect(result.questions.length).toBeGreaterThan(0);
		expect(() => {
			throw new ComputePreflightError(result);
		}).toThrow("proposal decision");
	});

	it("blocks an invalid design before ComputeService persists or executes it", async () => {
		const value = design();
		let submissions = 0;
		const executor: ComputeExecutor = {
			submit: async () => {
				submissions += 1;
				return { status: "queued" };
			},
			status: async () => ({ status: "unknown" }),
		};
		const root = await mkdtemp(join(tmpdir(), "drone-compute-preflight-"));
		const service = new ComputeService({ storage: new StorageRegistry(), agentDir: root, executor });
		await service.upsertHost({ alias: "local", host: "127.0.0.1", username: "runner" });
		await expect(
			service.submit({
				jobId: "job-1",
				hostAlias: "local",
				workflow: { version: 1, modules: [], steps: [] },
				dataDesign: { ...value, contract: { ...value.contract, analysisPlanId: "changed" } },
				authorization: authorization(value.contract),
			}),
		).rejects.toBeInstanceOf(ComputePreflightError);
		expect(submissions).toBe(0);
		expect(await service.getJob("job-1")).toBeNull();
		await service.dispose();
	});
});
