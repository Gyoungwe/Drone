import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const sourceDir = resolve(root, "packages/knowledge/src");
const workerSource = resolve(root, "packages/extensions/src/knowledge-worker.ts");
const expectedOutput = resolve(root, ".pi/extensions/knowledge-worker.mjs");
const expectedManifest = resolve(root, ".pi/extensions/.knowledge-worker-manifest.json");
const check = process.argv.includes("--check");
const temporaryRoot = check ? await mkdtemp(resolve(tmpdir(), "drone-knowledge-worker-check-")) : null;
const output = temporaryRoot ? resolve(temporaryRoot, "knowledge-worker.mjs") : expectedOutput;

async function sourceFiles() {
	return (await readdir(sourceDir)).filter((name) => name.endsWith(".ts")).sort();
}

async function sourceHash() {
	const hash = createHash("sha256");
	for (const name of await sourceFiles()) {
		const path = resolve(sourceDir, name);
		hash.update(`packages/knowledge/src/${name}`);
		hash.update("\0");
		hash.update(await readFile(path));
		hash.update("\0");
	}
	return hash.digest("hex");
}

async function buildWorker(outfile) {
	const result = await build({
		entryPoints: [workerSource],
		outfile,
		bundle: true,
		format: "esm",
		platform: "node",
		packages: "bundle",
		sourcemap: false,
		logLevel: "silent",
		metafile: true,
	});
	let contents = await readFile(outfile, "utf8");
	if (!contents.startsWith("// @ts-nocheck")) {
		contents = `// @ts-nocheck\n${contents}`;
		await writeFile(outfile, contents, "utf8");
	}
	const inputHash = createHash("sha256");
	for (const input of Object.keys(result.metafile?.inputs || {}).sort()) {
		const path = resolve(root, input);
		inputHash.update(relative(root, path).replaceAll("\\", "/"));
		inputHash.update("\0");
		inputHash.update(await readFile(path));
		inputHash.update("\0");
	}
	return {
		contents,
		inputsSha256: inputHash.digest("hex"),
		outputSha256: createHash("sha256").update(contents).digest("hex"),
		knowledgeSourceSha256: await sourceHash(),
	};
}

try {
	if (temporaryRoot) await mkdir(temporaryRoot, { recursive: true });
	else await mkdir(resolve(root, ".pi/extensions"), { recursive: true });
	const built = await buildWorker(output);
	const manifest = {
		version: 1,
		generator: "scripts/build-knowledge-runtime.mjs",
		output: "knowledge-worker.mjs",
		source: "packages/extensions/src/knowledge-worker.ts",
		inputsSha256: built.inputsSha256,
		knowledgeSourceSha256: built.knowledgeSourceSha256,
		outputSha256: built.outputSha256,
	};
	if (check) {
		let expected;
		try {
			expected = JSON.parse(await readFile(expectedManifest, "utf8"));
		} catch (error) {
			throw new Error(`missing ${relative(root, expectedManifest)}; run npm run build:knowledge`, { cause: error });
		}
		const actual = await readFile(expectedOutput).catch(() => null);
		if (!actual || !actual.equals(Buffer.from(built.contents)))
			throw new Error("knowledge worker artifact is stale: .pi/extensions/knowledge-worker.mjs");
		for (const [key, value] of Object.entries(manifest)) {
			if (expected[key] !== value)
				throw new Error(`knowledge worker manifest is stale: ${key}`);
		}
		console.log("knowledge worker artifacts are up to date");
	} else {
		await writeFile(expectedManifest, `${JSON.stringify(manifest, null, "\t")}\n`, "utf8");
		console.log(`built knowledge worker in ${relative(root, expectedOutput)}`);
	}
} finally {
	if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
}
