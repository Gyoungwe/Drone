import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createLogger, type SelectedNativeSource } from "@drone/backend";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import type { InstalledUiRuntimeSource } from "./installed-package-sources";

const log = createLogger("native-source");

/**
 * The managed source a native path belongs to.
 *
 * Called only for a path selected by the actual Pi extension loader: UI
 * visibility grants no native authority.  The declared path is matched first
 * (the package said where it lives), then the canonical entrypoint.
 */
export function nativeRuntimeName(
	path: string,
	sources: ReadonlyMap<string, { source: InstalledUiRuntimeSource }>,
): string | undefined {
	let declared = resolve(path);
	try {
		declared = join(realpathSync(dirname(declared)), basename(declared));
	} catch (error) {
		log.warn("Selected extension directory is unavailable", path, error);
	}
	for (const [name, item] of sources) if (item.source.nativeDeclaredPath === declared) return name;
	try {
		const canonical = realpathSync(path);
		for (const [name, item] of sources) if (item.source.nativeEntrypoint === canonical) return name;
	} catch (error) {
		log.warn("Selected extension path is unavailable", path, error);
	}
	return undefined;
}

const declaration = Type.Object({
	entrypoints: Type.Optional(Type.Object({ desktopRuntime: Type.Optional(Type.Unknown()) })),
	drone: Type.Optional(Type.Object({ deliveryProjection: Type.Optional(Type.Unknown()) })),
});

/**
 * Native entries of current packages that declared read-only child session support.
 *
 * A child session loads only these; the actual loader selection is still
 * classified per path.
 */
export function nativeChildExtensionPaths(
	sources: ReadonlyMap<string, { source: InstalledUiRuntimeSource }>,
	current: (name: string) => boolean,
): string[] {
	const paths: string[] = [];
	for (const [name, item] of sources) {
		if (item.source.nativeChildSessions !== "read-only" || !current(name)) continue;
		const path = item.source.nativeDeclaredPath ?? item.source.nativeEntrypoint;
		if (path) paths.push(path);
	}
	return paths;
}

/** Native entries of enabled built-in packages; Pi's package manager does not list them. */
export function builtinExtensionPaths(
	sources: ReadonlyMap<string, { source: InstalledUiRuntimeSource }>,
	builtinRoots: ReadonlySet<string>,
	current: (name: string) => boolean,
): string[] {
	return [...sources].flatMap(([name, { source }]) => {
		const path = source.nativeDeclaredPath ?? source.nativeEntrypoint;
		return path && builtinRoots.has(source.packageRoot) && current(name) ? [path] : [];
	});
}

const within = (root: string, path: string): boolean => {
	const part = relative(root, path);
	return !isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`);
};

/** An unknown/failed managed source cannot fall through to ordinary third-party execution. */
export function classifyUnmanagedNativePath(
	path: string,
	sources: readonly InstalledUiRuntimeSource[],
): SelectedNativeSource {
	const declared = resolve(path);
	let canonical: string;
	let directory: string;
	try {
		canonical = realpathSync(declared);
		directory = statSync(canonical).isDirectory() ? canonical : dirname(canonical);
	} catch {
		log.warn("Selected native path is unavailable; source remains unconfirmed", { path });
		return { kind: "unconfirmed" };
	}
	if (
		sources.some(
			(source) => within(source.installationPath, declared) || within(source.packageRoot, canonical),
		)
	)
		return { kind: "unconfirmed" };
	for (; ; directory = dirname(directory)) {
		const manifestPath = join(directory, "plugin.manifest.json");
		if (existsSync(manifestPath)) {
			let parsed: unknown;
			try {
				parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
			} catch {
				log.warn("Native declaration could not be read; source remains unconfirmed", { path: manifestPath });
				return { kind: "unconfirmed" };
			}
			if (!Check(declaration, parsed)) return { kind: "unconfirmed" };
			const manifest = parsed as Static<typeof declaration>;
			return manifest.entrypoints?.desktopRuntime !== undefined ||
				manifest.drone?.deliveryProjection !== undefined
				? { kind: "unconfirmed" }
				: { kind: "ordinary" };
		}
		if (existsSync(join(directory, "package.json")) || dirname(directory) === directory)
			return { kind: "ordinary" };
	}
}
