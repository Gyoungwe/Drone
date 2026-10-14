import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);
const repo = new URL("../..", import.meta.url).pathname;
const digest = `sha256:${"a".repeat(64)}`;

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "drone-rnaseq-smoke-"));
	const bin = join(root, "bin");
	await mkdir(bin);
	await writeFile(
		join(bin, "nextflow"),
		`#!/bin/sh
if [ "\${1:-}" = "-version" ]; then
  echo "nextflow 24.10.5"
  exit 0
fi
outdir=""
report=""
trace=""
timeline=""
dag=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --outdir) outdir="$2"; shift 2 ;;
    -with-report) report="$2"; shift 2 ;;
    -with-trace) trace="$2"; shift 2 ;;
    -with-timeline) timeline="$2"; shift 2 ;;
    -with-dag) dag="$2"; shift 2 ;;
    *) shift ;;
  esac
done
mkdir -p "$outdir/results"
printf '<html>multiqc</html>\\n' > "$outdir/results/multiqc_report.html"
printf 'sample\\tcount\\nfixture\\t1\\n' > "$outdir/results/salmon.merged.gene_counts.tsv"
printf 'trace\\n' > "$trace"
printf 'report\\n' > "$report"
printf 'timeline\\n' > "$timeline"
printf 'dag\\n' > "$dag"
if [ "\${FAKE_NEXTFLOW_MISSING:-}" = "1" ]; then
  rm -f "$outdir/results/salmon.merged.gene_counts.tsv"
fi
if [ "\${FAKE_NEXTFLOW_FAIL:-}" = "1" ]; then
  exit 9
fi
exit 0
`,
	);
	await chmod(join(bin, "nextflow"), 0o755);
	const samplesheet = join(root, "samplesheet.csv");
	await writeFile(samplesheet, "sample,condition\nfixture,control\n");
	return { root, bin, samplesheet };
}

async function runSmoke(outdir, fx, extra = {}) {
	const env = {
		...process.env,
		PATH: `${fx.bin}:${process.env.PATH ?? ""}`,
		DRONE_RNASEQ_OUTDIR: outdir,
		DRONE_RNASEQ_SAMPLESHEET: fx.samplesheet,
		DRONE_RNASEQ_ATTEMPT_ID: "attempt-1",
		DRONE_RNASEQ_CONTAINER_DIGESTS: JSON.stringify({ "nf-core/rnaseq": digest }),
		...extra,
	};
	try {
		return await exec("sh", [join(repo, "scripts/b3-pipeline/run-rnaseq-smoke.sh")], {
			cwd: repo,
			env,
			maxBuffer: 1024 * 1024,
		});
	} catch (error) {
		return error;
	}
}

test("records a complete real-smoke receipt with input and artifact hashes", {
	skip: process.platform === "win32",
}, async () => {
	const fx = await fixture();
	const outdir = join(fx.root, "success");
	const result = await runSmoke(outdir, fx);
	assert.equal(result.code ?? 0, 0, result.stderr);
	const receipt = JSON.parse(await readFile(join(outdir, "provenance.json"), "utf8"));
	assert.equal(receipt.schemaVersion, 2);
	assert.equal(receipt.executionStatus, "succeeded");
	assert.equal(receipt.attemptId, "attempt-1");
	assert.equal(receipt.nextflowVersion, "nextflow 24.10.5");
	assert.equal(receipt.scientificallyVerified, false);
	assert.equal(receipt.qcStatus, "pending");
	assert.equal(receipt.reviewStatus, "pending");
	assert.equal(
		receipt.inputManifest[0].sha256,
		"c9c9aed291f827ddbb073a6b7401a8440e419b0dc319355d473c0f41dce2256a",
	);
	assert.equal(receipt.requiredArtifacts.counts, true);
	assert.equal(receipt.requiredArtifacts.multiqc, true);
	assert.ok(receipt.artifactManifest.some((entry) => entry.path === "results/multiqc_report.html"));
	const retry = await runSmoke(outdir, fx);
	assert.equal(retry.code, 2);
	assert.match(retry.stderr, /must be empty/);
});

test("persists a failed attempt and never turns it into a success", {
	skip: process.platform === "win32",
}, async () => {
	const fx = await fixture();
	const outdir = join(fx.root, "failed");
	const result = await runSmoke(outdir, fx, { FAKE_NEXTFLOW_FAIL: "1" });
	assert.equal(result.code, 1);
	const receipt = JSON.parse(await readFile(join(outdir, "provenance.json"), "utf8"));
	assert.equal(receipt.executionStatus, "failed");
	assert.equal(receipt.failure.code, "nextflow-failed");
	assert.equal(receipt.nextflowExitCode, 9);
});

test("blocks a process that exits cleanly without the required count artifact", {
	skip: process.platform === "win32",
}, async () => {
	const fx = await fixture();
	const outdir = join(fx.root, "incomplete");
	const result = await runSmoke(outdir, fx, { FAKE_NEXTFLOW_MISSING: "1" });
	assert.equal(result.code, 1);
	const receipt = JSON.parse(await readFile(join(outdir, "provenance.json"), "utf8"));
	assert.equal(receipt.executionStatus, "failed");
	assert.equal(receipt.failure.code, "missing-required-artifacts");
	assert.deepEqual(receipt.failure.missing, ["counts"]);
});
