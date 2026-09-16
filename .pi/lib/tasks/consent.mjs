import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, parse, relative, resolve } from "node:path";

export const MAX_AUTO_RESUMES = 3;
export function contractHash(task) {
	return createHash("sha256")
		.update(
			JSON.stringify([
				task.id,
				task.goal,
				task.binding ?? null,
				task.authorizationSummary ?? "",
				task.writeRoots ?? [],
				task.milestones.map(({ id, title, dependsOn, acceptance }) => ({ id, title, dependsOn, acceptance })),
			]),
		)
		.digest("hex");
}
/** Only an explicit, revision-checked task-action creates this record. No legacy auto-grant. */
export function hasTaskConsent(task, maxCalls) {
	const c = task?.executionConsent;
	return !!(
		task?.planApproved &&
		task.milestones.length &&
		c?.version === 1 &&
		c.contractHash === contractHash(task) &&
		c.maxCalls === maxCalls &&
		c.maxAutoResumes === MAX_AUTO_RESUMES &&
		typeof c.approvedAt === "string"
	);
}
/** Resolve BEFORE the user approves, so the card shows the actual existing directory. */
export async function resolveWriteRoots(cwd, paths = []) {
	if (!Array.isArray(paths) || paths.length > 8) throw new Error("Choose at most eight project directories.");
	const roots = [];
	const home = await realpath(homedir());
	for (const p of paths) {
		if (typeof p !== "string" || !p.trim() || p.length > 512) throw new Error("Invalid write directory.");
		const root = await realpath(resolve(cwd, p));
		const homeRelative = relative(root, home);
		if (root === parse(root).root || (!isAbsolute(homeRelative) && !homeRelative.startsWith("..")))
			throw new Error("Authorize a project directory, not a drive, home directory or its parent.");
		if (!(await stat(root)).isDirectory())
			throw new Error("Authorize an existing project directory; outputs may create subdirectories.");
		if (!roots.includes(root)) roots.push(root);
	}
	return roots;
}
