/**
 * Hermetic RNA-seq compute demo.
 *
 * This is deliberately a local fixture: the host profile keeps the same
 * builtin-SSH shape used by production, while the injected executor never
 * opens a socket.  The script exercises the real workflow and backend seams
 * and emits one JSON receipt suitable for CI logs or a UI fixture.
 *
 * Run with:
 *   ./scripts/run-rnaseq-local-demo.sh
 */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	type ArtifactManifest,
	analysisPlanHash,
	buildExecutorLaunch,
	type CompiledWorkflow,
	type ComputeAuthorization,
	type ComputeWorkflowJobSpec,
	checkJobAuthorization,
	compileWorkflow,
	computeJobContractHash,
	createComputeAuthorization,
	createRemoteJobProvenance,
	createRnaseqWorkflowSpec,
	type ExecutorConfig,
	InMemoryWorkflowRegistrationPort,
	type JobSpec,
	type RemoteJobProvenance,
	RNASEQ_TEST_PROFILE_RESOURCES,
	registerDatasetVersion,
	registerWorkflowSpec,
	rnaseqModuleCatalog,
	runProvenanceDeclarations,
	sampleSheetSchemaHash,
	validateArtifactManifest as validateComputeArtifactManifest,
} from "@drone/compute";
import type {
	ComputeAnalysisPlan,
	ComputeDataDesignContract,
	ComputeDatasetVersion,
	ComputeSampleSheet,
} from "@drone/shared";
import { type ComputeExecutor, ComputeService } from "../packages/backend/src/services/compute.ts";
import { preflightComputeSubmission } from "../packages/backend/src/services/compute-preflight.ts";
import {
	planRnaseqExecution,
	preflightRnaseqExecution,
	routeRnaseqIntent,
} from "../packages/backend/src/services/execution-route.ts";
import { StorageRegistry } from "../packages/backend/src/storage/registry.ts";

const JOB_ID = "rnaseq-demo-local";
const HOST_ALIAS = "fixture-local";
const SAMPLESHEET = "fixtures/rnaseq/samplesheet.csv";
const ARTIFACT_PATHS = ["results/multiqc_report.html", "results/counts.tsv"] as const;

const fixtureRoute = {
	kind: "local-fixture" as const,
	hostAlias: HOST_ALIAS,
	transport: "memory" as const,
	sshTransport: "builtin-ssh" as const,
	network: false,
	description: "Deterministic executor fixture; no SSH connection is opened",
};

const sampleSheet: ComputeSampleSheet = {
	id: "rnaseq-samples-v1",
	version: 1,
	idColumn: "sampleId",
	columns: [
		{ name: "sampleId", type: "string", required: true, unique: true },
		{ name: "condition", type: "string", required: true, allowedValues: ["control", "treated"] },
	],
};

const rows = [
	{ sampleId: "control-1", condition: "control" },
	{ sampleId: "control-2", condition: "control" },
	{ sampleId: "treated-1", condition: "treated" },
	{ sampleId: "treated-2", condition: "treated" },
] as const;

const analysisPlan: ComputeAnalysisPlan = {
	id: "rnaseq-plan-v1",
	version: 1,
	outcome: "gene expression",
	design: "two-group",
	primaryTest: "two-sample t test",
	alpha: 0.05,
	targetPower: 0.8,
	effectSize: 0.6,
	totalSampleSize: rows.length,
	groups: ["control", "treated"],
	sampleSheetSchemaId: sampleSheet.id,
};

function sha256(value: string | Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

function makeDesign(): {
	dataset: ComputeDatasetVersion;
	contract: ComputeDataDesignContract;
	dataDesign: {
		dataset: ComputeDatasetVersion;
		sampleSheet: ComputeSampleSheet;
		rows: typeof rows;
		analysisPlan: ComputeAnalysisPlan;
		contract: ComputeDataDesignContract;
	};
} {
	const dataset = registerDatasetVersion({
		datasetId: "rnaseq-fixture",
		files: [
			{
				path: SAMPLESHEET,
				bytes: 134,
				sha256: sha256(
					"sampleId,condition\ncontrol-1,control\ncontrol-2,control\ntreated-1,treated\ntreated-2,treated\n",
				),
				mediaType: "text/csv",
			},
		],
	});
	const contract: ComputeDataDesignContract = {
		datasetVersion: { datasetId: dataset.datasetId, versionId: dataset.versionId },
		sampleSheetSchemaId: sampleSheet.id,
		sampleSheetSha256: sampleSheetSchemaHash(sampleSheet),
		analysisPlanId: analysisPlan.id,
		analysisPlanSha256: analysisPlanHash(analysisPlan),
	};
	return {
		dataset,
		contract,
		dataDesign: { dataset, sampleSheet, rows, analysisPlan, contract },
	};
}

function stableJob(job: Record<string, unknown>): Record<string, unknown> {
	return {
		jobId: job.jobId,
		hostAlias: job.hostAlias,
		status: job.status,
		remoteId: job.remoteId,
		error: job.error,
		workflow:
			job.spec && typeof job.spec === "object" ? (job.spec as Record<string, unknown>).workflow : undefined,
	};
}

/**
 * A ComputeExecutor implementation backed by deterministic in-memory state.
 * It still receives the normal JobSpec/HostProfile calls made by
 * ComputeService, which is the important seam for SSH/runner adapters.
 */
class FixtureComputeExecutor implements ComputeExecutor {
	private readonly statuses = new Map<string, "queued" | "succeeded">();
	private readonly launches = new Map<string, ReturnType<typeof buildExecutorLaunch>>();
	readonly calls = { submit: 0, status: 0, logs: 0, collect: 0 };

	constructor(
		private readonly workflow: CompiledWorkflow,
		private readonly executorConfig: ExecutorConfig,
	) {}

	async submit(spec: JobSpec): Promise<{ status: "queued"; remoteId: string }> {
		this.calls.submit += 1;
		// The fixture follows the same lifecycle as a remote runner: submit returns
		// queued, then the normal ComputeService status/reconcile call observes
		// completion. No socket or scheduler is contacted.
		this.statuses.set(spec.jobId, "queued");
		this.launches.set(spec.jobId, buildExecutorLaunch(this.workflow, this.executorConfig));
		return { status: "queued", remoteId: `fixture-${spec.jobId}` };
	}

	async status(job: { jobId: string }): Promise<{ status: "succeeded"; remoteId: string }> {
		this.calls.status += 1;
		this.statuses.set(job.jobId, "succeeded");
		return { status: "succeeded", remoteId: `fixture-${job.jobId}` };
	}

	async logs(job: { jobId: string }) {
		this.calls.logs += 1;
		return {
			events: [{ type: "stdout", at: 0, text: `fixture ${job.jobId}: nf-core/rnaseq completed` }],
			cursor: "1",
		};
	}

	async collect(
		job: { jobId: string },
		host: { alias: string },
		options?: { targetDir: string; expected?: readonly string[] },
	): Promise<{ manifest: ArtifactManifest }> {
		this.calls.collect += 1;
		if (!options) throw new Error("fixture collect requires a target directory");
		if (host.alias !== HOST_ALIAS || this.statuses.get(job.jobId) !== "succeeded")
			throw new Error("fixture job is not ready for collection");
		const multiqc = `<html><body><h1>RNA-seq fixture MultiQC</h1><p>samples=4</p></body></html>\n`;
		const counts = "gene\tcontrol_mean\ttreated_mean\nfixture_gene\t10\t12\n";
		const contents: Record<(typeof ARTIFACT_PATHS)[number], string> = {
			"results/multiqc_report.html": multiqc,
			"results/counts.tsv": counts,
		};
		const entries: Array<ArtifactManifest["entries"][number]> = [];
		for (const path of ARTIFACT_PATHS) {
			const body = contents[path];
			const target = join(options.targetDir, path);
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, body, "utf8");
			entries.push({ path, bytes: Buffer.byteLength(body), sha256: sha256(body), kind: "file" });
		}
		const manifest: ArtifactManifest = {
			version: 1,
			entries,
		};
		validateComputeArtifactManifest(manifest);
		if (options.expected && ARTIFACT_PATHS.some((path) => !options.expected?.includes(path)))
			throw new Error("fixture artifacts were not requested by the job contract");
		return { manifest };
	}

	launch(jobId: string) {
		return this.launches.get(jobId);
	}
}

async function main(): Promise<void> {
	const fixtureRoot = await mkdtemp(join(tmpdir(), "drone-rnaseq-demo-"));
	const outputDir = join(fixtureRoot, "collected");
	const data = makeDesign();
	const executionIntent = {
		intent: "Run bulk RNA-seq quality control for the fixture samplesheet",
		samplesheet: SAMPLESHEET,
		hostAlias: HOST_ALIAS,
		profile: "test",
		executionMode: "fixture" as const,
		outdir: "results",
	};
	const resolvedRoute = routeRnaseqIntent(executionIntent);
	const routePlan = planRnaseqExecution(executionIntent);
	const routePreflight = preflightRnaseqExecution(executionIntent);
	if (!resolvedRoute || !routePreflight.ok) throw new Error("RNA-seq route preflight failed");
	const executorConfig: ExecutorConfig = {
		kind: "direct",
		cpus: RNASEQ_TEST_PROFILE_RESOURCES.cpus,
		memoryMb: RNASEQ_TEST_PROFILE_RESOURCES.memoryBytes / (1024 * 1024),
		walltimeMinutes: RNASEQ_TEST_PROFILE_RESOURCES.wallTimeSeconds / 60,
		profile: "test",
	};
	const auth: ComputeAuthorization = createComputeAuthorization({
		approved: true,
		hosts: [HOST_ALIAS],
		remoteRead: ["fixtures"],
		remoteWrite: ["results"],
		workflows: ["nf-core/rnaseq"],
		budget: { maxCoreHours: 10, maxWalltimeMinutes: 60, maxConcurrentJobs: 1, maxDiskGb: 1 },
		dataDesign: data.contract,
	});

	let service: ComputeService | undefined;
	try {
		// The prior is part of the immutable workflow declaration and is recorded
		// before registration, while createRnaseqWorkflowSpec remains the source
		// of the actual RNA-seq graph.
		const spec = {
			...createRnaseqWorkflowSpec({ samplesheet: SAMPLESHEET, profile: "test", outdir: "results" }),
			prior: {
				id: "rnaseq-demo-prior",
				statement: "The nf-core test profile produces a bounded MultiQC report for four fixture samples.",
				expected: "A successful fixture run emits one MultiQC report.",
				confidence: 0.95,
			},
		};
		const catalog = rnaseqModuleCatalog();
		const workflow = compileWorkflow(spec, catalog);
		const registrations = new InMemoryWorkflowRegistrationPort();
		const registration = await registerWorkflowSpec(spec, catalog, registrations);
		const jobContract = {
			jobId: JOB_ID,
			host: HOST_ALIAS,
			workflow,
			executor: executorConfig,
			remoteRead: [SAMPLESHEET],
			remoteWrite: ["results"],
			authorization: auth,
			contractHash: "",
		};
		const authorizedJob: ComputeWorkflowJobSpec = {
			...jobContract,
			contractHash: computeJobContractHash(jobContract),
		};
		const authorizationCheck = checkJobAuthorization(authorizedJob);
		if (!authorizationCheck.ok) throw new Error(`authorization failed: ${authorizationCheck.reason}`);

		const workflowRef = {
			name: spec.name,
			version: String(spec.parameters?.revision ?? "unknown"),
			source: "fixture",
			specHash: workflow.workflowSpecSha256,
		} as const;
		const preflightInput = {
			jobId: JOB_ID,
			hostAlias: HOST_ALIAS,
			workflow: workflowRef,
			remoteRead: [SAMPLESHEET],
			remoteWrite: ["results"],
			outputs: [...ARTIFACT_PATHS],
			dataDesign: data.dataDesign,
			authorization: auth,
		};
		const preflight = preflightComputeSubmission(preflightInput);
		if (!preflight.ok)
			throw new Error(`preflight failed: ${preflight.errors.map((issue) => issue.message).join("; ")}`);

		const fixtureExecutor = new FixtureComputeExecutor(workflow, executorConfig);
		service = new ComputeService({
			storage: new StorageRegistry(),
			agentDir: fixtureRoot,
			executor: fixtureExecutor,
		});
		await service.upsertHost({
			alias: HOST_ALIAS,
			host: "fixture.local",
			username: "fixture",
			transport: "builtin-ssh",
			hostKeyFingerprint: "fixture:no-network",
		});
		const submitted = await service.submit(preflightInput);
		const completed = await service.status(JOB_ID);
		if (completed.status !== "succeeded")
			throw new Error(
				`fixture status did not reconcile: submitted=${submitted.status}, completed=${completed.status}; executor calls=${JSON.stringify(fixtureExecutor.calls)}; events=${JSON.stringify(await service.listEvents(JOB_ID))}`,
			);
		const logs = await service.logs(JOB_ID);
		const collected = await service.collect(JOB_ID, { targetDir: outputDir, expected: [...ARTIFACT_PATHS] });
		const provenance: RemoteJobProvenance = createRemoteJobProvenance({
			jobId: JOB_ID,
			hostAlias: HOST_ALIAS,
			executor: executorConfig.kind,
			schedulerJobId: `fixture-${JOB_ID}`,
			nextflowVersion: "fixture-nextflow-24.10",
			pipeline: "nf-core/rnaseq",
			pipelineVersion: String(spec.parameters?.revision),
			profile: "test",
			workflow,
			remoteInputs: [SAMPLESHEET],
			remoteOutputs: [...ARTIFACT_PATHS],
			authorizationContractHash: auth.contractHash,
			executionStatus: "succeeded",
		});

		const receipt = {
			schemaVersion: 1,
			kind: "compute-demo-receipt",
			status: "succeeded",
			route: resolvedRoute,
			routeAdapter: fixtureRoute,
			plan: {
				workflowId: spec.id,
				workflowSpecSha256: workflow.workflowSpecSha256,
				routePlan: {
					workflowSpecSha256: routePlan.binding.workflowSpecSha256,
					executionMode: routePlan.binding.executionMode,
					taskId: routePlan.binding.taskId,
					idempotencyKey: routePlan.binding.idempotencyKey,
				},
				registration: {
					workflowSpecSha256: registration.workflowSpecSha256,
					workflowId: registration.workflowId,
					moduleIds: registration.moduleIds,
					priorId: registration.priorId,
				},
				moduleCommits: workflow.moduleCommits,
				containerDigests: workflow.containerDigests,
				executor: executorConfig,
				launch: fixtureExecutor.launch(JOB_ID),
			},
			preflight: {
				route: {
					ok: routePreflight.ok,
					errors: routePreflight.errors,
					warnings: routePreflight.warnings,
				},
				...preflight,
				authorization: { approved: auth.approved, contractHash: auth.contractHash },
				authorizationCheck,
			},
			job: {
				requested: stableJob(submitted as unknown as Record<string, unknown>),
				completed: stableJob(completed as unknown as Record<string, unknown>),
				logs,
				executorCalls: fixtureExecutor.calls,
			},
			artifacts: collected.manifest,
			provenance: runProvenanceDeclarations(provenance),
			receipt: {
				kind: "provenance-receipt",
				jobId: JOB_ID,
				workflowSpecSha256: workflow.workflowSpecSha256,
				authorizationContractHash: auth.contractHash,
				artifactSha256: collected.manifest.entries.map((entry) => entry.sha256),
				executionStatus: provenance.executionStatus,
			},
		};
		console.log(JSON.stringify(receipt, null, 2));
	} finally {
		await service?.dispose();
		await rm(fixtureRoot, { recursive: true, force: true });
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
	process.exitCode = 1;
});
