#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { isMainModule } from "./is-main-module.mjs";

/** Empty after P6 PR-A; the runtime dependency allowlist must only shrink. */
export const trackedRuntimeDependencies = new Set();

/** Packages that must never be promoted to host runtime dependencies. */
export const optionalPluginPackages = new Set([
	"@gyoungwe/desktop-ui-pack",
	"@gyoungwe/pi-analysis",
	"@gyoungwe/pi-connectors",
	"@gyoungwe/pi-evidence",
	"@gyoungwe/research-suite",
]);

export function inspectHostDependencies(packageJson, tracked = trackedRuntimeDependencies) {
	const dependencies = new Set(Object.keys(packageJson.dependencies ?? {}));
	const runtimeDomainDependencies = [...dependencies].filter((name) => tracked.has(name));
	const staleTrackedDependencies = [...tracked].filter((name) => !dependencies.has(name));
	const unexpectedRuntimeDomainDependencies = [...dependencies].filter(
		(name) => name.startsWith("@gyoungwe/pi-") && !tracked.has(name),
	);
	const optionalPluginRuntimeDependencies = [...dependencies].filter((name) =>
		optionalPluginPackages.has(name),
	);
	return {
		runtimeDomainDependencies,
		staleTrackedDependencies,
		unexpectedRuntimeDomainDependencies,
		optionalPluginRuntimeDependencies,
		ok:
			staleTrackedDependencies.length === 0 &&
			unexpectedRuntimeDomainDependencies.length === 0 &&
			optionalPluginRuntimeDependencies.length === 0,
	};
}

if (isMainModule(import.meta.url)) {
	const root = new URL("../", import.meta.url);
	const packageJson = JSON.parse(await readFile(new URL("packages/backend/package.json", root), "utf8"));
	const result = inspectHostDependencies(packageJson);
	if (!result.ok) {
		console.error("Host domain dependency policy failed:");
		for (const name of result.staleTrackedDependencies) console.error(`- stale tracked dependency: ${name}`);
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
				message: "This check covers only backend runtime dependencies.",
			},
			null,
			2,
		),
	);
}
