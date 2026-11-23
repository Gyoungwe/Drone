#!/usr/bin/env node
/**
 * Claude Code Stop hook: apply the bloat gate before lint and workspace checks.
 * Exit 2 surfaces actionable failures in the current turn.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

const input = JSON.parse(readFileSync(0, "utf8"));
// Already continuing because of this hook: let the turn end instead of looping.
if (input.stop_hook_active) process.exit(0);
process.chdir(fileURLToPath(new URL("../../", import.meta.url)));

// Run before the source filter: a docs-only change can exceed the bloat budget.
const bloat = spawnSync(process.execPath, ["scripts/check-bloat.mjs"], { encoding: "utf8" });
if (bloat.status !== 0) {
	console.error(`Stop check failed; fix before finishing:\n\n${bloat.error ?? bloat.stdout + bloat.stderr}`);
	process.exit(2);
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).split("\0").slice(0, -1);
const changed = [
	...new Set([
		...git("diff", "--name-only", "-z", "HEAD"),
		...git("ls-files", "--others", "--exclude-standard", "-z"),
	]),
].filter((file) => /\.(?:[cm]?[jt]sx?|json)$/.test(file) && existsSync(file));
if (changed.length === 0) process.exit(0);

const workspaces = [
	...new Set(changed.map((file) => file.match(/^packages\/([^/]+)\//)?.[1]).filter(Boolean)),
].filter((name) => JSON.parse(readFileSync(`packages/${name}/package.json`, "utf8")).scripts?.typecheck);
const steps = [
	["npx", ["biome", "check", "--no-errors-on-unmatched", ...changed]],
	["node", ["scripts/check-structure.mjs"]],
	...workspaces.map((name) => ["npm", ["run", "typecheck", "-w", `packages/${name}`]]),
];
const failures = [];
for (const [command, args] of steps) {
	const result = spawnSync(command, args, { encoding: "utf8" });
	if (result.status !== 0)
		failures.push(`$ ${command} ${args.join(" ")}\n${result.stdout}${result.stderr}`.slice(-4000));
}
if (failures.length > 0) {
	console.error(`Stop check failed; fix before finishing:\n\n${failures.join("\n\n")}`);
	process.exit(2);
}
