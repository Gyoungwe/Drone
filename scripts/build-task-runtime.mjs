#!/usr/bin/env node
/**
 * Copy the typed task runtime into the dependency-free Pi resource tree.
 *
 * The desktop release ships `.pi/lib` without workspace node_modules. Keep the
 * package runtime canonical while emitting a relative, self-contained adapter
 * graph for that resource boundary. Development imports still prefer the
 * workspace package through the acceptance adapter below.
 */
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourceDir = resolve(root, "packages/tasks/src/runtime-compiled");
const expectedDir = resolve(root, ".pi/lib/tasks");
const check = process.argv.includes("--check");
const outputDir = check ? await mkdtemp(resolve(tmpdir(), "drone-tasks-compat-check-")) : expectedDir;

const header = (name) =>
	`// @ts-nocheck\n/** Compatibility artifact generated from packages/tasks/src/runtime/${name}.ts; packaged resources share the .pi runtime bridge. */\n`;
const entries = (await readdir(sourceDir))
	.filter((name) => name.endsWith(".mjs") && name !== "runtime-bridge.mjs")
	.sort();

try {
	await mkdir(outputDir, { recursive: true });
	for (const name of entries) {
		let contents = await readFile(resolve(sourceDir, name), "utf8");
		contents = contents.replaceAll('from "./runtime-bridge.mjs"', 'from "../runtime-bridge.mjs"');
		await writeFile(resolve(outputDir, name), header(name.replace(/\.mjs$/, "")) + contents);
	}

	const packaged = await readFile(resolve(outputDir, "acceptance.mjs"), "utf8");
	await writeFile(resolve(outputDir, "acceptance-packaged.mjs"), packaged);
	await writeFile(
		resolve(outputDir, "acceptance.mjs"),
		`// @ts-nocheck\n/**
 * Package-aware Pi adapter for acceptance verifiers.
 *
 * Development and backend tests use the typed package instance so the host and
 * extension share one registry. Packaged resources have no workspace
 * node_modules, so they fall back to the self-contained compiled copy.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let implementation;
try {
\timplementation = await import(require.resolve("@drone/tasks/acceptance"));
} catch (error) {
\tif (error?.code !== "ERR_MODULE_NOT_FOUND" && error?.code !== "MODULE_NOT_FOUND") throw error;
\timplementation = await import("./acceptance-packaged.mjs");
}

export const {
\tACCEPTANCE_VERIFIER_EVENT,
\tACCEPTANCE_VERIFIER_REQUEST_EVENT,
\tCORE_ACCEPTANCE_KINDS,
\tacceptanceKinds,
\tacceptanceSchema,
\tacceptanceVerifier,
\tacceptanceVerifiers,
\tbindAcceptanceVerifierEvents,
\tdescribeAcceptance,
\teffectiveAcceptance,
\tnormalizeAcceptance,
\tregisterAcceptanceVerifier,
\tresetAcceptanceVerifiers,
} = implementation;
`,
	);

	if (check) {
		const stale = [];
		for (const name of [...entries, "acceptance-packaged.mjs", "acceptance.mjs"]) {
			const actual = await readFile(resolve(outputDir, name));
			const expected = await readFile(resolve(expectedDir, name));
			if (!actual.equals(expected)) stale.push(name);
		}
		if (stale.length > 0) throw new Error(`tasks compatibility artifacts are stale: ${stale.join(", ")}`);
		console.log("tasks compatibility artifacts are up to date");
	} else {
		console.log(`built ${entries.length} task runtime compatibility artifacts in ${outputDir}`);
	}
} finally {
	if (check) await rm(outputDir, { recursive: true, force: true });
}
