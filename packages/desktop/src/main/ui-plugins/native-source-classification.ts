import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createLogger, type SelectedNativeSource } from "@drone/backend";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import type { InstalledUiRuntimeSource } from "./installed-package-sources";

const log = createLogger("native-source");

const declaration = Type.Object({
	entrypoints: Type.Optional(Type.Object({ desktopRuntime: Type.Optional(Type.Unknown()) })),
	drone: Type.Optional(Type.Object({ deliveryProjection: Type.Optional(Type.Unknown()) })),
});

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
