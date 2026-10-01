import { build } from "esbuild";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
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
	text = text.replace(/(from\s+["']\.\/[^"']+)(["'])/g, (match, path, quote) =>
		`${path.endsWith(".mjs") ? path : `${path}.mjs`}${quote}`,
	);
	text = text.replace(/(import\(["']\.\/[^"']+)(["'])/g, (match, path, quote) =>
		`${path.endsWith(".mjs") ? path : `${path}.mjs`}${quote}`,
	);
	await writeFile(file, text);
}
