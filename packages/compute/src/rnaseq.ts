import type { ComputeWorkflowSpec, WorkflowModule } from "./types";
import { createWorkflowSpec, InMemoryWorkflowModuleCatalog } from "./workflow";

export const RNASEQ_PIPELINE = "nf-core/rnaseq";
export const RNASEQ_TEST_PROFILE = "test";

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
	version: "3.18.0",
	commit: "test-profile-pinned",
	path: "nf-core/rnaseq",
	process: "RNASEQ",
	inputs: [{ name: "samplesheet", type: "samplesheet", required: true }],
	outputs: [
		{ name: "multiqc", type: "report" },
		{ name: "counts", type: "counts" },
	],
	containerDigest: "sha256:unresolved-test-profile",
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
			...(config.nfCoreRevision ? { revision: config.nfCoreRevision } : {}),
			...(config.genome ? { genome: config.genome } : {}),
			...(config.outdir ? { outdir: config.outdir } : {}),
			...(config.strandedness ? { strandedness: config.strandedness } : {}),
		},
		metadata: { pipeline: RNASEQ_PIPELINE, profile },
	});
}

export function rnaseqModuleCatalog(): InMemoryWorkflowModuleCatalog {
	return new InMemoryWorkflowModuleCatalog([RNASEQ_MODULE]);
}
