import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { loadWorkspaceConfig } from "../extensions/workspace-config.mjs";
import { normalizeDoi, verifyLiteratureReceipt } from "./literature-receipt.mjs";

const queues = new Map();
const contained = (root, path) => {
	const rel = relative(root, path);
	return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};
export function destinationRecovery(receipt) {
	const zotero = receipt.zotero?.status,
		obsidian = receipt.obsidian?.status;
	return {
		zotero: {
			status: zotero || "unavailable",
			action:
				zotero === "verified"
					? "reuse-existing-item"
					: zotero === "identity-mismatch"
						? "resolve-identity-conflict"
						: "read-back-before-any-import",
			autoWrite: false,
		},
		obsidian: {
			status: obsidian || "unavailable",
			action:
				obsidian === "verified"
					? "preserve-existing-note"
					: obsidian === "missing"
						? "deposit-missing-note-with-authorization"
						: obsidian === "identity-mismatch"
							? "review-note-conflict-preserve-human-content"
							: "wait-and-recheck-vault",
			autoWrite: false,
		},
		completed: zotero === "verified" && obsidian === "verified",
		scientificallyVerified: false,
	};
}
/** Reconcile first, never repeat a destination write on an uncertain response. */
export async function reconcileLiteratureOperation(
	{ cwd = process.cwd(), runDir, doi, zoteroKey, notePath },
	{ verify = verifyLiteratureReceipt } = {},
) {
	doi = normalizeDoi(doi);
	if (!doi) throw new Error("Valid DOI required");
	const config = await loadWorkspaceConfig(cwd);
	const root = await realpath(config.resultsRoot),
		run = await realpath(resolve(cwd, runDir || ""));
	const parts = relative(root, run).split(sep);
	if (!contained(root, run) || parts.length !== 2 || !parts[1].startsWith("run-"))
		throw new Error("Operation log must be inside a research run");
	await readFile(join(run, "metadata.json"), "utf8");
	if (!config.obsidianVault) throw new Error("No bound Vault");
	const vault = await realpath(config.obsidianVault),
		revision = config.knowledgeBindingRevision || 0;
	const id = createHash("sha256")
		.update(JSON.stringify([vault, revision, doi]))
		.digest("hex");
	const file = join(run, "literature-operations.json");
	const job = (queues.get(file) || Promise.resolve())
		.catch(() => {})
		.then(async () => {
			let journal = { version: 1, operations: {} };
			try {
				journal = JSON.parse(await readFile(file, "utf8"));
				if (journal.version !== 1 || !journal.operations) throw new Error("Invalid operation log");
			} catch (e) {
				if (e.code !== "ENOENT") throw e;
			}
			const previous = journal.operations[id];
			if (previous && (previous.zoteroKey !== zoteroKey || previous.notePath !== notePath))
				throw new Error("Operation identity changed; resolve the existing DOI/key/path mapping before retry");
			const receipt = await verify({ doi, zotero_key: zoteroKey, note_path: notePath, vault });
			const destinations = destinationRecovery(receipt),
				now = new Date().toISOString();
			const operation = {
				id,
				doi,
				zoteroKey,
				notePath,
				vault,
				revision,
				status: destinations.completed ? "both-identities-verified" : "partial-or-unavailable",
				attempts: (previous?.attempts || 0) + 1,
				createdAt: previous?.createdAt || now,
				checkedAt: now,
				destinations,
				receipt,
				history: [
					...(previous?.history || []),
					{ at: now, zotero: receipt.zotero.status, obsidian: receipt.obsidian.status },
				].slice(-32),
			};
			journal.operations[id] = operation;
			const temp = `${file}.${randomUUID()}.tmp`;
			await writeFile(temp, JSON.stringify(journal, null, 2));
			await rename(temp, file);
			return {
				operation_id: id,
				log_path: file,
				status: operation.status,
				destinations,
				receipt,
				attempts: operation.attempts,
				writesToLibraries: 0,
			};
		});
	queues.set(file, job);
	void job
		.finally(() => {
			if (queues.get(file) === job) queues.delete(file);
		})
		.catch(() => {});
	return job;
}
