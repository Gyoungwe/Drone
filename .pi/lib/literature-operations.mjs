/** Host adapter for @drone/research/literature-operations. */
import { randomUUID } from "node:crypto";
import { readFile, realpath, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { loadWorkspaceConfig } from "../extensions/workspace-config.mjs";
import { normalizeDoi, verifyLiteratureReceipt } from "./literature-receipt.mjs";
import { runRuntimeExclusive } from "./runtime-bridge.mjs";
// Keep the packaged host adapter self-contained. The generated core is copied
// into the same `.pi/lib` tree, so release resources do not require workspace
// `node_modules` to resolve the typed package entry.
import { createLiteratureOperations as createTypedOperations, destinationRecovery } from "./literature-operations-core.mjs";

const contained = (root, target) => {
	const rel = relative(root, target);
	return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

async function resolveRunJournal(cwd, runDir) {
	const config = await loadWorkspaceConfig(cwd);
	const root = await realpath(config.resultsRoot);
	const run = await realpath(resolve(cwd, runDir || ""));
	const parts = relative(root, run).split(sep);
	if (!contained(root, run) || parts.length !== 2 || !parts[1].startsWith("run-"))
		throw new Error("Operation log must be inside a research run");
	await readFile(join(run, "metadata.json"), "utf8");
	return {
		file: join(run, "literature-operations.json"),
		vault: config.obsidianVault ? await realpath(config.obsidianVault) : null,
		revision: Number(config.knowledgeBindingRevision || 0),
	};
}

async function readJournal(file) {
	try {
		const value = JSON.parse(await readFile(file, "utf8"));
		if (value?.version !== 1 || !value.operations || typeof value.operations !== "object")
			throw new Error("Invalid operation log");
		return value;
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
		return { version: 1, operations: {} };
	}
}

async function writeJournal(file, journal) {
	const temporary = `${file}.${randomUUID()}.tmp`;
	await writeFile(temporary, `${JSON.stringify(journal, null, 2)}\n`);
	await rename(temporary, file);
}

const operations = createTypedOperations({
	resolveRunJournal,
	readJournal,
	writeJournal,
	exclusive: (file, work) => runRuntimeExclusive("literature-operation", file, work),
	verify: verifyLiteratureReceipt,
});

export { destinationRecovery, normalizeDoi };
export const reconcileLiteratureOperation = operations.reconcileLiteratureOperation;
export const recordZoteroWrite = operations.recordZoteroWrite;
