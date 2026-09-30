import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, relative, resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const sourceDir = resolve(root, "packages/extensions/src");
const outDirArg = process.argv.indexOf("--out-dir");
const outDirValue = outDirArg >= 0 ? process.argv[outDirArg + 1] : null;
if (outDirArg >= 0 && (!outDirValue || outDirValue.startsWith("--"))) {
	throw new Error("--out-dir requires a directory");
}
const outDir = resolve(root, outDirValue || ".pi/extensions");
const force = process.argv.includes("--force");
const manifestPath = resolve(outDir, ".build-manifest.json");

const sha256 = (contents) => createHash("sha256").update(contents).digest("hex");
const readHash = async (path) => sha256(await readFile(path));
const readManifest = async () => {
	try {
		return JSON.parse(await readFile(manifestPath, "utf8"));
	} catch (error) {
		if (error?.code === "ENOENT") return null;
		throw error;
	}
};

const entries = (await readdir(sourceDir))
	.filter((name) => name.endsWith(".ts"))
	.sort((a, b) => a.localeCompare(b));
if (entries.length === 0) throw new Error(`No extension entries found in ${sourceDir}`);
await mkdir(outDir, { recursive: true });
const previous = await readManifest();
const records = {};

for (const entry of entries) {
	const stem = basename(entry, extname(entry));
	const source = resolve(sourceDir, entry);
	const output = resolve(outDir, `${stem}.mjs`);
	const sourceHash = await readHash(source);
	let built = false;
	try {
		await stat(output);
		if (!force) {
			const old = previous?.entries?.[stem];
			if (
				old?.status === "generated" &&
				(old.sourceSha256 !== sourceHash ||
					old.output !== `${stem}.mjs` ||
					old.outputSha256 !== (await readHash(output)))
			) {
				throw new Error(
					`${relative(root, output)} is stale for ${relative(root, source)}; rerun with --force to rebuild it`,
				);
			}
			console.log(`preserved existing ${relative(root, output)}`);
		} else {
			built = true;
		}
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
		built = true;
	}
	if (built) {
		await build({
			entryPoints: [source],
			outfile: output,
			bundle: true,
			format: "esm",
			platform: "node",
			sourcemap: false,
			packages: "bundle",
			logLevel: "silent",
		});
		console.log(`${force ? "rebuilt" : "built"} ${relative(root, output)} from ${relative(root, source)}`);
	}
	records[stem] = {
		source: entry,
		output: `${stem}.mjs`,
		status: built || previous?.entries?.[stem]?.status === "generated" ? "generated" : "legacy-preserved",
		sourceSha256: sourceHash,
		outputSha256: await readHash(output),
	};
}

const outputNames = (await readdir(outDir))
	.filter((name) => name.endsWith(".mjs"))
	.sort((a, b) => a.localeCompare(b));
const managedOutputs = new Set(Object.values(records).map((record) => record.output));
const legacyOutputs = outputNames.filter((name) => !managedOutputs.has(name));
const manifest = {
	version: 1,
	generator: "scripts/build-extensions.mjs",
	sourceDir: "packages/extensions/src",
	outDir: relative(root, outDir) || ".",
	entries: records,
	legacyOutputs,
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`, "utf8");
console.log(
	`wrote ${relative(root, manifestPath)} (${Object.keys(records).length} source entries; ${legacyOutputs.length} legacy outputs)`,
);
