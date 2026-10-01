import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "src", "runtime");
const output = join(root, "src", "runtime-compiled");
await mkdir(output, { recursive: true });
const entries = (await readdir(source)).filter((name) => name.endsWith(".ts"));
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
