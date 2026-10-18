import type {
	AnalysisComputePlanInput,
	AnalysisContext,
	AnalysisGate,
	AnalysisReadiness,
	AnalysisReviewCheck,
} from "@gyoungwe/plugin-api";
import {
	type AnalysisAdapter,
	type AnalysisAdapterPlan,
	type AnalysisArtifactEvidence,
	adapterSnapshotSha256,
	methodIdentity,
	recordEvidence,
	requiredOutputs,
} from "./registry";

export interface BiologicalReplicateCount {
	readonly group: string;
	readonly count: number;
}
export interface BulkRnaseqReadinessInput {
	readonly mode: "exploratory" | "inferential";
	readonly contrastResolved: boolean;
	readonly referenceResolved: boolean;
	readonly biologicalReplicates: readonly BiologicalReplicateCount[];
}

export function assessBulkRnaseqReadiness(input: BulkRnaseqReadinessInput): AnalysisReadiness {
	const gates: AnalysisGate[] = [];
	const warnings: string[] = [];
	const gate = (
		code: AnalysisGate["code"],
		message: string,
		evidenceKey: string,
		severity: AnalysisGate["severity"] = "pause",
	) => gates.push({ code, message, evidenceKey, severity });
	if (!input.contrastResolved)
		gate("scientific-ambiguity", "The primary comparison or contrast is not resolved.", "contrastResolved");
	if (!input.referenceResolved)
		gate(
			"reference-mismatch",
			"The reference or annotation version is not resolved.",
			"referenceResolved",
			"block",
		);
	const counts = input.biologicalReplicates;
	if (
		counts.length < 2 ||
		counts.some((item) => !item.group.trim() || !Number.isInteger(item.count) || item.count < 1) ||
		new Set(counts.map((item) => item.group.trim())).size !== counts.length
	)
		gate(
			"missing-data",
			"At least two distinct groups with positive biological replicate counts are required for this comparison.",
			"biologicalReplicates",
		);
	const insufficient = counts.filter((item) => item.count < 2);
	if (insufficient.length) {
		const detail = insufficient.map((item) => `${item.group} (n=${item.count})`).join(", ");
		if (input.mode === "inferential")
			gate(
				"missing-biological-replicates",
				`This bulk RNA-seq screening policy requires at least 2 biological replicates per group; ${detail} does not meet this gate.`,
				"biologicalReplicates",
			);
		else
			warnings.push(
				`Exploratory output only: ${detail} has fewer than 2 biological replicates; inferential claims are disabled.`,
			);
	}
	return {
		ok: gates.length === 0,
		gates,
		warnings,
		inferentialClaimsAllowed: input.mode === "inferential" && gates.length === 0,
	};
}

export class BulkRnaseqAdapter implements AnalysisAdapter {
	readonly identity = { id: "bulk-rnaseq", version: "1.0.0" };
	readonly contract = {
		schemaVersion: 1 as const,
		assay: "bulk-rnaseq",
		domain: "transcriptomics" as const,
		researchStages: ["design", "readiness", "execution", "review", "delivery"] as const,
		inputs: [
			{ id: "count-matrix", type: "table" as const, required: true, formats: ["tsv", "csv", "parquet"] },
			{ id: "sample-design", type: "metadata" as const, required: true },
		],
		outputs: [
			{ id: "differential-results", type: "table" as const, required: true, formats: ["tsv"] },
			{ id: "summary", type: "report" as const, required: false, formats: ["md", "html"] },
		],
		capabilities: ["analysis", "files", "coding"],
		sideEffects: ["read-only", "code-execution", "project-write"],
		evidenceTypes: ["sample-design", "differential-results", "dispersion-diagnostic"],
		workflow: { id: "drone/pasilla-deseq2", version: "1.0.0" },
	} as const;
	readonly reviewInstructions =
		"Review bulk RNA-seq sample/design correspondence, count and result evidence. Biological replication is distinct from technical lanes. Fixed-dispersion diagnostic results only support exploratory observations; never formal differential-expression claims. Preserve all supplied limitations. The replicate gate is screening, not proof of statistical power.";
	supports(assay: string): boolean {
		return assay === "bulk-rnaseq";
	}
	buildPlan(context: AnalysisContext, spec: AnalysisComputePlanInput, value: unknown): AnalysisAdapterPlan {
		const evidence = recordEvidence(value);
		const method = methodIdentity(evidence.method);
		if (!["DESeq2", "DESeq2/fixed-dispersion-diagnostic"].includes(method.id))
			throw new Error("Bulk RNA-seq adapter requires an explicit supported DESeq2 method");
		const units = new Map<string, Set<string>>();
		const groupsByUnit = new Map<string, string>();
		if (typeof evidence.groupColumn !== "string" || typeof evidence.biologicalUnitColumn !== "string")
			throw new Error("Bulk RNA-seq requires group and biological-unit columns");
		for (const row of spec.dataDesign?.rows ?? []) {
			const group = row[evidence.groupColumn];
			const unit = row[evidence.biologicalUnitColumn];
			if (typeof group !== "string" || !group.trim() || typeof unit !== "string" || !unit.trim())
				throw new Error("Every sample requires an explicit group and biological-unit identifier");
			if (groupsByUnit.has(unit) && groupsByUnit.get(unit) !== group)
				throw new Error("Paired/repeated biological units require a dedicated design policy");
			groupsByUnit.set(unit, group);
			const groupUnits = units.get(group) ?? new Set<string>();
			groupUnits.add(unit);
			units.set(group, groupUnits);
		}
		const biologicalReplicates = [...units].map(([group, members]) => ({ group, count: members.size }));
		const assessment = assessBulkRnaseqReadiness({
			mode: context.mode,
			contrastResolved: evidence.contrastResolved === true,
			referenceResolved: evidence.referenceResolved === true,
			biologicalReplicates,
		});
		// Exploratory mode never waives the selected method's replicate requirement.
		if (
			(method.id === "DESeq2" && biologicalReplicates.some((item) => item.count < 2)) ||
			(method.id.includes("fixed-dispersion") && context.mode !== "exploratory")
		) {
			return {
				method,
				requiredOutputs: requiredOutputs(spec),
				adapterSnapshotSha256: adapterSnapshotSha256(this),
				assessment: {
					...assessment,
					ok: false,
					inferentialClaimsAllowed: false,
					gates: [
						...assessment.gates,
						{
							code: "missing-biological-replicates",
							severity: "pause",
							message:
								"Selected DESeq2 method is incompatible with this replication/mode; revise the method explicitly.",
							evidenceKey: "method",
						},
					],
				},
			};
		}
		return {
			method,
			requiredOutputs: requiredOutputs(spec),
			assessment,
			adapterSnapshotSha256: adapterSnapshotSha256(this),
		};
	}
	reviewResults(
		_context: AnalysisContext,
		artifacts: readonly AnalysisArtifactEvidence[],
	): readonly AnalysisReviewCheck[] {
		const result = artifacts.find((item) => /(^|\/)results\.tsv$/.test(item.path));
		const header = result?.text?.split(/\r?\n/)[0]?.split("\t") ?? [];
		return [
			{
				id: "rnaseq-result-table",
				passed: header.includes("log2FoldChange") && Boolean(result?.text?.trim().includes("\n")),
				detail:
					"DESeq2 results.tsv must include log2FoldChange and observed rows; scientific interpretation remains a model review responsibility.",
			},
		];
	}
}
