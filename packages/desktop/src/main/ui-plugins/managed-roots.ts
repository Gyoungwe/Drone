import {
	discoverInstalledPackages,
	type InstalledPackageDiscovery,
	type InstalledUiRuntimeSource,
} from "./installed-package-sources";

/**
 * The two managed package roots: Pi's user npm install and Drone's read-only built-in packages.
 * Built-ins come first, and a user-installed package with a built-in's name never shadows it: it
 * becomes a diagnostic row, so the shipped, lock-verified copy is the only source for that name.
 */
export async function discoverManagedPackages(
	userRoot: string,
	builtinRoot: string,
): Promise<{ installed: InstalledPackageDiscovery[]; builtins: Map<string, string> }> {
	const builtins = await discoverInstalledPackages(builtinRoot);
	const found = builtins.flatMap((item) => ("error" in item ? [] : [item]));
	const names = new Set(found.map((item) => item.packageName));
	const user = (await discoverInstalledPackages(userRoot)).map((item) =>
		"error" in item || !names.has(item.packageName)
			? item
			: {
					packageName: item.packageName,
					error: `Ignored ${item.packageRoot}: ${item.packageName} is built into Drone`,
				},
	);
	// Package root → package name of every valid built-in.
	return {
		installed: [...builtins, ...user],
		builtins: new Map(found.map((item) => [item.packageRoot, item.packageName])),
	};
}

export function selectRuntimeSources(
	previousSelections: ReadonlyMap<string, { source: InstalledUiRuntimeSource; current: boolean }>,
	candidates: readonly InstalledPackageDiscovery[],
) {
	const selections = new Map(
		[...previousSelections].map(([name, item]) => [name, { ...item, current: false }]),
	);
	for (const candidate of candidates) {
		if ("error" in candidate || !candidate.runtime) continue;
		const key = `package:${candidate.packageRoot}`;
		const previous = previousSelections.get(key)?.source;
		const source =
			previous?.contentHash === candidate.runtime.contentHash &&
			previous.installationPath === candidate.runtime.installationPath
				? previous
				: candidate.runtime;
		selections.set(key, { source, current: true });
	}
	return selections;
}
