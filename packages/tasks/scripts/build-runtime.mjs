import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "src", "runtime");
const expectedOutput = join(root, "src", "runtime-compiled");
const check = process.argv.includes("--check");
const output = check ? await mkdtemp(resolve(tmpdir(), "drone-tasks-runtime-check-")) : expectedOutput;
await mkdir(output, { recursive: true });
const entries = (await readdir(source)).filter((name) => name.endsWith(".ts")).sort();

const snapshot = async (directory) => {
	const files = new Map();
	for (const name of await readdir(directory)) files.set(name, await readFile(join(directory, name)));
	return files;
};

try {
	await build({
		entryPoints: entries.map((name) => join(source, name)),
		outdir: output,
		format: "esm",
		platform: "node",
		bundle: false,
		outExtension: { ".js": ".mjs" },
		logLevel: "silent",
	});
	for (const name of entries.map((entry) => entry.replace(/\.ts$/, ".mjs"))) {
		const file = join(output, name);
		let text = await readFile(file, "utf8");
		text = text.replace(
			/(from\s+["']\.\/[^"']+)(["'])/g,
			(_match, path, quote) => `${path.endsWith(".mjs") ? path : `${path}.mjs`}${quote}`,
		);
		text = text.replace(
			/(import\(["']\.\/[^"']+)(["'])/g,
			(_match, path, quote) => `${path.endsWith(".mjs") ? path : `${path}.mjs`}${quote}`,
		);
		await writeFile(file, text);
	}
	if (check) {
		const [actual, expected] = await Promise.all([snapshot(output), snapshot(expectedOutput)]);
		const names = new Set([...actual.keys(), ...expected.keys()]);
		const stale = [...names].filter(
			(name) => !actual.has(name) || !expected.has(name) || !actual.get(name).equals(expected.get(name)),
		);
		if (stale.length > 0) throw new Error(`tasks runtime artifacts are stale: ${stale.join(", ")}`);
		console.log("tasks runtime artifacts are up to date");
	} else {
		console.log(`built ${entries.length} task runtime entries in ${output}`);
	}
} finally {
	if (check) await rm(output, { recursive: true, force: true });
}
