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
const entries = {};
for (const name of outputs) {
	const source = name.replace(/\.mjs$/, ".ts");
	entries[name] = {
		source: `packages/knowledge/src/${source}`,
		sha256: createHash("sha256").update(await readFile(resolve(outDir, name))).digest("hex"),
	};
}
await writeFile(resolve(outDir, ".build-manifest.json"), `${JSON.stringify({version: 1, generator: "scripts/build-knowledge-runtime.mjs", entries}, null, "\t")}\n`);
console.log(`built ${outputs.length} knowledge entries in ${relative(root, outDir)} (worker isolated)`);
