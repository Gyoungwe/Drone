import { ComputeTaskBindingSchema, ExecutionReceiptSchema, ExecutionRouteSchema } from "@drone/shared";
import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
	executeRnaseqFixture,
	planRnaseqExecution,
	preflightRnaseqExecution,
	RnaseqExecutionService,
	routeExecutionIntent,
} from "../src/services/execution-route";

describe("RNA-seq execution route", () => {
	it("maps supported natural language to the fixed route and declines adjacent workflows", () => {
		const route = routeExecutionIntent("Run bulk RNA-seq QC and quantification with samplesheet: data.csv");
		expect(route).toMatchObject({
			routeId: "rnaseq",
			workflow: "rnaseq",
			pipeline: "nf-core/rnaseq",
			inputStage: "fastq",
			samplesheet: "data.csv",
			profile: "test",
		});
		expect(Check(ExecutionRouteSchema, route)).toBe(true);
		expect(routeExecutionIntent("Run single-cell RNA-seq clustering")).toBeNull();
		expect(routeExecutionIntent("Perform differential expression from counts")).toBeNull();
		expect(routeExecutionIntent("Make a volcano plot")).toBeNull();
		expect(
			routeExecutionIntent("Run RNA sequencing; samplesheet is data.csv; profile is test"),
		).toMatchObject({
			samplesheet: "data.csv",
			profile: "test",
		});
	});

	it("creates a deterministic, pinned workflow plan before submit", () => {
		const first = planRnaseqExecution({
			intent: "Run RNA-seq",
			samplesheet: "fixtures/samplesheet.csv",
			taskId: "task-rna-1",
		});
		const second = planRnaseqExecution({
			intent: "Run RNA-seq",
			samplesheet: "fixtures/samplesheet.csv",
			taskId: "task-rna-1",
		});
		expect(first.binding.workflowSpecSha256).toBe(second.binding.workflowSpecSha256);
		expect(first.job.workflow).toMatchObject({ name: "nf-core/rnaseq", version: "3.18.0" });
		expect(first.workflowSpec.metadata).toMatchObject({
			pipeline: "nf-core/rnaseq",
			profile: "test",
			revision: "3.18.0",
		});
		expect(first.compiledWorkflow.executionMode).toBe("ready");
		expect(Check(ComputeTaskBindingSchema, first.binding)).toBe(true);
	});

	it("blocks malformed input in preflight without invoking an executor", async () => {
		const preflight = preflightRnaseqExecution({ intent: "Run RNA-seq", samplesheet: "../outside.csv" });
		expect(preflight.ok).toBe(false);
		expect(preflight.errors.join(" ")).toMatch(/bounded|outside/i);
		expect(preflightRnaseqExecution({ intent: "Run RNA-seq", profile: "x".repeat(65) }).ok).toBe(false);
		let calls = 0;
		const service = new RnaseqExecutionService({
			submit: async () => {
				calls += 1;
				return { status: "succeeded" };
			},
		});
		const receipt = await service.execute({ intent: "Run RNA-seq", samplesheet: "../outside.csv" });
		expect(receipt.status).toBe("blocked");
		expect(receipt.preflight.ok).toBe(false);
		expect(calls).toBe(0);
		expect(Check(ExecutionReceiptSchema, receipt)).toBe(true);
	});

	it("runs the offline fixture through preflight and returns a receipt", async () => {
		const receipt = await executeRnaseqFixture({
			intent: "Run RNA-seq QC",
			taskId: "fixture-rna-1",
			samplesheet: "fixtures/samplesheet.csv",
		});
		expect(receipt).toMatchObject({
			status: "succeeded",
			fixture: true,
			executionId: "fixture-rna-1",
			jobId: "fixture-rna-1",
			remoteId: "fixture:fixture-rna-1",
			preflight: { ok: true },
		});
		expect(receipt.route?.pipeline).toBe("nf-core/rnaseq");
		expect(Check(ExecutionReceiptSchema, receipt)).toBe(true);
	});

	it("keeps submit side effects behind the injected compute seam", async () => {
		let submitted: unknown;
		const service = new RnaseqExecutionService({
			now: () => new Date("2026-10-11T00:00:00.000Z"),
			submit: async (spec) => {
				submitted = spec;
				return { jobId: spec.jobId, remoteId: "runner-42", status: "queued" };
			},
		});
		const receipt = await service.execute({ intent: "Run RNA-seq", taskId: "real-seam" });
		expect(receipt.status).toBe("queued");
		expect(receipt.fixture).toBe(true);
		expect(submitted).toMatchObject({
			jobId: "real-seam",
			workflow: { name: "nf-core/rnaseq", version: "3.18.0" },
		});
		expect(receipt.createdAt).toBe("2026-10-11T00:00:00.000Z");
	});

	it("fails closed when production mode has no host submitter", async () => {
		const receipt = await new RnaseqExecutionService().execute({
			intent: "Run RNA sequencing",
			taskId: "production-without-host",
			executionMode: "production",
		});
		expect(receipt.status).toBe("blocked");
		expect(receipt.fixture).toBe(false);
		expect(receipt.preflight.errors.join(" ")).toMatch(/injected ComputeService|submitter/i);
	});
});
