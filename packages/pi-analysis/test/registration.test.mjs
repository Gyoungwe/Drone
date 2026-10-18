import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const extension = await import(pathToFileURL(join(root, "dist/index.mjs")).href);

const tools = new Map();
const registered = extension.default({
	registerTool(tool) {
		tools.set(tool.name, tool);
	},
});
assert.deepEqual(registered.tools, ["analysis_list_adapters", "analysis_assess_readiness"]);
assert.deepEqual([...tools.keys()], registered.tools);

const listed = await tools.get("analysis_list_adapters").execute("list", {});
assert.equal(listed.details.adapters.length, 2);
assert.deepEqual(
	listed.details.adapters.map((item) => item.identity.id),
	["assembly", "bulk-rnaseq"],
);

const ready = await tools.get("analysis_assess_readiness").execute("ready", {
	id: "assembly-ready",
	question: "Assemble reads",
	assay: "assembly",
	mode: "exploratory",
	spec: {
		outputs: [
			"assembly/contigs.fasta",
			"assembly/assembly-metrics.json",
			"assembly/busco.json",
			"assembly/contamination.json",
		],
		dataDesign: { dataset: { files: ["reads-1.fastq.gz"] }, rows: [{ sample: "reads-1" }] },
	},
	evidence: { readsValidated: true, assemblyGoalResolved: true, method: { id: "spades", version: "4.0.0" } },
});
assert.equal(ready.details.status, "ready");
assert.equal(ready.details.execution, "host-required");

const blocked = await tools.get("analysis_assess_readiness").execute("blocked", {
	id: "assembly-blocked",
	question: "Assemble reads",
	assay: "assembly",
	mode: "exploratory",
	spec: { outputs: ["assembly/contigs.fasta"], dataDesign: { dataset: { files: [] }, rows: [] } },
	evidence: {
		readsValidated: false,
		assemblyGoalResolved: false,
		method: { id: "spades", version: "4.0.0" },
	},
});
assert.equal(blocked.details.status, "blocked");
assert.equal(blocked.details.assessment.ok, false);

const bulkReady = await tools.get("analysis_assess_readiness").execute("bulk-ready", {
	id: "bulk-ready",
	question: "Compare treatment groups",
	assay: "bulk-rnaseq",
	mode: "inferential",
	spec: {
		outputs: ["results.tsv"],
		dataDesign: {
			dataset: { files: [{ path: "counts.tsv" }] },
			rows: [
				{ group: "control", unit: "c1" },
				{ group: "control", unit: "c2" },
				{ group: "treated", unit: "t1" },
				{ group: "treated", unit: "t2" },
			],
		},
	},
	evidence: {
		method: { id: "DESeq2", version: "1.0.0" },
		groupColumn: "group",
		biologicalUnitColumn: "unit",
		contrastResolved: true,
		referenceResolved: true,
	},
});
assert.equal(bulkReady.details.status, "ready");

const review = new extension.AssemblyAdapter().reviewResults(
	{ version: 1, id: "assembly-review", question: "Review", assay: "assembly", mode: "exploratory" },
	[
		{ path: "assembly/contigs.fasta", text: ">contig-1\nACGT" },
		{
			path: "assembly/assembly-metrics.json",
			text: JSON.stringify({ totalLength: 100, contigs: 1, n50: 100 }),
		},
		{
			path: "assembly/busco.json",
			text: JSON.stringify({ complete: 90, fragmented: 5, duplicated: 2, missing: 3 }),
		},
		{ path: "assembly/contamination.json", text: JSON.stringify({ contaminationRate: 0.01 }) },
	],
);
assert.ok(review.every((check) => check.passed));

const bundle = await readFile(join(root, "dist/index.mjs"), "utf8");
assert(!bundle.includes("@drone/backend"));
assert(!bundle.includes("electron"));
console.log("pi-analysis registration and readiness smoke passed");
