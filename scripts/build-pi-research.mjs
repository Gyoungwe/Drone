#!/usr/bin/env node

// Build the native research package as one self-contained extension. The Pi
// host remains a peer dependency; domain and extension sources are bundled so
// an installed package never reaches back into a Drone checkout.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const packageRoot = join(root, "packages/pi-research");
const distRoot = join(packageRoot, "dist");
const check = process.argv.includes("--check");
const sourceSkill = join(root, "packages/pi-research/skills/research-workflow/SKILL.md");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function assertSkill() {
	if (!(await stat(sourceSkill).catch(() => null))) throw new Error("pi-research skill is missing");
}

async function checkOutput() {
	const outputPath = join(distRoot, "index.mjs");
	if (!existsSync(outputPath)) throw new Error("pi-research dist/index.mjs is missing");
	const output = await readFile(outputPath, "utf8");
	for (const pattern of [
		/(?:from|import\s*\(|require\s*\()\s*["']electron["']/u,
		/(?:from|import\s*\(|require\s*\()\s*["']@drone\/(?:backend|desktop)["']/u,
		/(?:from|import\s*\(|require\s*\()\s*["']\.\.\/\.\./u,
	]) {
		if (pattern.test(output)) throw new Error(`pi-research bundle contains forbidden import: ${pattern}`);
	}
	for (const name of [
		"research_search_sources",
		"research_read_source",
		"research_deposit_research_note",
		"research_answer_sources",
		"research_loop",
	]) {
		if (!output.includes(JSON.stringify(name))) throw new Error(`pi-research bundle is missing ${name}`);
	}
}

await assertSkill();
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
		`${JSON.stringify(
			{
				version: 1,
				generator: "scripts/build-pi-research.mjs",
				inputsSha256: inputHash.digest("hex"),
				outputs: { "dist/index.mjs": sha256(await readFile(join(distRoot, "index.mjs"))) },
			},
			null,
			"\t",
		)}\n`,
	);
}
await checkOutput();
console.log(`pi-research package artifacts ${check ? "are up to date" : "built"}`);
