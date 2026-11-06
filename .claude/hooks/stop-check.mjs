#!/usr/bin/env node
/**
 * Claude Code Stop hook: before a turn ends, lint the changed files, run the
 * structure baseline and typecheck the changed workspaces. Failures are
 * returned to Claude (exit 2) so they are fixed in the same turn.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";

const input = JSON.parse(readFileSync(0, "utf8"));
// Already continuing because of this hook: let the turn end instead of looping.
if (input.stop_hook_active) process.exit(0);

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).split("\n").filter(Boolean);
const changed = [
	...new Set([...git("diff", "--name-only", "HEAD"), ...git("ls-files", "--others", "--exclude-standard")]),
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
