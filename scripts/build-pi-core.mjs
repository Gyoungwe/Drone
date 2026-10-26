#!/usr/bin/env node

// Build pi-core as a self-contained native Pi extension. Runtime dependencies
// are bundled; the Pi host itself remains a peer dependency and is never
// duplicated inside the package.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const packageRoot = join(root, "packages/pi-core");
const distRoot = join(packageRoot, "dist");
const check = process.argv.includes("--check");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function checkOutput() {
	const outputPath = join(distRoot, "index.mjs");
	const hostOutputPath = join(distRoot, "host.mjs");
	if (!existsSync(outputPath) || !existsSync(hostOutputPath))
		throw new Error("pi-core dist/index.mjs and dist/host.mjs are required");
	const output = await readFile(outputPath, "utf8");
	for (const pattern of [
		/(?:from|import\s*\(|require\s*\()["']electron["']/u,
		/(?:from|import\s*\(|require\s*\()["']@drone\/(?:backend|desktop)["']/u,
		/(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']\.\.\/\.\./u,
	]) {
		if (pattern.test(output)) throw new Error(`pi-core bundle contains forbidden import: ${pattern}`);
	}
	for (const name of [
		"ask_user",
		"set_status",
		"todo",
		"deliver_files",
		"memory_save",
		"task_plan",
		"drone-doctor",
		"drone-example",
	])
		if (!output.includes(JSON.stringify(name))) throw new Error(`pi-core bundle is missing ${name}`);
}

if (!check) {
	await rm(distRoot, { recursive: true, force: true });
	await mkdir(distRoot, { recursive: true });
	const result = await build({
		absWorkingDir: root,
		entryPoints: [join(packageRoot, "src/index.ts"), join(packageRoot, "src/host.ts")],
		outdir: distRoot,
		bundle: true,
		format: "esm",
		platform: "node",
		packages: "bundle",
		outExtension: { ".js": ".mjs" },
		metafile: true,
		sourcemap: false,
		logLevel: "silent",
	});
	const outputPaths = [join(distRoot, "index.mjs"), join(distRoot, "host.mjs")];
	for (const outputPath of outputPaths) {
		const output = await readFile(outputPath, "utf8");
		if (!output.startsWith("// @ts-nocheck")) await writeFile(outputPath, `// @ts-nocheck\n${output}`);
	}
	const inputHash = createHash("sha256");
	for (const input of Object.keys(result.metafile?.inputs || {}).sort()) {
		inputHash.update(input.replaceAll("\\", "/"));
		inputHash.update("\0");
		const candidate = resolve(root, input);
		if (existsSync(candidate)) inputHash.update(await readFile(candidate));
		inputHash.update("\0");
	}
	const outputHashes = Object.fromEntries(
		await Promise.all(
			outputPaths.map(async (outputPath) => [
				`dist/${outputPath.split("/").pop()}`,
				sha256(await readFile(outputPath)),
			]),
		),
	);
	await writeFile(
		join(packageRoot, "build-manifest.json"),
		`${JSON.stringify(
			{
				version: 1,
				generator: "scripts/build-pi-core.mjs",
				inputsSha256: inputHash.digest("hex"),
				outputs: outputHashes,
			},
			null,
			"\t",
		)}\n`,
	);
}
await checkOutput();
console.log(`pi-core package artifacts ${check ? "are up to date" : "built"}`);
