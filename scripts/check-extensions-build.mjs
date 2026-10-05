import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const sourceDir = resolve(root, "packages/extensions/src");
const outDirArg = process.argv.indexOf("--out-dir");
const outDirValue = outDirArg >= 0 ? process.argv[outDirArg + 1] : null;
if (outDirArg >= 0 && (!outDirValue || outDirValue.startsWith("--"))) {
	throw new Error("--out-dir requires a directory");
}
const outDir = resolve(root, outDirValue || ".pi/extensions");
const manifestPath = resolve(outDir, ".build-manifest.json");
const strict = process.argv.includes("--strict") || process.env.DRONE_EXTENSIONS_STRICT === "1";
const sha256 = (contents) => createHash("sha256").update(contents).digest("hex");
const readHash = async (path) => sha256(await readFile(path));
const inputsHash = async (metafile) => {
	const hash = createHash("sha256");
	for (const input of Object.keys(metafile?.inputs || {}).sort()) {
		const path = resolve(root, input);
		hash.update(relative(root, path).replaceAll("\\", "/"));
		hash.update("\0");
		hash.update(await readFile(path));
		hash.update("\0");
	}
	return hash.digest("hex");
};
const exists = async (path) => {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (error?.code === "ENOENT") return false;
		throw error;
	}
};

if (!(await exists(manifestPath))) {
	throw new Error(
		`Missing ${manifestPath}; run npm run build:extensions to create the source/output manifest`,
	);
}
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (
	manifest?.version !== 1 ||
	manifest.generator !== "scripts/build-extensions.mjs" ||
	manifest.sourceDir !== "packages/extensions/src" ||
	!manifest.entries ||
	!Array.isArray(manifest.legacyOutputs)
) {
	throw new Error(`Invalid extension build manifest: ${manifestPath}`);
}

const entries = (await readdir(sourceDir))
	.filter((name) => name.endsWith(".ts"))
	.sort((a, b) => a.localeCompare(b));
const errors = [];
const warnings = [];
const managedOutputs = new Set();
for (const entry of entries) {
	const stem = entry.slice(0, -3);
	const record = manifest.entries[stem];
	if (!record) {
		errors.push(`source ${entry} has no manifest entry; run npm run build:extensions`);
		continue;
	}
	if (record.source !== entry || record.output !== `${stem}.mjs`) {
		errors.push(`manifest mapping for ${stem} does not match source/output names`);
		continue;
	}
	managedOutputs.add(record.output);
	const output = resolve(outDir, record.output);
	if (!(await exists(output))) {
		errors.push(`missing output ${record.output} for source ${entry}`);
		continue;
	}
	const outputHash = await readHash(output);
	if (record.status === "generated") {
		const sourceHash = await readHash(resolve(sourceDir, entry));
		const metafile = (
			await build({
				entryPoints: [resolve(sourceDir, entry)],
				outfile: output,
				bundle: true,
				format: "esm",
				platform: "node",
				packages: "bundle",
				sourcemap: false,
				metafile: true,
				write: false,
				logLevel: "silent",
			})
		).metafile;
		if (record.sourceSha256 !== sourceHash) {
			errors.push(`${entry} changed since ${record.output}; run npm run build:extensions -- --force`);
		}
		if (record.inputsSha256 !== (await inputsHash(metafile))) {
			errors.push(
				`${entry} or one of its dependencies changed since ${record.output}; run npm run build:extensions -- --force`,
			);
		}
		if (record.outputSha256 !== outputHash) {
			errors.push(`${record.output} was modified after generation; run npm run build:extensions -- --force`);
		}
	} else if (record.status === "legacy-preserved") {
		warnings.push(`${record.output} is a preserved legacy artifact; source migration is still pending`);
	} else {
		errors.push(`unknown status ${String(record.status)} for ${entry}`);
	}
}

const outputNames = (await readdir(outDir)).filter((name) => name.endsWith(".mjs")).sort();
const declaredLegacy = new Set(manifest.legacyOutputs);
for (const name of outputNames) {
	if (!managedOutputs.has(name) && !declaredLegacy.has(name)) {
		errors.push(`${name} is not represented in the extension build manifest`);
	}
}
for (const name of declaredLegacy) {
	if (!outputNames.includes(name)) errors.push(`manifest lists missing legacy output ${name}`);
}
if (strict && warnings.length > 0) {
	errors.push(...warnings.map((warning) => `strict mode: ${warning}`));
}
if (errors.length > 0) {
	for (const error of errors) console.error(`extension build check: ${error}`);
	process.exitCode = 1;
} else {
	console.log(
		`verified ${entries.length} extension source/output mappings (${warnings.length} preserved legacy artifact${warnings.length === 1 ? "" : "s"})`,
	);
	for (const warning of warnings) console.warn(`extension build check: ${warning}`);
}
