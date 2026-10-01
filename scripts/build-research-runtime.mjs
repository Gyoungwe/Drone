import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const outputDir = resolve(root, ".pi/lib");
const entries = {
	"open-access": "packages/research/src/open-access.ts",
	"literature-receipt": "packages/research/src/literature-receipt.ts",
	"evidence-gate": "packages/research/src/evidence-gate.ts",
	"run-provenance": "packages/research/src/run-provenance.ts",
	"source-delivery": "packages/research/src/source-delivery.ts",
	"claim-bindings": "packages/research/src/claim-bindings.ts",
	"research-receipt-core": "packages/research/src/receipt-journal.ts",
	"source-archive-core": "packages/research/src/source-archive.ts",
	"research-loop-core": "packages/research/src/research-loop.ts",
};

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
	console.log(`built .pi/lib/${name}.mjs from ${relativeEntry}`);
}
