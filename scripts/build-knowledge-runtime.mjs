import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const sourceDir = resolve(root, "packages/knowledge/src");
const outDir = resolve(root, ".pi/lib/knowledge/runtime");
const sourceNames = (await readdir(sourceDir)).filter((name) => name.endsWith(".ts") && name !== "worker.ts");
const entryPoints = sourceNames.map((name) => resolve(sourceDir, name));
await mkdir(outDir, { recursive: true });
await build({
	entryPoints,
	outdir: outDir,
	bundle: true,
	splitting: true,
	format: "esm",
	platform: "node",
	outExtension: { ".js": ".mjs" },
	chunkNames: "chunks/[name]-[hash]",
	sourcemap: false,
	logLevel: "silent",
});
await build({
	entryPoints: [resolve(sourceDir, "worker.ts")],
	outfile: resolve(outDir, "worker.mjs"),
	bundle: true,
	format: "esm",
	platform: "node",
	sourcemap: false,
	logLevel: "silent",
});
const outputs = (await readdir(outDir)).filter((name) => name.endsWith(".mjs")).sort();
const generatedFiles = (await readdir(outDir, { recursive: true }))
	.filter((name) => name.endsWith(".mjs"));
const entries = {};
for (const name of generatedFiles) {
	// Bundled ESM artifacts are checked through the legacy .pi compatibility
	// wrappers.  Keep the generated bundle itself out of checkJs inference:
	// source typing is enforced by the package TypeScript build instead.
	const outputPath = resolve(outDir, name);
	const output = await readFile(outputPath, "utf8");
	if (!output.startsWith("// @ts-nocheck")) {
		await writeFile(outputPath, `// @ts-nocheck\n${output}`);
	}
	if (!outputs.includes(name)) continue;
	const source = name.replace(/\.mjs$/, ".ts");
	entries[name] = {
		source: `packages/knowledge/src/${source}`,
		sha256: createHash("sha256").update(await readFile(outputPath)).digest("hex"),
	};
}
await writeFile(resolve(outDir, ".build-manifest.json"), `${JSON.stringify({version: 1, generator: "scripts/build-knowledge-runtime.mjs", entries}, null, "\t")}\n`);
console.log(`built ${outputs.length} knowledge entries in ${relative(root, outDir)} (worker isolated)`);
