import { realpath } from "node:fs/promises";
import {
	ReceiptJournalBuffer,
	receiptBelongsToRun,
	shouldRecordResearchReceipt,
} from "./receipt-journal-policy";

export interface ResearchJournalWorkspace {
	obsidianVault?: string | null;
	knowledgeBindingRevision?: number | null;
}

export interface ResearchJournalPorts {
	workspace(cwd: string): Promise<ResearchJournalWorkspace>;
	status(cwd: string, runDir: string): Promise<{ run_dir: string }>;
	flush(cwd: string, runDir: string): Promise<void>;
	reset(cwd: string, runDir: string): void;
	observeExecution(event: Record<string, unknown> & { cwd: string; runDir: string }): Promise<unknown>;
	observeResearch(event: Record<string, unknown> & { cwd: string; runDir: string }): Promise<unknown>;
	isJournalTool?(toolName: string): boolean;
	owners?: Map<string, symbol>;
}

export interface ResearchReceiptEvent {
	toolName?: string;
	toolCallId?: string;
	isError?: boolean;
	args?: Record<string, unknown>;
	details?: Record<string, unknown>;
	[key: string]: unknown;
}

/** Host-injected journal; the package owns bounds, deduplication and run scope. */
export function createResearchReceiptJournal(
	cwd: string,
	{ sessionId = null, ports }: { sessionId?: string | null; ports: ResearchJournalPorts },
) {
	const owners = ports.owners || new Map<string, symbol>();
	const owner = Symbol("research-turn");
	const buffer = new ReceiptJournalBuffer<ResearchReceiptEvent>();
	const runs = new Set<string>();
	let active = true;
	let currentRun: string | undefined;
	let tail: Promise<unknown> = Promise.resolve();

	const belongs = (receipt: ResearchReceiptEvent, runDir: string) =>
		receiptBelongsToRun(receipt, cwd, runDir);
	const serial = <T>(work: () => Promise<T>): Promise<T> => {
		const next = tail.catch(() => {}).then(() => (active ? work() : null));
		tail = next;
		return next as Promise<T>;
	};
	const attach = async (runDir: string) => {
		if (!runDir) return;
		const status = await ports.status(cwd, runDir);
		const path = status.run_dir;
		if (owners.has(path) && owners.get(path) !== owner)
			throw new Error("Research run is owned by another active session/turn; create a separate run");
		if (!runs.has(path)) {
			owners.set(path, owner);
			await ports.flush(cwd, path);
			ports.reset(cwd, path);
			runs.add(path);
			for (const receipt of buffer.values()) {
				if (!belongs(receipt, path)) continue;
				await ports.observeExecution({ ...receipt, sessionId, cwd, runDir: path });
				await ports.observeResearch({ ...receipt, sessionId, cwd, runDir: path });
			}
		}
		currentRun = path;
	};
	return {
		currentRun: () => currentRun,
		record(event: ResearchReceiptEvent) {
			if (!active || !shouldRecordResearchReceipt(event, ports.isJournalTool)) return Promise.resolve(null);
			const snapshot =
				event.toolName === "research_read_knowledge"
					? ports
							.workspace(cwd)
							.then(async (config) => ({
								vault: config.obsidianVault ? await realpath(config.obsidianVault) : null,
								revision: config.knowledgeBindingRevision || 0,
							}))
							.catch(() => ({ vault: null, revision: -1 }))
					: Promise.resolve(undefined);
			const receipt: ResearchReceiptEvent = {
				...structuredClone(event),
				sessionId,
				observedAt: new Date().toISOString(),
			};
			return serial(async () => {
				if (buffer.add(receipt) === false) return null;
				receipt.readBinding = await snapshot;
				if (currentRun && belongs(receipt, currentRun)) {
					await ports.observeExecution({ ...receipt, cwd, runDir: currentRun });
					return ports.observeResearch({ ...receipt, cwd, runDir: currentRun });
				}
				return null;
			});
		},
		execute(runDir: string | null | undefined, work: () => Promise<Record<string, unknown>>) {
			return serial(async () => {
				if (runDir) await attach(runDir);
				const result = await work();
				if (typeof result.run_dir === "string") await attach(result.run_dir);
				const refreshed =
					typeof result.run_dir === "string" ? await ports.status(cwd, result.run_dir) : result;
				return {
					...result,
					...refreshed,
					receipt_journal: { ...buffer.snapshot() },
				};
			});
		},
		async close() {
			active = false;
			await tail.catch(() => {});
			for (const runDir of runs) {
				await ports.flush(cwd, runDir);
				if (owners.get(runDir) === owner) {
					ports.reset(cwd, runDir);
					owners.delete(runDir);
				}
			}
			runs.clear();
			buffer.clear();
		},
	};
}
