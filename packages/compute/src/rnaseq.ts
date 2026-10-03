import type { ComputeWorkflowSpec, WorkflowModule } from "./types";
import { createWorkflowSpec, InMemoryWorkflowModuleCatalog } from "./workflow";

export const RNASEQ_PIPELINE = "nf-core/rnaseq";
export const RNASEQ_TEST_PROFILE = "test";
/** Official immutable nf-core/rnaseq release used by the real execution path. */
export const RNASEQ_REVISION = "3.18.0";
export const RNASEQ_COMMIT = "b96a75361a4f1d49aa969a2b1c68e3e607de06e8";

/**
 * nf-core/rnaseq uses one image per process.  This map records the resolved
 * digest for the FastQC image used by the test profile; additional process
 * images are resolved by Nextflow and appended to run provenance at submit
 * time.  Keeping the registry reference and digest together prevents a
 * mutable tag from being mistaken for a reproducible run.
 */
export const RNASEQ_CONTAINER = "quay.io/biocontainers/fastqc:0.12.1--hdfd78af_0";
export const RNASEQ_CONTAINER_DIGEST =
	"sha256:e194048df39c3145d9b4e0a14f4da20b59d59250465b6f2a9cb698445fd45900";
export const RNASEQ_CONTAINER_DIGESTS = Object.freeze({
	fastqc: RNASEQ_CONTAINER_DIGEST,
});

/** Conservative defaults for the official nf-core test profile. */
export const RNASEQ_TEST_PROFILE_RESOURCES = Object.freeze({
	cpus: 4,
	memoryBytes: 8 * 1024 * 1024 * 1024,
	wallTimeSeconds: 60 * 60,
});

/** Validate a digest captured from an OCI registry manifest or Nextflow trace. */
export function resolvedRnaseqContainerDigest(value: string): string {
	if (!/^sha256:[0-9a-f]{64}$/i.test(value))
		throw new Error("RNA-seq container digest must be a resolved sha256 OCI digest");
	return value.toLowerCase();
}

export interface RnaseqRunConfig {
	samplesheet: string;
	inputStage?: "fastq" | "counts";
	profile?: string;
	nfCoreRevision?: string;
	genome?: string;
	outdir?: string;
	strandedness?: "unstranded" | "forward" | "reverse";
}

export const RNASEQ_MODULE: WorkflowModule = {
	id: RNASEQ_PIPELINE,
	name: RNASEQ_PIPELINE,
	source: "nf-core",
	version: RNASEQ_REVISION,
	commit: RNASEQ_COMMIT,
	path: "nf-core/rnaseq",
	process: "RNASEQ",
	inputs: [{ name: "samplesheet", type: "samplesheet", required: true }],
	outputs: [
		{ name: "multiqc", type: "report" },
		{ name: "counts", type: "counts" },
	],
	container: RNASEQ_CONTAINER,
	containerDigest: RNASEQ_CONTAINER_DIGEST,
	execution: "ready",
};

export function validateRnaseqConfig(config: RnaseqRunConfig): void {
	if (!config.samplesheet || config.samplesheet.startsWith("-") || config.samplesheet.includes(".."))
		throw new Error("RNA-seq samplesheet must be a bounded path");
	if (config.inputStage === "counts")
		throw new Error(
			"RNA-seq FASTQ workflow cannot be started from existing counts; use a counts-stage workflow",
		);
	if (config.profile && !/^[A-Za-z0-9_.-]+$/.test(config.profile))
		throw new Error("Invalid Nextflow profile");
	if (config.nfCoreRevision && !/^[A-Za-z0-9_.-]+$/.test(config.nfCoreRevision))
		throw new Error("Invalid nf-core revision");
	if (config.genome && !/^[A-Za-z0-9_.-]+$/.test(config.genome)) throw new Error("Invalid genome name");
	if (config.outdir && (config.outdir.startsWith("-") || config.outdir.includes("..")))
		throw new Error("Output directory must be bounded");
}

export function createRnaseqWorkflowSpec(config: RnaseqRunConfig): ComputeWorkflowSpec {
	validateRnaseqConfig(config);
	const profile = config.profile ?? RNASEQ_TEST_PROFILE;
	const revision = config.nfCoreRevision ?? RNASEQ_REVISION;
	return createWorkflowSpec({
		id: "rnaseq",
		name: "Bulk RNA-seq QC and quantification",
		entrypoint: "rnaseq",
		modules: [RNASEQ_PIPELINE],
		inputs: [{ name: "samplesheet", type: "samplesheet", param: "input" }],
		steps: [
			{
				id: "rnaseq",
				module: RNASEQ_PIPELINE,
				inputs: { samplesheet: { input: "samplesheet" } },
				params: { profile },
			},
		],
		outputs: [
			{ name: "multiqc", type: "report", from: "step:rnaseq.multiqc" },
			{ name: "counts", type: "counts", from: "step:rnaseq.counts" },
		],
		parameters: {
			input: config.samplesheet,
			revision,
			...(config.genome ? { genome: config.genome } : {}),
			...(config.outdir ? { outdir: config.outdir } : {}),
			...(config.strandedness ? { strandedness: config.strandedness } : {}),
		},
		metadata: {
			pipeline: RNASEQ_PIPELINE,
			profile,
			revision,
			containerDigestSource: "quay.io-manifest",
		},
	});
}

export function rnaseqModuleCatalog(): InMemoryWorkflowModuleCatalog {
	return new InMemoryWorkflowModuleCatalog([RNASEQ_MODULE]);
}
