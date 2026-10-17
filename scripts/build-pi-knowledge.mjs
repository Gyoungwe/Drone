#!/usr/bin/env node

// Build the first native Pi package. The output is deliberately self-contained:
// the extension bundle contains the Drone knowledge domain and the worker is a
// package-local resource, so an installed package never reaches back into a
// Drone checkout or a .pi compatibility directory.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const packageRoot = join(root, "packages/pi-knowledge");
const sourceRoot = join(packageRoot, "src");
const distRoot = join(packageRoot, "dist");
const workerRoot = join(packageRoot, "lib/knowledge/runtime");
const check = process.argv.includes("--check");
const sourceSkills = [join(root, "packages/desktop/resources/skills"), join(root, ".pi/skills")];
const skillNames = ["research-vault", "research-workflow", "research-show-me"];

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const readBytes = (path) => readFile(path);
const isFile = async (path) => {
	try {
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
};

async function snapshot(directory) {
	const files = new Map();
	if (!existsSync(directory)) return files;
	const walk = async (current, prefix = "") => {
		for (const entry of await readdir(current, { withFileTypes: true })) {
			const path = join(current, entry.name);
			const name = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) await walk(path, name);
			else if (entry.isFile()) files.set(name, await readBytes(path));
		}
	};
	await walk(directory);
	return files;
}

async function findSkill(name) {
	for (const base of sourceSkills) {
		const candidate = join(base, name, "SKILL.md");
		if (await isFile(candidate)) return candidate;
	}
	throw new Error(`Knowledge skill source is missing: ${name}/SKILL.md`);
}

async function syncSkills() {
	const expected = new Map();
	for (const name of skillNames) expected.set(`${name}/SKILL.md`, await readBytes(await findSkill(name)));
	const actual = await snapshot(join(packageRoot, "skills"));
	const mismatch = [...new Set([...expected.keys(), ...actual.keys()])].filter(
		(name) => !expected.has(name) || !actual.has(name) || !expected.get(name).equals(actual.get(name)),
	);
	if (check) {
		if (mismatch.length) throw new Error(`pi-knowledge skills are stale: ${mismatch.join(", ")}`);
		return;
	}
	await rm(join(packageRoot, "skills"), { recursive: true, force: true });
	for (const [name, bytes] of expected) {
		const target = join(packageRoot, "skills", name.replace(/\/SKILL\.md$/, ""));
		await mkdir(target, { recursive: true });
		await writeFile(join(target, "SKILL.md"), bytes);
	}
}

async function buildBundle() {
	await mkdir(distRoot, { recursive: true });
	const extension = await build({
		entryPoints: [join(sourceRoot, "index.ts")],
		outfile: join(distRoot, "index.mjs"),
		bundle: true,
		format: "esm",
		platform: "node",
		packages: "bundle",
		metafile: true,
		sourcemap: false,
		logLevel: "silent",
	});
	const worker = await build({
		entryPoints: [join(root, "packages/knowledge/src/worker.ts")],
		outfile: join(workerRoot, "worker.mjs"),
		bundle: true,
		format: "esm",
		platform: "node",
		metafile: true,
		sourcemap: false,
		logLevel: "silent",
	});
	for (const output of [join(distRoot, "index.mjs"), join(workerRoot, "worker.mjs")]) {
		const text = await readFile(output, "utf8");
		if (!text.startsWith("// @ts-nocheck")) await writeFile(output, `// @ts-nocheck\n${text}`);
	}
	const inputs = new Set([
		...Object.keys(extension.metafile?.inputs || {}),
		...Object.keys(worker.metafile?.inputs || {}),
	]);
	const inputHash = createHash("sha256");
	for (const input of [...inputs].sort()) {
		inputHash.update(input.replaceAll("\\", "/"));
		inputHash.update("\0");
		inputHash.update(await readBytes(resolve(root, input)));
		inputHash.update("\0");
	}
	const manifest = {
		version: 1,
		generator: "scripts/build-pi-knowledge.mjs",
		inputsSha256: inputHash.digest("hex"),
		outputs: {
			"dist/index.mjs": sha256(await readBytes(join(distRoot, "index.mjs"))),
			"lib/knowledge/runtime/worker.mjs": sha256(await readBytes(join(workerRoot, "worker.mjs"))),
		},
		skills: skillNames.map((name) => `skills/${name}/SKILL.md`),
	};
	await writeFile(join(packageRoot, "build-manifest.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
}

async function checkOutputs() {
	const output = await readFile(join(distRoot, "index.mjs"), "utf8");
	const worker = await readFile(join(workerRoot, "worker.mjs"), "utf8");
	if (!output.includes('"knowledge_status"') && !output.includes("'knowledge_status'"))
		throw new Error("pi-knowledge bundle is missing knowledge_status");
	for (const [name, text] of [
		["dist/index.mjs", output],
		["lib/knowledge/runtime/worker.mjs", worker],
	]) {
		if (/(?:from|import\s*\(|require\s*\()\s*["'](?:electron|@drone\/(?:backend|desktop))["']/.test(text))
			throw new Error(`${name} contains a forbidden host import`);
		if (/(?:from|import\s*\(|require\s*\()\s*["']\.\.\/\.\./.test(text))
			throw new Error(`${name} contains a package-boundary ../../ import`);
	}
}

await syncSkills();
if (check) {
	await checkOutputs();
	console.log("pi-knowledge package artifacts are up to date");
} else {
	await rm(distRoot, { recursive: true, force: true });
	await rm(workerRoot, { recursive: true, force: true });
	await buildBundle();
	await checkOutputs();
	console.log(`built pi-knowledge (${relative(root, distRoot)})`);
}
