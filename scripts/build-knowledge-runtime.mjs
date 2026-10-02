import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const sourceDir = resolve(root, "packages/knowledge/src");
const expectedDir = resolve(root, ".pi/lib/knowledge/runtime");
const check = process.argv.includes("--check");
const outDir = check ? await mkdtemp(resolve(tmpdir(), "drone-knowledge-runtime-check-")) : expectedDir;
const sourceNames = (await readdir(sourceDir))
	.filter((name) => name.endsWith(".ts") && name !== "worker.ts")
	.sort();
const entryPoints = sourceNames.map((name) => resolve(sourceDir, name));

const snapshot = async (directory) => {
	const files = new Map();
	const walk = async (current, prefix = "") => {
		for (const entry of await readdir(current, { withFileTypes: true })) {
			const name = prefix ? `${prefix}/${entry.name}` : entry.name;
			const path = resolve(current, entry.name);
			if (entry.isDirectory()) await walk(path, name);
			else if (entry.isFile()) files.set(name, await readFile(path));
		}
	};
	await walk(directory);
	return files;
};

try {
	if (!check) await rm(outDir, { recursive: true, force: true });
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
	const generatedFiles = (await readdir(outDir, { recursive: true })).filter((name) => name.endsWith(".mjs"));
	const entries = {};
	for (const name of generatedFiles) {
		// Bundled ESM artifacts are checked through the legacy .pi compatibility
		// wrappers. Keep the generated bundle itself out of checkJs inference:
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
			sha256: createHash("sha256")
				.update(await readFile(outputPath))
				.digest("hex"),
		};
	}
	await writeFile(
		resolve(outDir, ".build-manifest.json"),
		`${JSON.stringify({ version: 1, generator: "scripts/build-knowledge-runtime.mjs", entries }, null, "\t")}\n`,
	);

	if (check) {
		const [actual, expected] = await Promise.all([snapshot(outDir), snapshot(expectedDir)]);
		const mismatches = new Set([...actual.keys(), ...expected.keys()]);
		const stale = [...mismatches].filter(
			(name) => !actual.has(name) || !expected.has(name) || !actual.get(name).equals(expected.get(name)),
		);
		if (stale.length > 0)
			throw new Error(`knowledge runtime artifacts are stale: ${stale.slice(0, 20).join(", ")}`);
		console.log("knowledge runtime artifacts are up to date");
	} else {
		console.log(`built ${outputs.length} knowledge entries in ${relative(root, outDir)} (worker isolated)`);
	}
} finally {
	if (check) await rm(outDir, { recursive: true, force: true });
}
