import type { ComputeAnalysisPlan, ComputeDataDesignContract, ComputeSampleSheet } from "@drone/shared";
import { describe, expect, it } from "vitest";
import {
	analysisPlanHash,
	buildROCrateManifest,
	checkAnalysisPlanDeviation,
	checkConfounding,
	estimatePower,
	exportROCrate,
	registerDatasetVersion,
	reviewRecordChange,
	sampleSheetSchemaHash,
	validateDataDesign,
	validateSampleSheet,
} from "../src/dataset";

const checksum = "a".repeat(64);
const files = [
	{ path: "results/b.txt", bytes: 12, sha256: checksum },
	{ path: "inputs/a.txt", bytes: 4, sha256: "b".repeat(64), mediaType: "text/plain" },
] as const;

const plan: ComputeAnalysisPlan = {
	id: "analysis-v1",
	version: 1,
	outcome: "response",
	design: "two-group",
	primaryTest: "two-sample t test",
	alpha: 0.05,
	targetPower: 0.8,
	effectSize: 0.6,
	totalSampleSize: 90,
	groups: ["control", "treated"],
	sampleSheetSchemaId: "sample-v1",
};

const schema: ComputeSampleSheet = {
	id: "sample-v1",
	version: 1,
	idColumn: "sampleId",
	columns: [
		{ name: "sampleId", type: "string", required: true, unique: true },
		{ name: "treatment", type: "string", required: true, allowedValues: ["control", "treated"] },
		{ name: "batch", type: "string", required: true },
		{ name: "age", type: "integer" },
	],
};

const balancedRows = [
	{ sampleId: "s1", treatment: "control", batch: "b1", age: 30 },
	{ sampleId: "s2", treatment: "control", batch: "b2", age: 31 },
	{ sampleId: "s3", treatment: "treated", batch: "b1", age: 30 },
	{ sampleId: "s4", treatment: "treated", batch: "b2", age: 32 },
] as const;

describe("B7 dataset and design contracts", () => {
	it("creates a deterministic content address independent of file order", () => {
		const first = registerDatasetVersion({ datasetId: "study", files, createdAt: "2026-10-03T00:00:00Z" });
		const second = registerDatasetVersion({
			datasetId: "study",
			files: [...files].reverse(),
			createdAt: "2027-01-01T00:00:00Z",
		});
		expect(first.versionId).toBe(second.versionId);
		expect(first.contentSha256).toHaveLength(64);
		expect(first.sizeBytes).toBe(16);
		expect(() =>
			registerDatasetVersion({ datasetId: "study", files: [{ ...files[0], path: "../escape" }] }),
		).toThrow();
		expect(() =>
			registerDatasetVersion({ datasetId: "study", files: [{ ...files[0], path: "/absolute" }] }),
		).toThrow();
		expect(() =>
			registerDatasetVersion({
				datasetId: "study",
				files,
				source: { kind: "public", uri: "file:///secret" },
			}),
		).toThrow();
	});

	it("fails sample-sheet schema violations without coercing values", () => {
		const valid = validateSampleSheet(balancedRows, schema);
		expect(valid.ok).toBe(true);
		const invalid = validateSampleSheet(
			[
				{ sampleId: "s1", treatment: "unknown", batch: "b1", age: "30" },
				{ sampleId: "s1", treatment: "control", batch: "b2", age: 31 },
			],
			schema,
		);
		expect(invalid.ok).toBe(false);
		expect(invalid.errors.map((entry) => entry.code)).toEqual(
			expect.arrayContaining(["invalid-value", "invalid-type", "duplicate-value"]),
		);
	});

	it("detects treatment and batch confounding while accepting a crossed design", () => {
		const confounded = checkConfounding(
			[
				{ sampleId: "s1", treatment: "control", batch: "b1" },
				{ sampleId: "s2", treatment: "control", batch: "b1" },
				{ sampleId: "s3", treatment: "treated", batch: "b2" },
				{ sampleId: "s4", treatment: "treated", batch: "b2" },
			],
			"treatment",
			"batch",
		);
		expect(confounded.ok).toBe(false);
		expect(confounded.findings.some((finding) => finding.code === "confounded")).toBe(true);
		const balanced = checkConfounding(balancedRows, { treatment: "treatment", blockingFactors: ["batch"] });
		expect(balanced.ok).toBe(true);
		expect(balanced.matrixRank).toBe(balanced.matrixColumns);
	});

	it("returns bounded power and minimum-detectable-effect planning estimates", () => {
		const estimate = estimatePower({ effectSize: 0.6, alpha: 0.05, targetPower: 0.8 });
		expect(estimate.method).toBe("normal-approximation-two-independent-means");
		expect(estimate.requiredTotalSampleSize).toBeGreaterThan(2);
		expect(estimate.minimumDetectableEffect).toBeGreaterThan(0);
		expect(
			estimatePower({ effectSize: 0.6, totalSampleSize: estimate.requiredTotalSampleSize + 20 })
				.estimatedPower,
		).toBeGreaterThanOrEqual(estimate.estimatedPower);
		expect(() => estimatePower({ effectSize: 0, totalSampleSize: 10 })).toThrow();
	});

	it("requires review when a plan or immutable record changes", () => {
		expect(checkAnalysisPlanDeviation(plan, { ...plan, effectSize: 0.9 }).ok).toBe(false);
		expect(
			reviewRecordChange(
				{ versionId: "sha256:a", effectSize: 0.6 },
				{ versionId: "sha256:b", effectSize: 0.6 },
			).requiresReview,
		).toBe(true);
		expect(reviewRecordChange({ createdAt: "one" }, { createdAt: "two" }).requiresReview).toBe(false);
	});

	it("exports a deterministic RO-Crate and validates design references", () => {
		const dataset = registerDatasetVersion({ datasetId: "study", files });
		const fetchRecord = {
			id: "fetch-1",
			uri: "https://data.example.org/study.tsv",
			source: "example",
			termsAccepted: true,
			fetchedAt: "2026-10-03T00:00:00Z",
			bytes: 16,
			sha256: checksum,
		} as const;
		const contract: ComputeDataDesignContract = {
			datasetVersion: { datasetId: dataset.datasetId, versionId: dataset.versionId },
			sampleSheetSchemaId: schema.id,
			sampleSheetSha256: sampleSheetSchemaHash(schema),
			analysisPlanId: plan.id,
			analysisPlanSha256: analysisPlanHash(plan),
			fetchRecordIds: [fetchRecord.id],
		};
		const checked = validateDataDesign(
			{ dataset, sampleSheet: schema, rows: balancedRows, analysisPlan: plan, fetchRecords: [fetchRecord] },
			contract,
		);
		expect(checked.ok).toBe(true);
		const manifest = buildROCrateManifest({
			dataset,
			sampleSheet: schema,
			analysisPlan: plan,
			fetchRecords: [fetchRecord],
			designContract: contract,
		});
		expect(manifest["@graph"].some((entity) => entity["@id"] === "ro-crate-metadata.json")).toBe(true);
		expect(
			exportROCrate({ dataset, sampleSheet: schema, analysisPlan: plan, fetchRecords: [fetchRecord] }),
		).toBe(exportROCrate({ dataset, sampleSheet: schema, analysisPlan: plan, fetchRecords: [fetchRecord] }));
		expect(() =>
			buildROCrateManifest({
				dataset: { ...dataset, contentSha256: "f".repeat(64) },
				fetchRecords: [fetchRecord],
			}),
		).toThrow();
	});
});
