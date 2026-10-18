import type { AnalysisComputePlanInput, AnalysisContext, AnalysisReviewCheck } from "@gyoungwe/plugin-api";
import {
	type AnalysisAdapter,
	type AnalysisAdapterPlan,
	type AnalysisArtifactEvidence,
	adapterSnapshotSha256,
	methodIdentity,
	recordEvidence,
	requiredOutputs,
} from "./registry";

/** Minimal de novo assembly contract; no treatment groups or contrasts. */
export class AssemblyAdapter implements AnalysisAdapter {
	readonly identity = { id: "assembly", version: "1.0.0" };
	readonly contract = {
		schemaVersion: 1 as const,
		assay: "assembly",
		domain: "genomics" as const,
		researchStages: ["design", "readiness", "execution", "review", "delivery"] as const,
		inputs: [
			{
				id: "assembly-reads",
				type: "file" as const,
				required: true,
				formats: ["fastq", "fastq.gz", "fasta", "fasta.gz"],
			},
			{ id: "reference-or-goal", type: "metadata" as const, required: true },
		],
		outputs: [
			{ id: "assembly", type: "file" as const, required: true, formats: ["fasta", "fa", "fna"] },
			{ id: "assembly-metrics", type: "metric" as const, required: true, formats: ["json"] },
			{ id: "busco", type: "metric" as const, required: true, formats: ["json"] },
			{ id: "contamination", type: "metric" as const, required: true, formats: ["json"] },
		],
		capabilities: ["analysis", "files", "coding"],
		sideEffects: ["read-only", "code-execution", "project-write"],
		evidenceTypes: ["assembly-fasta", "assembly-metrics", "busco", "contamination", "hi-c-contact-map"],
		workflow: { id: "drone/assembly", version: "1.0.0" },
	} as const;
	readonly reviewInstructions =
		"Review de novo assembly outputs and supplied QC evidence. A nonempty FASTA and positive assembly length are only structural checks. Do not claim completeness, absence of contamination, chromosome correctness or reference agreement without corresponding validated evidence. Preserve supplied limitations.";
	supports(assay: string): boolean {
		return assay === "assembly";
	}
	buildPlan(_context: AnalysisContext, spec: AnalysisComputePlanInput, value: unknown): AnalysisAdapterPlan {
		const evidence = recordEvidence(value);
		const method = methodIdentity(evidence.method);
		const outputs = requiredOutputs(spec);
		const requiredQcOutputs = [
			"assembly/contigs.fasta",
			"assembly/assembly-metrics.json",
			"assembly/busco.json",
			"assembly/contamination.json",
		];
		const missingOutputs = requiredQcOutputs.filter((path) => !outputs.includes(path));
		const ready =
			evidence.readsValidated === true &&
			evidence.assemblyGoalResolved === true &&
			Boolean(spec.dataDesign?.dataset?.files?.length) &&
			missingOutputs.length === 0;
		return {
			method,
			requiredOutputs: outputs,
			adapterSnapshotSha256: adapterSnapshotSha256(this),
			assessment: {
				ok: ready,
				inferentialClaimsAllowed: false,
				gates: ready
					? []
					: [
							{
								code: "missing-data",
								severity: "pause",
								message:
									missingOutputs.length > 0
										? `Assembly contract is missing QC outputs: ${missingOutputs.join(", ")}`
										: "Assembly requires validated input reads and a resolved assembly goal.",
								evidenceKey: "assembly-inputs",
							},
						],
				warnings: [
					"Assembly structure checks do not establish completeness, contamination status or chromosome correctness; these require separate QC evidence.",
				],
			},
		};
	}
	reviewResults(
		_context: AnalysisContext,
		artifacts: readonly AnalysisArtifactEvidence[],
	): readonly AnalysisReviewCheck[] {
		const fasta = artifacts.find((item) => /\.(fasta|fa|fna)$/i.test(item.path));
		const metrics = artifacts.find((item) => /(^|\/)assembly-metrics\.json$/.test(item.path));
		const busco = artifacts.find((item) => /(^|\/)(busco|assembly\/busco)\.json$/.test(item.path));
		const contamination = artifacts.find((item) =>
			/(^|\/)(contamination|assembly\/contamination)\.json$/.test(item.path),
		);
		let positiveLength = false;
		let validBusco = false;
		let validContamination = false;
		try {
			const value: unknown = JSON.parse(metrics?.text ?? "");
			const row = recordEvidence(value);
			positiveLength =
				typeof row.totalLength === "number" &&
				Number.isFinite(row.totalLength) &&
				row.totalLength > 0 &&
				typeof row.contigs === "number" &&
				Number.isInteger(row.contigs) &&
				row.contigs > 0;
			positiveLength =
				positiveLength && typeof row.n50 === "number" && Number.isFinite(row.n50) && row.n50 > 0;
		} catch {
			/* Missing or malformed QC is rejected. */
		}
		try {
			const row = recordEvidence(JSON.parse(busco?.text ?? ""));
			const values = ["complete", "fragmented", "duplicated", "missing"].map((key) => row[key]);
			validBusco =
				values.every(
					(value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100,
				) && Math.abs((values as number[]).reduce((sum, value) => sum + value, 0) - 100) < 0.01;
		} catch {
			/* Missing or malformed BUSCO evidence is rejected. */
		}
		try {
			const row = recordEvidence(JSON.parse(contamination?.text ?? ""));
			const rate = row.contaminationRate;
			validContamination = typeof rate === "number" && Number.isFinite(rate) && rate >= 0 && rate <= 0.1;
		} catch {
			/* Missing or malformed contamination evidence is rejected. */
		}
		return [
			{
				id: "assembly-fasta",
				passed: /^>[^\r\n]+\r?\n[ACGTNacgtn]+/.test(fasta?.text ?? ""),
				detail: "Assembly FASTA requires a header and nucleotide sequence.",
			},
			{
				id: "assembly-metrics",
				passed: positiveLength,
				detail: "Assembly metrics require positive totalLength, contigs and N50.",
			},
			{
				id: "assembly-busco",
				passed: validBusco,
				detail:
					"BUSCO evidence requires complete, fragmented, duplicated and missing percentages summing to 100.",
			},
			{
				id: "assembly-contamination",
				passed: validContamination,
				detail: "Contamination evidence requires contaminationRate between 0 and 0.1.",
			},
		];
	}
}
