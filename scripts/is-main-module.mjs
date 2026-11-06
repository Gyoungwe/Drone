import { realpathSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * Whether the module at `moduleUrl` is the script Node was asked to run.
 *
 * Node resolves symlinks and percent-encodes `import.meta.url` but leaves
 * `process.argv[1]` as typed, so they only compare equal as real paths. A wrong
 * `false` makes a check exit 0 without running, so the only entry treated as "not
 * this script" is one that is absent or is not a file, as with `node -e`.
 */
export function isMainModule(moduleUrl) {
	const entry = process.argv[1];
	if (!entry) return false;
	return realpathSync(fileURLToPath(moduleUrl)) === realEntry(entry);
}

function realEntry(entry) {
	try {
		return realpathSync(entry);
	} catch (error) {
		if (error.code === "ENOENT" || error.code === "ENOTDIR") return undefined;
		throw error;
	}
}
