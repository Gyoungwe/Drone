import { createHash, type Hash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { isPackageVersion, type PackageLifecycleReceipt } from "@drone/shared";

export interface PackageLocation {
	readonly packageName: string;
	readonly scope: PackageLifecycleReceipt["scope"];
	readonly modules: string;
	readonly path: string;
}

export interface PackageIdentity {
	readonly version: string;
	readonly hash: string;
}

export function packageContainsPath(root: string, path: string): boolean {
	const suffix = relative(root, path);
	return !isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`);
}

function addDirectory(hash: Hash, root: string, directory: string): void {
	for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
		left.name.localeCompare(right.name),
	)) {
		const path = join(directory, entry.name);
		hash.update(JSON.stringify([relative(root, path), entry.isDirectory(), entry.isSymbolicLink()]));
		if (entry.isDirectory()) addDirectory(hash, root, path);
		else if (entry.isSymbolicLink()) {
			const link = readlinkSync(path);
			if (isAbsolute(link) || !packageContainsPath(root, realpathSync(path)))
				throw new Error("Package link escaped its directory");
			hash.update(JSON.stringify(link));
		} else if (entry.isFile()) {
			const bytes = readFileSync(path);
			hash.update(`${bytes.length}\0`).update(bytes);
		} else throw new Error("Invalid entry in package directory");
	}
}

export function readPackageIdentity(location: PackageLocation): PackageIdentity | undefined {
	const stat = lstatSync(location.path, { throwIfNoEntry: false });
	if (!stat) return undefined;
	const root = realpathSync(location.path);
	if (!stat.isDirectory() || root !== location.path || realpathSync(location.modules) !== location.modules)
		throw new Error("Package root is not a confined directory");
	const hash = createHash("sha256");
	addDirectory(hash, root, root);
	const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
		name?: unknown;
		version?: unknown;
	};
	const { version } = manifest;
	if (manifest.name !== location.packageName || !isPackageVersion(version))
		throw new Error("Unexpected package identity");
	return { version, hash: hash.digest("hex") };
}
