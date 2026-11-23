/**
 * Locates a touched file by repository rather than by the session's start directory: Drone work happens
 * across many worktrees and the sibling drone-plugins checkout, and a rule written as `drone:packages/...`
 * must hold in each of them. The repository is identified by its root package name, not its folder name.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const REPOS = new Map([
	["drone", "drone"],
	["@drone/plugins-workspace", "drone-plugins"],
]);

function gitRoot(absolute) {
	for (let dir = path.dirname(absolute); dir !== path.dirname(dir); dir = path.dirname(dir)) {
		if (existsSync(path.join(dir, ".git"))) return dir;
	}
	return null;
}

function repoName(root) {
	const manifest = path.join(root, "package.json");
	if (!existsSync(manifest)) return null;
	return REPOS.get(JSON.parse(readFileSync(manifest, "utf8")).name) ?? null;
}

/**
 * Returns the key rules match against: `drone:packages/x.ts`, `drone-plugins:packages/y.ts`, or
 * `:/abs/path` for a file outside both repositories (`repo` is then null).
 */
export function locate(absolute) {
	const root = gitRoot(absolute);
	const repo = root === null ? null : repoName(root);
	if (root === null || repo === null) return { repo: null, key: `:${absolute}` };
	const relative = path.relative(root, absolute).split(path.sep).join("/");
	return { repo, key: `${repo}:${relative}` };
}
