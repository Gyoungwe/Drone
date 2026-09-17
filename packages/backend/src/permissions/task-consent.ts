import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

function protectedPath(path: string): boolean {
	const parts = path.replaceAll("\\", "/").toLowerCase().split("/");
	const name = parts.at(-1) || "";
	return (
		parts.some((p) => [".git", ".ssh", ".gnupg", ".aws", ".azure"].includes(p)) ||
		parts.some((p, i) => p === ".pi" && ["agent", "agent-dev"].includes(parts[i + 1] || "")) ||
		/^(?:\.env(?:\..*)?|\.npmrc|\.netrc|\.git-credentials|auth\.json|review-policy\.json|permissions\.json|workspaces\.json|trust\.json|models\.json|.*credentials.*|.*secrets?.*|\.?mcp.*\.json|id_(?:rsa|ed25519).*)$/i.test(
			name,
		) ||
		/\.(?:pem|key|p12|pfx)$/i.test(name) ||
		/^(?:[a-z]:\/(?:windows|program files(?: \(x86\))?)|\/(?:etc|usr|bin|sbin|system|library))(?:\/|$)/i.test(
			path.replaceAll("\\", "/"),
		)
	);
}
/** Resolve existing ancestors. A dangling link is NOT treated as a missing ordinary file. */
async function canonicalTarget(path: string): Promise<string> {
	let cursor = resolve(path);
	const suffix: string[] = [];
	for (;;) {
		try {
			return resolve(await realpath(cursor), ...suffix);
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
			try {
				await lstat(cursor);
				throw new Error("Unresolved existing path");
			} catch (missing) {
				if ((missing as NodeJS.ErrnoException).code !== "ENOENT") throw missing;
			}
			const parent = dirname(cursor);
			if (parent === cursor) throw e;
			suffix.unshift(basename(cursor));
			cursor = parent;
		}
	}
}
/** Roots come from a current, host-validated task consent, never from tool arguments. */
export async function taskWriteAllowed(roots: unknown, path: string): Promise<boolean> {
	if (!Array.isArray(roots) || roots.length > 8 || protectedPath(path)) return false;
	try {
		const target = await canonicalTarget(path);
		if (protectedPath(target)) return false;
		try {
			if ((await lstat(target)).nlink > 1) return false;
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== "ENOENT") return false;
		}
		return roots.some((root) => {
			if (typeof root !== "string" || !isAbsolute(root) || root.length > 512) return false;
			const rel = relative(root, target);
			return rel !== "" && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
		});
	} catch {
		return false;
	}
}
