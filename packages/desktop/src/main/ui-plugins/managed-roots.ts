import { discoverInstalledPackages, type InstalledPackageDiscovery } from "./installed-package-sources";

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
