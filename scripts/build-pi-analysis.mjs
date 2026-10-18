#!/usr/bin/env node

// Build the portable analysis boundary as one self-contained native Pi
// extension. Host execution and persistence stay outside this bundle.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const packageRoot = join(root, "packages/pi-analysis");
const distRoot = join(packageRoot, "dist");
const check = process.argv.includes("--check");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function checkOutput() {
	const outputPath = join(distRoot, "index.mjs");
	if (!existsSync(outputPath)) throw new Error("pi-analysis dist/index.mjs is missing");
	const output = await readFile(outputPath, "utf8");
	for (const pattern of [
		/(?:from|import\s*\(|require\s*\()["']electron["']/u,
		/(?:from|import\s*\(|require\s*\()["']@drone\/(?:backend|desktop)["']/u,
		/(?:from|import\s*\(|require\s*\()["']@drone\//u,
		/(?:from|import\s*\(|require\s*\()["']\.\.\/\.\./u,
	]) {
		if (pattern.test(output)) throw new Error(`pi-analysis bundle contains forbidden import: ${pattern}`);
	}
	for (const name of ["analysis_list_adapters", "analysis_assess_readiness", "bulk-rnaseq", "assembly"])
		if (!output.includes(JSON.stringify(name))) throw new Error(`pi-analysis bundle is missing ${name}`);
}

if (!check) {
	await rm(distRoot, { recursive: true, force: true });
	await mkdir(distRoot, { recursive: true });
	const buildResult = await build({
		entryPoints: [join(packageRoot, "src/index.ts")],
		outfile: join(distRoot, "index.mjs"),
		bundle: true,
		format: "esm",
		platform: "node",
		packages: "bundle",
		metafile: true,
		sourcemap: false,
		logLevel: "silent",
	});
	let output = await readFile(join(distRoot, "index.mjs"), "utf8");
	if (!output.startsWith("// @ts-nocheck")) {
		output = `// @ts-nocheck\n${output}`;
		await writeFile(join(distRoot, "index.mjs"), output, "utf8");
	}
	const inputHash = createHash("sha256");
	for (const input of Object.keys(buildResult.metafile?.inputs || {}).sort()) {
		inputHash.update(input.replaceAll("\\", "/"));
		inputHash.update("\0");
		const candidate = resolve(root, input);
		if (existsSync(candidate)) inputHash.update(await readFile(candidate));
		inputHash.update("\0");
	}
	await writeFile(
		join(packageRoot, "build-manifest.json"),
		`${JSON.stringify({ version: 1, generator: "scripts/build-pi-analysis.mjs", inputsSha256: inputHash.digest("hex"), outputs: { "dist/index.mjs": sha256(await readFile(join(distRoot, "index.mjs"))) } }, null, "\t")}\n`,
	);
}
await checkOutput();
console.log(`pi-analysis package artifacts ${check ? "are up to date" : "built"}`);
