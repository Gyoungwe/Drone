#!/usr/bin/env node
/**
 * Project the UI-plugin manifest into the main-process shim and the three
 * public TypeScript projections. The projections keep their imports, comments,
 * and non-plugin declarations; only marked namespace blocks are generated.
 * `--check` is used by CI to make every committed projection reproducible.
 */
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

const root = new URL("../", import.meta.url);
const manifestPath = new URL("./src/renderer/src/plugins/host-api.manifest.json", root);
const shimPath = new URL("./src/main/ui-plugins/plugin-api-shim.generated.ts", root);
const projectionPaths = [
	new URL("./src/renderer/src/plugins/host-api.ts", root),
	new URL("./src/renderer/src/plugins/env.d.ts", root),
	new URL("./resources/ui-plugins/drone-ui.d.ts", root),
];
const projectionKinds = ["host", "env", "drone"];
const namespaces = ["components", "helpers", "hooks", "stores", "i18n"];

function fail(message) {
	throw new Error(`Plugin host API manifest: ${message}`);
}

function validateManifest(manifest) {
	if (manifest?.version !== 1) fail("version must be 1");
	if (!manifest.namespaces || typeof manifest.namespaces !== "object") fail("namespaces are missing");
	for (const namespace of namespaces) {
		const entries = manifest.namespaces[namespace];
		if (!Array.isArray(entries) || entries.length === 0) fail(`${namespace} must be a non-empty array`);
		const names = new Set();
		for (const entry of entries) {
			if (!entry || typeof entry !== "object") fail(`${namespace} entries must be objects`);
			if (!/^[A-Za-z_$][\w$]*$/.test(entry.name)) fail(`${namespace} has invalid name ${entry.name}`);
			if (names.has(entry.name)) fail(`${namespace}.${entry.name} is duplicated`);
			names.add(entry.name);
			for (const field of ["hostValue", "envType", "pluginType"]) {
				if (typeof entry[field] !== "string" || entry[field].length === 0) {
					fail(`${namespace}.${entry.name} is missing ${field}`);
				}
			}
		}
	}
}

function renderTopLevel(manifest) {
	const lines = [];
	for (const namespace of namespaces) {
		for (const entry of manifest.namespaces[namespace]) {
			const typeLines = entry.pluginType.split("\n");
			if (typeLines.length === 1) {
				lines.push(`\texport const ${entry.name}: ${typeLines[0]};`);
				continue;
			}
			lines.push(`\texport const ${entry.name}: ${typeLines[0]}`);
			for (const line of typeLines.slice(1, -1)) lines.push(`\t\t${line}`);
			lines.push(`\t${typeLines.at(-1)};`);
		}
	}
	return lines.join("\n");
}

function renderNamespace(namespace, entries, kind) {
	const lines = [];
	if (kind === "drone") {
		lines.push(`\texport const ${namespace}: {`);
		for (const entry of entries) {
			const typeLines = entry.pluginType.split("\n");
			if (typeLines.length === 1) {
				lines.push(`\t\t${entry.name}: ${typeLines[0]};`);
				continue;
			}
			lines.push(`\t\t${entry.name}: ${typeLines[0]}`);
			for (const line of typeLines.slice(1, -1)) lines.push(`\t\t\t${line}`);
			lines.push(`\t\t${typeLines.at(-1)};`);
		}
		lines.push("\t};");
	} else {
		lines.push(`\t${namespace}: {`);
		for (const entry of entries) {
			const value = kind === "host" ? entry.hostValue : entry.envType;
			lines.push(`\t\t${entry.name}: ${value}${kind === "host" ? "," : ";"}`);
		}
		lines.push(kind === "host" ? "\t}," : "\t};");
	}
	return lines.join("\n");
}

function replaceGeneratedBlock(source, namespace, content, path) {
	const marker = new RegExp(
		`^(\\s*)// <drone:generated namespace="${namespace}">\\r?\\n[\\s\\S]*?^\\s*// </drone:generated namespace="${namespace}">`,
		"gm",
	);
	const matches = [...source.matchAll(marker)];
	if (matches.length !== 1) {
		fail(`${path} must contain exactly one generated ${namespace} marker pair`);
	}
	const indent = matches[0][1];
	const replacement = `${indent}// <drone:generated namespace="${namespace}">\n${content}\n${indent}// </drone:generated namespace="${namespace}">`;
	return source.replace(marker, replacement);
}

function projectionNames(source, namespace, declaration) {
	const open = declaration === "drone" ? `export const ${namespace}:\\s*\\{` : `${namespace}:\\s*\\{`;
	const block =
		new RegExp(`${open}([\\s\\S]*?)\\n\\s*\\}\\s*[,;]?`).exec(source) ??
		new RegExp(`${open}([^}]*)\\}`).exec(source);
	if (!block) fail(`${declaration} projection is missing ${namespace}`);
	const firstProperty = /^([ \t]*)\S/m.exec(block[1]);
	const indent = firstProperty?.[1] ?? "";
	const escapedIndent = indent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const property = new RegExp(`^${escapedIndent}([A-Za-z_$][\\w$]*)\\s*(?::|\\(|,)`, "gm");
	return [...block[1].matchAll(property)].map((item) => item[1]);
}

function checkProjectionDrift(sources, manifest) {
	const errors = [];
	for (const [namespace, entries] of Object.entries(manifest.namespaces)) {
		const expected = new Set(entries.map((entry) => entry.name));
		for (const [index, source] of sources.entries()) {
			const path = projectionPaths[index].pathname;
			const actual = new Set(projectionNames(source, namespace, projectionKinds[index]));
			for (const name of expected) {
				if (!actual.has(name)) errors.push(`${namespace}.${name} missing in ${path}`);
			}
			for (const name of actual) {
				if (!expected.has(name)) errors.push(`${namespace}.${name} is undeclared in ${path}`);
			}
		}
	}
	if (errors.length > 0) fail(`projection drift:\n${errors.join("\n")}`);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
validateManifest(manifest);
const projectionSources = await Promise.all(projectionPaths.map((path) => readFile(path, "utf8")));
checkProjectionDrift(projectionSources, manifest);

const generatedProjections = projectionSources.map((source, index) => {
	let result = source;
	for (const namespace of namespaces) {
		result = replaceGeneratedBlock(
			result,
			namespace,
			renderNamespace(namespace, manifest.namespaces[namespace], projectionKinds[index]),
			projectionPaths[index].pathname,
		);
	}
	if (projectionKinds[index] === "drone") {
		result = replaceGeneratedBlock(
			result,
			"topLevel",
			renderTopLevel(manifest),
			projectionPaths[index].pathname,
		);
	}
	return result;
});

const names = Object.fromEntries(
	namespaces.map((namespace) => [namespace, manifest.namespaces[namespace].map((entry) => entry.name)]),
);
const shim = [
	"const A = window.DroneUI;",
	"export default A;",
	"export const { version, components, helpers, hooks, stores, i18n } = A;",
	`export const { ${names.components.join(", ")} } = A.components;`,
	`export const { ${names.helpers.join(", ")} } = A.helpers;`,
	`export const { ${names.hooks.join(", ")} } = A.hooks;`,
	`export const { ${names.stores.join(", ")} } = A.stores;`,
	`export const { ${names.i18n.join(", ")} } = A.i18n;`,
].join("\n");
const generatedShim = `/** Generated by packages/desktop/scripts/gen-plugin-api.mjs. Do not edit by hand. */\nexport const PLUGIN_API_SHIM =\n\t${JSON.stringify(`${shim}\n`)};\n`;

const check = process.argv.includes("--check");
const stale = [];
for (const [index, path] of projectionPaths.entries()) {
	if (projectionSources[index] !== generatedProjections[index]) stale.push(path.pathname);
}
const currentShim = await readFile(shimPath, "utf8").catch(() => "");
if (currentShim !== generatedShim) stale.push(shimPath.pathname);
if (check) {
	if (stale.length > 0) {
		console.error(
			`Generated plugin API projections are stale:\n${stale.map((path) => `- ${path}`).join("\n")}`,
		);
		process.exit(1);
	}
	console.log("plugin host API projections are up to date");
} else {
	for (const [index, path] of projectionPaths.entries()) {
		if (projectionSources[index] !== generatedProjections[index])
			await writeFile(path, generatedProjections[index], "utf8");
	}
	if (currentShim !== generatedShim) await writeFile(shimPath, generatedShim, "utf8");
	console.log("generated plugin host API projections");
}
