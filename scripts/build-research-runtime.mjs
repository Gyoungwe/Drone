import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const expectedDir = resolve(root, ".pi/lib");
const check = process.argv.includes("--check");
const outputDir = check ? await mkdtemp(resolve(tmpdir(), "drone-research-runtime-check-")) : expectedDir;
const entries = {
	"open-access": "packages/research/src/open-access.ts",
	"literature-receipt": "packages/research/src/literature-receipt.ts",
	"literature-operations-core": "packages/research/src/literature-operations.ts",
	"evidence-gate": "packages/research/src/evidence-gate.ts",
	"run-provenance": "packages/research/src/run-provenance.ts",
	"source-delivery": "packages/research/src/source-delivery.ts",
	"claim-bindings": "packages/research/src/claim-bindings.ts",
	"research-receipt-core": "packages/research/src/receipt-journal.ts",
	"source-archive-core": "packages/research/src/source-archive.ts",
	"institutional-access-core": "packages/research/src/institutional-access.ts",
	"research-loop-core": "packages/research/src/research-loop.ts",
	"zotero-setup": "packages/research/src/zotero-setup-runtime.ts",
	"zotero-reconcile": "packages/research/src/zotero-reconcile-runtime.ts",
	"zotero-write": "packages/research/src/zotero-write-runtime.ts",
};

try {
	await mkdir(outputDir, { recursive: true });
	for (const [name, relativeEntry] of Object.entries(entries)) {
		await build({
			entryPoints: [resolve(root, relativeEntry)],
			outfile: resolve(outputDir, `${name}.mjs`),
			bundle: true,
			format: "esm",
			platform: "node",
			packages: "bundle",
			sourcemap: false,
			logLevel: "silent",
		});
	}
	if (check) {
		const stale = [];
		for (const name of Object.keys(entries)) {
			const actual = await readFile(resolve(outputDir, `${name}.mjs`));
			const expected = await readFile(resolve(expectedDir, `${name}.mjs`));
			if (!actual.equals(expected)) stale.push(`${name}.mjs`);
		}
		if (stale.length > 0) throw new Error(`research runtime artifacts are stale: ${stale.join(", ")}`);
		console.log("research runtime artifacts are up to date");
	} else {
		for (const [name, relativeEntry] of Object.entries(entries))
			console.log(`built .pi/lib/${name}.mjs from ${relativeEntry}`);
	}
} finally {
	if (check) await rm(outputDir, { recursive: true, force: true });
}
