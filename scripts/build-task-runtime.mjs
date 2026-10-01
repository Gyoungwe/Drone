#!/usr/bin/env node
/**
 * Copy the typed task runtime into the dependency-free Pi resource tree.
 *
 * The desktop release ships `.pi/lib` without workspace node_modules. Keep the
 * package runtime canonical while emitting a relative, self-contained adapter
 * graph for that resource boundary. Development imports still prefer the
 * workspace package through the acceptance adapter below.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourceDir = resolve(root, "packages/tasks/src/runtime-compiled");
const outputDir = resolve(root, ".pi/lib/tasks");
await mkdir(outputDir, { recursive: true });

const header = (name) =>
	`// @ts-nocheck\n/** Compatibility artifact generated from packages/tasks/src/runtime/${name}.ts; packaged resources share the .pi runtime bridge. */\n`;
const entries = (await readdir(sourceDir)).filter(
	(name) => name.endsWith(".mjs") && name !== "runtime-bridge.mjs",
);
for (const name of entries) {
	let contents = await readFile(resolve(sourceDir, name), "utf8");
	contents = contents.replaceAll('from "./runtime-bridge.mjs"', 'from "../runtime-bridge.mjs"');
	await writeFile(resolve(outputDir, name), header(name.replace(/\.mjs$/, "")) + contents);
}

const packaged = await readFile(resolve(outputDir, "acceptance.mjs"), "utf8");
await writeFile(resolve(outputDir, "acceptance-packaged.mjs"), packaged);
await writeFile(
	resolve(outputDir, "acceptance.mjs"),
	`// @ts-nocheck\n/**\n * Package-aware Pi adapter for acceptance verifiers.\n *\n * Development and backend tests use the typed package instance so the host and\n * extension share one registry. Packaged resources have no workspace\n * node_modules, so they fall back to the self-contained compiled copy.\n */\nimport { createRequire } from "node:module";\n\nconst require = createRequire(import.meta.url);\nlet implementation;\ntry {\n\timplementation = await import(require.resolve("@drone/tasks/acceptance"));\n} catch (error) {\n\tif (error?.code !== "ERR_MODULE_NOT_FOUND" && error?.code !== "MODULE_NOT_FOUND") throw error;\n\timplementation = await import("./acceptance-packaged.mjs");\n}\n\nexport const {\n\tACCEPTANCE_VERIFIER_EVENT,\n\tACCEPTANCE_VERIFIER_REQUEST_EVENT,\n\tCORE_ACCEPTANCE_KINDS,\n\tacceptanceKinds,\n\tacceptanceSchema,\n\tacceptanceVerifier,\n\tacceptanceVerifiers,\n\tbindAcceptanceVerifierEvents,\n\tdescribeAcceptance,\n\teffectiveAcceptance,\n\tnormalizeAcceptance,\n\tregisterAcceptanceVerifier,\n\tresetAcceptanceVerifiers,\n} = implementation;\n`,
);
console.log(`built ${entries.length} task runtime compatibility artifacts in ${outputDir}`);
