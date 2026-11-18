import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import {
	type Code,
	type Receipt,
	type ReceiptInput,
	type RequestInput,
	validateP5Receipt,
} from "@gyoungwe/plugin-api/p5-receipts";
import { JsonStore, JsonStoreCorruptedError } from "../json-store";
import type { StorageEntry, StorageRegistry } from "../storage/registry";

export const P5_RECEIPT_STORAGE = {
	id: "agent-p5-receipts",
	owner: "plugins/p5-receipt-store",
	schema: 1,
	sensitivity: "private",
} as const satisfies Omit<StorageEntry, "path">;

export class P5ReceiptStoreError extends Error {
	constructor(
		readonly code: Extract<
			Code,
			"DUPLICATE_CONFLICT" | "STATE_CONFLICT" | "INVALID_INPUT" | "READBACK_FAILED"
		>,
		message: string,
	) {
		super(message);
		this.name = "P5ReceiptStoreError";
	}
}

type ReceiptJsonStore = Pick<JsonStore<Receipt[]>, "storageId" | "read" | "writeChecked">;
type Acceptance = Omit<Receipt, "requestId">;
type Completion = Pick<Receipt, "at" | "resultSha256" | "readback" | "usage"> & {
	readonly status: Exclude<Receipt["status"], "accepted">;
};

export interface P5ReceiptStore {
	/** Host-derived IDs only. Historical records convey no execution or approval authority. */
	get(request: RequestInput): Promise<Receipt | undefined>;
	getByRef(input: ReceiptInput): Promise<Receipt | undefined>;
	/** Host observations, never plugin-supplied proof; denial can be recorded without invocation. */
	accept(request: RequestInput, metadata: Acceptance): Promise<Receipt>;
	finish(request: RequestInput, completion: Completion): Promise<Receipt>;
}

interface ReceiptStorage {
	readonly path: string;
	readonly json: ReceiptJsonStore;
}
interface Snapshot {
	readonly receipts: Receipt[];
	readonly version: string | null;
}

function validateReceipt(receipt: Receipt): void {
	if (!validateP5Receipt(receipt).ok)
		throw new P5ReceiptStoreError("INVALID_INPUT", "Invalid P5 receipt metadata");
}

function validateLedger(value: unknown, path: string): Receipt[] {
	if (!Array.isArray(value)) throw new JsonStoreCorruptedError(path);
	const requests = new Set<string>();
	const references = new Set<string>();
	for (const entry of value) {
		if (!validateP5Receipt(entry).ok) throw new JsonStoreCorruptedError(path);
		// The public validator checks the complete closed schema before this type narrowing.
		const receipt = entry as Receipt;
		if (requests.has(receipt.requestId) || references.has(receipt.receiptRef))
			throw new JsonStoreCorruptedError(path);
		requests.add(receipt.requestId);
		references.add(receipt.receiptRef);
	}
	return value as Receipt[];
}

function parseLedger(text: string, path: string): Receipt[] {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		// Parse errors can embed source text; keep receipt diagnostics content-free.
		throw new JsonStoreCorruptedError(path);
	}
	return validateLedger(value, path);
}

async function readSnapshot(path: string): Promise<Snapshot> {
	let bytes: Buffer;
	try {
		bytes = await readFile(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { receipts: [], version: null };
		throw error;
	}
	return {
		receipts: parseLedger(bytes.toString("utf8"), path),
		version: createHash("sha256").update(bytes).digest("hex"),
	};
}

async function persistReceipt(
	storage: ReceiptStorage,
	before: Snapshot,
	next: Receipt[],
	receipt: Receipt,
): Promise<Receipt> {
	return storage.json.writeChecked(next, {
		check: async () => {
			if ((await readSnapshot(storage.path)).version !== before.version)
				throw new P5ReceiptStoreError("STATE_CONFLICT", "P5 receipt ledger changed before commit");
		},
		readBack: async () => {
			// Strict disk validation must precede JsonStore.read(), which otherwise falls back on corruption.
			const persisted = await readSnapshot(storage.path);
			const reread = validateLedger(await storage.json.read(), storage.path);
			const stored = reread.find((entry) => entry.requestId === receipt.requestId);
			if (!stored || !isDeepStrictEqual(persisted.receipts, next) || !isDeepStrictEqual(reread, next))
				throw new P5ReceiptStoreError("READBACK_FAILED", "P5 receipt readback did not match the write");
			return stored;
		},
	});
}

async function acceptReceipt(
	storage: ReceiptStorage,
	request: RequestInput,
	metadata: Acceptance,
): Promise<Receipt> {
	const receipt = structuredClone({ ...metadata, requestId: request.requestId });
	validateReceipt(receipt);
	if (receipt.status !== "accepted" && !(receipt.decision === "denied" && receipt.status === "failed"))
		throw new P5ReceiptStoreError("INVALID_INPUT", "Acceptance requires an accepted or denied receipt");
	const before = await readSnapshot(storage.path);
	const existing = before.receipts.find((entry) => entry.requestId === receipt.requestId);
	if (existing) {
		if (
			existing.inputSha256 !== receipt.inputSha256 ||
			(receipt.usage !== undefined && !isDeepStrictEqual(existing.usage, receipt.usage))
		)
			throw new P5ReceiptStoreError(
				"DUPLICATE_CONFLICT",
				"P5 request ID has a different input hash or usage",
			);
		return existing;
	}
	if (before.receipts.some((entry) => entry.receiptRef === receipt.receiptRef))
		throw new P5ReceiptStoreError("DUPLICATE_CONFLICT", "P5 receipt reference is already in use");
	return persistReceipt(storage, before, [...before.receipts, receipt], receipt).catch(
		async (error: unknown) => {
			if (!(error instanceof P5ReceiptStoreError) || error.code !== "STATE_CONFLICT") throw error;
			// A concurrent acceptance can satisfy this request; reconciliation never retries the write.
			const current = (await readSnapshot(storage.path)).receipts.find(
				(entry) => entry.requestId === receipt.requestId,
			);
			if (!current) throw error;
			if (
				current.inputSha256 !== receipt.inputSha256 ||
				(receipt.usage !== undefined && !isDeepStrictEqual(current.usage, receipt.usage))
			)
				throw new P5ReceiptStoreError(
					"DUPLICATE_CONFLICT",
					"P5 request ID has a different input hash or usage",
				);
			return current;
		},
	);
}

async function finishReceipt(
	storage: ReceiptStorage,
	request: RequestInput,
	completion: Completion,
): Promise<Receipt> {
	const before = await readSnapshot(storage.path);
	const existing = before.receipts.find((entry) => entry.requestId === request.requestId);
	if (existing?.status !== "accepted")
		throw new P5ReceiptStoreError("STATE_CONFLICT", "P5 request is missing or already terminal");
	const receipt = structuredClone({
		...existing,
		status: completion.status,
		at: completion.at,
		resultSha256: completion.resultSha256,
		readback: completion.readback,
		...(completion.usage === undefined ? {} : { usage: completion.usage }),
	});
	validateReceipt(receipt);
	const next = before.receipts.map((entry) => (entry.requestId === receipt.requestId ? receipt : entry));
	return persistReceipt(storage, before, next, receipt);
}

/** Composition registers the path; no capability, execution ledger or signing key is installed here. */
export function createP5ReceiptStore(options: {
	readonly path: string;
	readonly registry: StorageRegistry;
	readonly store?: ReceiptJsonStore;
}): P5ReceiptStore {
	const entry: StorageEntry = { ...P5_RECEIPT_STORAGE, path: options.path };
	if (!options.registry.get(entry.id)) options.registry.register(entry);
	if (!isDeepStrictEqual(options.registry.assertRegistered(entry.id), entry))
		throw new Error("P5 receipt storage registration does not match the ledger");
	const json =
		options.store ??
		new JsonStore<Receipt[]>({
			path: entry.path,
			storageId: "agent-p5-receipts",
			defaultValue: () => [],
			parse: (text) => parseLedger(text, entry.path),
			mode: 0o600,
		});
	if (json.storageId !== entry.id) throw new Error("P5 receipt JsonStore has a different storage ID");
	const storage: ReceiptStorage = { path: entry.path, json };
	return {
		get: async (request) =>
			(await readSnapshot(storage.path)).receipts.find((entry) => entry.requestId === request.requestId),
		getByRef: async (input) =>
			(await readSnapshot(storage.path)).receipts.find((entry) => entry.receiptRef === input.receiptRef),
		accept: (request, metadata) => acceptReceipt(storage, request, metadata),
		finish: (request, completion) => finishReceipt(storage, request, completion),
	};
}
