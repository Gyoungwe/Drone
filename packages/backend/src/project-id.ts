import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { normalizeProjectId } from "@drone/shared";

/** Resolve aliases such as /tmp and /private/tmp, then apply pure lexical normalization. */
export function canonicalProjectId(input: string | undefined): string {
	const value = input?.trim();
	if (!value) return "";
	const platform = process.platform === "darwin" || process.platform === "win32" ? process.platform : "posix";
	// Workspace roots are absolute (or explicitly relative) paths. Keep stable
	// logical IDs such as "project-1" untouched for callers that use the
	// service outside the desktop workspace flow.
	const looksLikePath =
		value.startsWith("/") ||
		value.startsWith("./") ||
		value.startsWith("../") ||
		value.includes("/") ||
		value.includes("\\") ||
		/^[A-Za-z]:[\\/]/.test(value);
	if (!looksLikePath) return normalizeProjectId(value, platform);
	let candidate = resolve(value);
	const suffix: string[] = [];
	while (true) {
		try {
			const resolved = realpathSync.native(candidate);
			return normalizeProjectId(join(resolved, ...suffix), platform);
		} catch {
			const parent = dirname(candidate);
			if (parent === candidate) return normalizeProjectId(resolve(value), platform);
			suffix.unshift(basename(candidate));
			candidate = parent;
		}
	}
}

export { normalizeProjectId } from "@drone/shared";
