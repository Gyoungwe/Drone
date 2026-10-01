import { createHash, randomUUID } from "node:crypto";
import { type LiteratureReceiptOptions, normalizeDoi } from "./literature-receipt";

/**
 * Pure recovery policy for literature destination writes.
 *
 * The host adapter owns journal persistence, workspace validation, scheduling
 * and destination inspection. This package owns operation identity and journal
 * transitions; an uncertain write can never be retried or overwritten implicitly.
 */
export interface LiteratureDestinationReceipt {
	zotero?: { status?: string | null } | null;
	obsidian?: { status?: string | null } | null;
}

export interface DestinationRecovery {
	zotero: { status: string; action: string; autoWrite: false };
	obsidian: { status: string; action: string; autoWrite: false };
	completed: boolean;
	scientificallyVerified: false;
}

export function destinationRecovery(receipt: LiteratureDestinationReceipt = {}): DestinationRecovery {
	const zotero = receipt.zotero?.status || "unavailable";
	const obsidian = receipt.obsidian?.status || "unavailable";
	return {
		zotero: {
			status: zotero,
			action:
				zotero === "verified"
					? "reuse-existing-item"
					: zotero === "identity-mismatch"
						? "resolve-identity-conflict"
						: "read-back-before-any-import",
			autoWrite: false,
		},
		obsidian: {
			status: obsidian,
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

export interface LiteratureOperationReceipt extends LiteratureDestinationReceipt {
	[key: string]: unknown;
}

export interface LiteratureOperationInput {
	cwd?: string;
	runDir: string;
	doi: unknown;
	zoteroKey: string;
	notePath: string;
}

export interface LiteratureOperationLocation {
	file: string;
	/** Canonical, validated Vault path, supplied by the host. */
	vault: string | null;
	revision: number;
}

export interface LiteratureOperationRecord {
	id: string;
	doi: string;
	zoteroKey: string;
	notePath: string;
	vault: string;
	revision: number;
	status: "both-identities-verified" | "partial-or-unavailable";
	attempts: number;
	createdAt: string;
	checkedAt: string;
	destinations: DestinationRecovery;
	receipt: LiteratureOperationReceipt;
	history: Array<{ at: string; zotero: string | null | undefined; obsidian: string | null | undefined }>;
}

export interface ZoteroWriteReceipt {
	doi?: unknown;
	status?: unknown;
	reason?: unknown;
	channel?: unknown;
	zoteroKey?: unknown;
	library?: unknown;
	collection?: unknown;
	attachment?: unknown;
	fulltextStatus?: unknown;
	readBack?: unknown;
	consent?: unknown;
	writesToLibraries?: number;
	write?: { at?: string } | null;
}

export interface LiteratureWriteRecord {
	id: string;
	doi: string;
	status: string;
	reason: unknown;
	channel: unknown;
	zoteroKey: unknown;
	library: unknown;
	collection: unknown;
	attachment: unknown;
	fulltextStatus: unknown;
	readBack: unknown;
	consent: unknown;
	writesToLibraries: number;
	at: string;
}

export interface LiteratureOperationJournal {
	version: 1;
	operations: Record<string, LiteratureOperationRecord>;
	writes?: LiteratureWriteRecord[];
}

export type LiteratureOperationVerifier = (
	input: LiteratureReceiptOptions,
) => Promise<LiteratureOperationReceipt>;

/** All IO and queue ownership belong to one explicit host instance. */
export interface LiteratureOperationPorts {
	resolveRunJournal(cwd: string, runDir: string): Promise<LiteratureOperationLocation>;
	readJournal(file: string): Promise<LiteratureOperationJournal>;
	writeJournal(file: string, journal: LiteratureOperationJournal): Promise<void>;
	exclusive<T>(file: string, work: () => Promise<T>): Promise<T>;
	verify: LiteratureOperationVerifier;
	now?: () => string;
	createId?: () => string;
}

export function literatureOperationId(vault: string, revision: number, doi: unknown): string {
	const normalized = normalizeDoi(doi);
	if (!normalized) throw new Error("Valid DOI required");
	return createHash("sha256")
		.update(JSON.stringify([vault, revision, normalized]))
		.digest("hex");
}

/** Reconcile destination identity and record observations; never perform a library write. */
export function createLiteratureOperations(ports: LiteratureOperationPorts) {
	const now = ports.now || (() => new Date().toISOString());
	const createId = ports.createId || randomUUID;
	return {
		async reconcileLiteratureOperation(
			{ cwd = process.cwd(), runDir, doi, zoteroKey, notePath }: LiteratureOperationInput,
			{ verify = ports.verify }: { verify?: LiteratureOperationVerifier } = {},
		) {
			const normalized = normalizeDoi(doi);
			if (!normalized) throw new Error("Valid DOI required");
			const { file, vault, revision } = await ports.resolveRunJournal(cwd, runDir);
			if (!vault) throw new Error("No bound Vault");
			const id = literatureOperationId(vault, revision, normalized);
			return ports.exclusive(file, async () => {
				const journal = await ports.readJournal(file);
				const previous = journal.operations[id];
				if (previous && (previous.zoteroKey !== zoteroKey || previous.notePath !== notePath))
					throw new Error(
						"Operation identity changed; resolve the existing DOI/key/path mapping before retry",
					);
				const receipt = await verify({ doi: normalized, zotero_key: zoteroKey, note_path: notePath, vault });
				const destinations = destinationRecovery(receipt);
				const checkedAt = now();
				const operation: LiteratureOperationRecord = {
					id,
					doi: normalized,
					zoteroKey,
					notePath,
					vault,
					revision,
					status: destinations.completed ? "both-identities-verified" : "partial-or-unavailable",
					attempts: (previous?.attempts || 0) + 1,
					createdAt: previous?.createdAt || checkedAt,
					checkedAt,
					destinations,
					receipt,
					history: [
						...(previous?.history || []),
						{ at: checkedAt, zotero: receipt.zotero?.status, obsidian: receipt.obsidian?.status },
					].slice(-32),
				};
				journal.operations[id] = operation;
				await ports.writeJournal(file, journal);
				return {
					operation_id: id,
					log_path: file,
					status: operation.status,
					destinations,
					receipt,
					attempts: operation.attempts,
					writesToLibraries: 0 as const,
				};
			});
		},
		/** Append an observed write receipt; the journal never authorizes or drives a retry. */
		async recordZoteroWrite({
			cwd = process.cwd(),
			runDir,
			receipt,
		}: {
			cwd?: string;
			runDir: string;
			receipt: ZoteroWriteReceipt;
		}) {
			const doi = normalizeDoi(receipt?.doi);
			if (!doi) throw new Error("Valid DOI required");
			const { file } = await ports.resolveRunJournal(cwd, runDir);
			return ports.exclusive(file, async () => {
				const journal = await ports.readJournal(file);
				const entry: LiteratureWriteRecord = {
					id: createId(),
					doi,
					status: String(receipt.status || "unknown"),
					reason: receipt.reason || null,
					channel: receipt.channel || null,
					zoteroKey: receipt.zoteroKey || null,
					library: receipt.library || null,
					collection: receipt.collection || null,
					attachment: receipt.attachment || null,
					fulltextStatus: receipt.fulltextStatus || null,
					readBack: receipt.readBack || null,
					consent: receipt.consent || null,
					writesToLibraries: receipt.writesToLibraries || 0,
					at: receipt.write?.at || now(),
				};
				journal.writes = [...(Array.isArray(journal.writes) ? journal.writes : []), entry].slice(-64);
				await ports.writeJournal(file, journal);
				return {
					write_id: entry.id,
					log_path: file,
					writes: journal.writes.length,
					autoRetry: false as const,
				};
			});
		},
	};
}
