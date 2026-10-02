import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildExecutorLaunch,
	checkJobAuthorization,
	compileWorkflow,
	computeJobContractHash,
	createComputeAuthorization,
	createRemoteJobProvenance,
	createRnaseqWorkflowSpec,
	directScheduler,
	evaluateMultiqcJson,
	evaluateMultiqcText,
	FakeCommandRunner,
	FakeRemoteRunner,
	previewWorkflow,
	RNASEQ_PIPELINE,
	RNASEQ_TEST_PROFILE,
	rnaseqModuleCatalog,
	submissionDecision,
	validateWorkflowSpec,
	writeCompiledWorkflow,
} from "../src/index";
import type { ComputeWorkflowJobSpec, WorkflowModule } from "../src/types";

describe("RNA-seq WorkflowSpec vertical slice", () => {
	it("validates, compiles, and previews through an injected runner", async () => {
		const spec = createRnaseqWorkflowSpec({ samplesheet: "samplesheet.csv" });
		const catalog = rnaseqModuleCatalog();
		const validation = validateWorkflowSpec(spec, catalog);
		expect(validation.ok).toBe(true);
		expect(validation.warnings.map((issue) => issue.code)).toContain("fixture-module");
		const artifact = compileWorkflow(spec, catalog);
		expect(artifact.executionMode).toBe("fixture");
		expect(artifact.mainNf).toContain("nextflow.enable.dsl=2");
		expect(artifact.mainNf).toContain("include { RNASEQ as rnaseq_RNASEQ }");
		expect(artifact.mainNf).toContain("RNASEQ");
		expect(artifact.nextflowConfig).toContain("input = 'samplesheet.csv'");
		const runner = new FakeCommandRunner({ exitCode: 0, stdout: "Preview OK" });
		const result = await previewWorkflow(artifact, runner, {
			cwd: "/approved/run",
			profile: RNASEQ_TEST_PROFILE,
		});
		expect(result.ok).toBe(true);
		expect(runner.calls[0]?.args).toEqual([
			"run",
			"main.nf",
			"-preview",
			"-c",
			"nextflow.config",
			"-profile",
			"test",
		]);
	});

	it("keeps direct and Slurm launch construction explicit", () => {
		const artifact = compileWorkflow(
			createRnaseqWorkflowSpec({ samplesheet: "samplesheet.csv" }),
			rnaseqModuleCatalog(),
		);
		const direct = buildExecutorLaunch(artifact, {
			kind: "direct",
			cpus: 2,
			memoryMb: 2048,
			walltimeMinutes: 30,
		});
		const slurm = buildExecutorLaunch(artifact, {
			kind: "slurm",
			cpus: 2,
			memoryMb: 2048,
			walltimeMinutes: 30,
			queue: "short",
			partition: "cpu",
		});
		expect(direct.args).toContain("local");
		expect(slurm.args).toContain("slurm");
		expect(slurm.args).toContain("--partition=cpu");
	});

	it("rejects cycles and type mismatches before compile", () => {
		const module: WorkflowModule = {
			id: "user/a",
			name: "a",
			source: "user",
			version: "1",
			commit: "abc123",
			path: "user/a",
			process: "A",
			inputs: [{ name: "input", type: "table", required: true }],
			outputs: [{ name: "output", type: "table" }],
			containerDigest: "sha256:test",
		};
		const spec = {
			version: 1 as const,
			id: "cycle",
			name: "cycle",
			inputs: [{ name: "reads", type: "fastq" as const }],
			steps: [
				{ id: "one", module: "user/a", inputs: { input: "step:two.output" } },
				{ id: "two", module: "user/a", inputs: { input: "step:one.output" } },
			],
			outputs: [{ name: "out", type: "table" as const, from: "step:one.output" }],
		};
		const validation = validateWorkflowSpec(spec, {
			get: (id) => (id === module.id ? module : undefined),
			list: () => [module],
		});
		expect(validation.ok).toBe(false);
		expect(validation.errors.map((issue) => issue.code)).toContain("cycle");
	});

	it("validates forward step references after the full graph is known", () => {
		const source: WorkflowModule = {
			id: "user/source",
			name: "source",
			source: "user",
			version: "1",
			commit: "abc123",
			path: "user/source",
			process: "SOURCE",
			inputs: [{ name: "input", type: "fastq", required: true }],
			outputs: [{ name: "output", type: "fastq" }],
			containerDigest: "sha256:test",
		};
		const target: WorkflowModule = {
			...source,
			id: "user/target",
			name: "target",
			process: "TARGET",
			inputs: [{ name: "input", type: "counts", required: true }],
		};
		const validation = validateWorkflowSpec(
			{
				version: 1,
				id: "forward",
				name: "forward",
				inputs: [{ name: "reads", type: "fastq" }],
				steps: [
					{ id: "target", module: target.id, inputs: { input: "step:source.output" } },
					{ id: "source", module: source.id, inputs: { input: "input:reads" } },
				],
				outputs: [{ name: "out", type: "counts", from: "step:target.output" }],
			},
			{
				get: (id) => [source, target].find((module) => module.id === id),
				list: () => [source, target],
			},
		);
		expect(validation.errors.map((issue) => issue.code)).toContain("type-mismatch");
	});

	it("writes compiled files only under the approved root", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-compute-"));
		try {
			const artifact = compileWorkflow(
				createRnaseqWorkflowSpec({ samplesheet: "reads.csv" }),
				rnaseqModuleCatalog(),
			);
			const written = await writeCompiledWorkflow(artifact, "run-1", root);
			expect(await readFile(join(written.directory, "main.nf"), "utf8")).toContain("RNASEQ");
			await expect(writeCompiledWorkflow(artifact, "../escape", root)).rejects.toThrow("outside");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("MultiQC and remote provenance", () => {
	it("keeps deterministic QC separate from human/scientific review", () => {
		const qc = evaluateMultiqcJson(
			{ modules: ["fastqc"], report_general_stats_data: { sampleA: { fastqc: { total_sequences: 1000 } } } },
			[
				{ id: "samples", metric: "sampleCount", operator: "gte", value: 1 },
				{ id: "reads", metric: "total_sequences", operator: "gte", value: 100 },
			],
		);
		expect(qc.status).toBe("pass");
		expect(qc.reviewed).toBe(false);
		expect(qc.qcVerified).toBe(false);
		const unknown = evaluateMultiqcJson("not-json", []);
		expect(unknown.status).toBe("unknown");
		const tsv = evaluateMultiqcText("sample\tfastqc_total_sequences\nsampleA\t1000\n", [
			{ id: "reads", metric: "total_sequences", operator: "gte", value: 100 },
		]);
		expect(tsv.status).toBe("pass");

		const workflow = compileWorkflow(
			createRnaseqWorkflowSpec({ samplesheet: "reads.csv" }),
			rnaseqModuleCatalog(),
		);
		const provenance = createRemoteJobProvenance({
			jobId: "job-1",
			hostAlias: "fake-host",
			executor: "direct",
			pipeline: RNASEQ_PIPELINE,
			pipelineVersion: "3.18.0",
			workflow,
			remoteInputs: ["/data/reads"],
			remoteOutputs: ["/data/results"],
			authorizationContractHash: "contract",
			executionStatus: "succeeded",
			qc,
		});
		expect(provenance.workflowSpecSha256).toBe(workflow.workflowSpecSha256);
		expect(provenance.scientificallyVerified).toBe(false);
	});
});

describe("authorization and runner seams", () => {
	it("does not replay an ambiguous submission side effect", () => {
		expect(submissionDecision({ lockExists: false }).kind).toBe("submit");
		expect(submissionDecision({ lockExists: true }).kind).toBe("unknown");
		expect(submissionDecision({ lockExists: true, jobId: "123" })).toMatchObject({
			kind: "reuse",
			jobId: "123",
		});
	});
	it("binds a job to an immutable approval and never runs arbitrary shell text", async () => {
		const workflow = compileWorkflow(
			createRnaseqWorkflowSpec({ samplesheet: "reads.csv" }),
			rnaseqModuleCatalog(),
		);
		const authorization = createComputeAuthorization({
			approved: true,
			hosts: ["fake-host"],
			remoteRead: ["/data"],
			remoteWrite: ["/data"],
			workflows: [RNASEQ_PIPELINE],
			budget: { maxCoreHours: 4, maxWalltimeMinutes: 60, maxConcurrentJobs: 1, maxDiskGb: 10 },
		});
		const base = {
			jobId: "job-1",
			host: "fake-host",
			workflow,
			executor: { kind: "direct" as const, cpus: 2, memoryMb: 2048, walltimeMinutes: 30 },
			remoteRead: ["/data/reads"],
			remoteWrite: ["/data/results"],
			authorization,
		};
		const job: ComputeWorkflowJobSpec = { ...base, contractHash: computeJobContractHash(base) };
		expect(checkJobAuthorization(job, authorization.contractHash)).toMatchObject({
			ok: false,
			reason: "workflow is a preview fixture and cannot be submitted",
		});
		const readyWorkflow = {
			...workflow,
			executionMode: "ready" as const,
			moduleCommits: { [RNASEQ_PIPELINE]: "abc123" },
			containerDigests: { [RNASEQ_PIPELINE]: `sha256:${"a".repeat(64)}` },
		};
		const readyBase = { ...base, workflow: readyWorkflow };
		const readyJob: ComputeWorkflowJobSpec = {
			...readyBase,
			contractHash: computeJobContractHash(readyBase),
		};
		expect(checkJobAuthorization(readyJob, authorization.contractHash).ok).toBe(true);
		expect(
			checkJobAuthorization({ ...readyJob, remoteWrite: ["/data/../etc"] }, authorization.contractHash).ok,
		).toBe(false);
		expect(checkJobAuthorization(readyJob, "stale").ok).toBe(false);

		const runner = new FakeRemoteRunner();
		expect(() => directScheduler.start(job, runner)).toThrow("preview fixture");
		expect(runner.requests).toHaveLength(0);
		void runner.request({ operation: "start", jobId: "job-1", payload: { executor: "direct" } });
		expect(runner.requests[0]?.operation).toBe("start");
	});
});
