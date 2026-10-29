#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Runtime domain dependencies that still exist while P2–P5 migrate.  Keeping
 * this list explicit prevents a new optional plugin from becoming a silent
 * host requirement; each entry is a named compatibility seam with a removal
 * condition in the native-plugin plan.
 */
export const trackedRuntimeDependencies = new Set([
	"@drone/research",
	"@drone/tasks",
	"@gyoungwe/pi-core",
	"@gyoungwe/pi-knowledge",
	"@gyoungwe/pi-research",
]);

/** Packages that must never be promoted to host runtime dependencies. */
export const optionalPluginPackages = new Set([
	"@gyoungwe/desktop-ui-pack",
	"@gyoungwe/pi-analysis",
	"@gyoungwe/pi-connectors",
	"@gyoungwe/pi-evidence",
	"@gyoungwe/research-suite",
]);

export function inspectHostDependencies(packageJson) {
	const dependencies = new Set(Object.keys(packageJson.dependencies ?? {}));
	const runtimeDomainDependencies = [...dependencies].filter((name) => trackedRuntimeDependencies.has(name));
	const unexpectedRuntimeDomainDependencies = [...dependencies].filter(
		(name) => name.startsWith("@gyoungwe/pi-") && !trackedRuntimeDependencies.has(name),
	);
	const optionalPluginRuntimeDependencies = [...dependencies].filter((name) =>
		optionalPluginPackages.has(name),
	);
	return {
		runtimeDomainDependencies,
		unexpectedRuntimeDomainDependencies,
		optionalPluginRuntimeDependencies,
		ok: unexpectedRuntimeDomainDependencies.length === 0 && optionalPluginRuntimeDependencies.length === 0,
	};
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	const root = new URL("../", import.meta.url);
	const packageJson = JSON.parse(await readFile(new URL("packages/backend/package.json", root), "utf8"));
	const result = inspectHostDependencies(packageJson);
	if (!result.ok) {
		console.error("Host domain dependency policy failed:");
		for (const name of result.unexpectedRuntimeDomainDependencies)
			console.error(`- untracked runtime domain dependency: ${name}`);
		for (const name of result.optionalPluginRuntimeDependencies)
			console.error(`- optional plugin must not be a host runtime dependency: ${name}`);
		process.exit(1);
	}
	console.log(
		JSON.stringify(
			{
				status: "PARTIAL",
				trackedRuntimeDependencies: result.runtimeDomainDependencies,
				message: "Tracked dependencies remain until their P2–P5 host seams are removed.",
			},
			null,
			2,
		),
	);
}
