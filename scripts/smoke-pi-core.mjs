#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPinnedCoreArtifact } from "./build-pi-core.mjs";

export async function smokePinnedCore(repoRoot = resolve(import.meta.dirname, "..")) {
	const artifact = await verifyPinnedCoreArtifact(repoRoot);
	const bundle = await readFile(join(artifact.packageRoot, "dist/index.mjs"), "utf8");
	const expected = [
		"ask_user",
		"set_status",
		"todo",
		"deliver_files",
		"memory_save",
		"task_plan",
		"drone-doctor",
		"drone-example",
	];
	for (const name of expected)
		if (!bundle.includes(JSON.stringify(name))) throw new Error(`pi-core smoke: missing ${name}`);
	if (/(?:from|import\s*\(|require\s*\()["'](?:electron|@drone\/)[^"']*["']/u.test(bundle))
		throw new Error("pi-core smoke: host-only import found");
	return { version: artifact.version, tools: expected };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const receipt = await smokePinnedCore();
	console.log(
		`Pinned pi-core ${receipt.version} bundle smoke passed (${receipt.tools.length} core tools + task runtime)`,
	);
}
