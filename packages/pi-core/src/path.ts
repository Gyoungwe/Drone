import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const UNICODE_SPACES = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000\uFEFF]/g;

/** Resolve the portable tool path forms accepted by Pi (relative, ~, absolute). */
export function resolveToolPath(rawPath: string, cwd: string, home: string = homedir()): string {
	let path = rawPath.replace(UNICODE_SPACES, " ");
	if (path === "~") path = home;
	else if (path.startsWith("~/")) path = join(home, path.slice(2));
	return isAbsolute(path) ? path : resolve(cwd, path);
}
