/**
 * Testable host adapter for the research domain.
 *
 * The research package owns the loop, archive and receipt-journal semantics;
 * this module supplies the workspace and host ports that used to be provided
 * by the generated Pi compatibility files. Keeping the adapter in the
 * extensions package lets integration tests exercise the same public graph as
 * the extension entry points without reaching into `.pi` resources.
 */

import { randomUUID } from "node:crypto";
import { readFile, realpath, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { verifyLiteratureReceipt } from "@drone/research/literature-receipt";
import { createLiteratureOperations } from "@drone/research/literature-operations";
import { createResearchReceiptJournal as createTypedJournal } from "@drone/research/receipt-journal";
import { createResearchLoop } from "@drone/research/research-loop";
import { observeExecutionReceipt } from "@drone/research/run-provenance";
import {
	archiveSource as archiveTyped,
	sourceStatus as sourceStatusTyped,
} from "@drone/research/source-archive";
import { toolMeta } from "@drone/tasks/tool-manifest-runtime";
import { publishSourceNote } from "./obsidian-workbench";
import { loadWorkspaceConfig } from "../workspace-config";
import {
	buildProxiedUrl,
	institutionalFetch,
	isElectronAvailable,
	loadInstitutionalConfig,
} from "../institutional-access";

const exclusiveTails = new Map<string, Promise<unknown>>();
function exclusive<T>(key: string, work: () => Promise<T>): Promise<T> {
	const previous = exclusiveTails.get(key) ?? Promise.resolve();
	const current = previous.catch(() => {}).then(work);
	exclusiveTails.set(key, current);
	return current.finally(() => {
		if (exclusiveTails.get(key) === current) exclusiveTails.delete(key);
	});
}

export const archivePorts: any = {
	workspace: async (cwd: string) => (await loadWorkspaceConfig(cwd)) as any,
	publishSourceNote,
	exclusive,
	loadInstitutionalConfig,
	isElectronAvailable,
	institutionalFetch,
	buildProxiedUrl,
};

const contained = (root: string, target: string) => {
	const rel = relative(root, target);
	return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};
async function resolveRunJournal(cwd: string, runDir: string) {
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
async function readJournal(file: string) {
	try {
		const value = JSON.parse(await readFile(file, "utf8"));
		if (value?.version !== 1 || !value.operations || typeof value.operations !== "object")
			throw new Error("Invalid operation log");
		return value;
	} catch (error: any) {
		if (error?.code !== "ENOENT") throw error;
		return { version: 1, operations: {} };
	}
}
async function writeJournal(file: string, journal: any) {
	const temporary = `${file}.${randomUUID()}.tmp`;
	await writeFile(temporary, `${JSON.stringify(journal, null, 2)}\n`);
	await rename(temporary, file);
}
const operations = createLiteratureOperations({
	resolveRunJournal,
	readJournal,
	writeJournal,
	exclusive: (file, work) => exclusive(file, work),
	verify: verifyLiteratureReceipt as any,
});
export const reconcileLiteratureOperation = operations.reconcileLiteratureOperation;
export const recordZoteroWrite = operations.recordZoteroWrite;

const loop = createResearchLoop({
	workspace: async (cwd) => (await loadWorkspaceConfig(cwd)) as any,
	verifyLiteratureReceipt: (input) => verifyLiteratureReceipt(input as any),
	exclusive,
	sourceStatus: async ({ cwd, run_dir, verify }) =>
		sourceStatusTyped({ cwd, run_dir, verify }, archivePorts),
});
export const startResearchRun = (...args: any[]) => loop.startResearchRun(...args);
export const updateResearchLoop = (...args: any[]) => loop.updateResearchLoop(...args);
export const completeResearchGate = (...args: any[]) => loop.completeResearchGate(...args);
export const observeResearchReceipt = (...args: any[]) => loop.observeResearchReceipt(...args);
export const flushResearchReceipts = (...args: any[]) => loop.flushResearchReceipts(...args);
export const resetResearchReceipts = (...args: any[]) => loop.resetResearchReceipts(...args);
export const topicIdFromResultSlug = (...args: any[]) => (loop.topicIdFromResultSlug as any)(...args);
export const archiveSource = (options: Record<string, unknown> = {}) => archiveTyped(options, archivePorts);
export const sourceStatus = (options: Record<string, unknown> = {}) => sourceStatusTyped(options, archivePorts);

const owners = new Map<string, symbol>();
export function createResearchReceiptJournal(
	cwd: string,
	{ sessionId = null }: { sessionId?: string | null } = {},
) {
	return createTypedJournal(cwd, {
		sessionId,
		ports: {
			workspace: async (workspaceCwd) => (await loadWorkspaceConfig(workspaceCwd)) as any,
			status: async (workspaceCwd, runDir) =>
				updateResearchLoop({ cwd: workspaceCwd, runDir, action: "status" }),
			flush: async (workspaceCwd, runDir) => flushResearchReceipts({ cwd: workspaceCwd, runDir }),
			reset: (workspaceCwd, runDir) => resetResearchReceipts({ cwd: workspaceCwd, runDir }),
			observeExecution: (event) => observeExecutionReceipt(event as any),
			observeResearch: (event) => observeResearchReceipt(event as any),
			isJournalTool: (name) => toolMeta(name)?.journal === true,
			owners,
		},
	});
}
