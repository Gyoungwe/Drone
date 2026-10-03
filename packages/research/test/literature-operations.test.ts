import { describe, expect, it } from "vitest";
import { createLiteratureOperations, destinationRecovery } from "../src/literature-operations";

describe("literature destination recovery", () => {
	it("keeps uncertain destinations read-only", () => {
		const result = destinationRecovery({
			zotero: { status: "unavailable" },
			obsidian: { status: "verified" },
		});
		expect(result).toMatchObject({
			completed: false,
			scientificallyVerified: false,
			zotero: { status: "unavailable", action: "read-back-before-any-import", autoWrite: false },
			obsidian: { status: "verified", action: "preserve-existing-note", autoWrite: false },
		});
	});

	it("requires both exact destination identities before completion", () => {
		expect(
			destinationRecovery({ zotero: { status: "verified" }, obsidian: { status: "verified" } }).completed,
		).toBe(true);
		expect(
			destinationRecovery({ zotero: { status: "identity-mismatch" }, obsidian: { status: "missing" } }),
		).toMatchObject({
			zotero: { action: "resolve-identity-conflict" },
			obsidian: { action: "deposit-missing-note-with-authorization" },
			completed: false,
		});
	});
});

describe("literature operation host adapter boundary", () => {
	function makePorts(receipts: Array<Record<string, unknown>>) {
		const journals = new Map<string, import("../src/literature-operations").LiteratureOperationJournal>();
		return {
			journals,
			ports: {
				resolveRunJournal: async () => ({
					file: "run/literature-operations.json",
					vault: "/vault",
					revision: 3,
				}),
				readJournal: async (file: string) => journals.get(file) || { version: 1 as const, operations: {} },
				writeJournal: async (
					file: string,
					journal: import("../src/literature-operations").LiteratureOperationJournal,
				) => {
					journals.set(file, structuredClone(journal));
				},
				exclusive: async <T>(_file: string, work: () => Promise<T>) => work(),
				verify: async () =>
					receipts.shift() || { zotero: { status: "unavailable" }, obsidian: { status: "unavailable" } },
				now: () => "2026-10-01T00:00:00.000Z",
				createId: () => "write-id",
			},
		};
	}

	it("keeps filesystem and queue effects behind explicit ports", async () => {
		const { ports, journals } = makePorts([
			{ zotero: { status: "verified" }, obsidian: { status: "missing" } },
			{ zotero: { status: "verified" }, obsidian: { status: "verified" } },
		]);
		const operations = createLiteratureOperations(ports);
		const input = {
			runDir: "run",
			doi: "https://doi.org/10.1234/Paper",
			zoteroKey: "ABCDEFGH",
			notePath: "Library/Papers/paper.md",
		};
		const partial = await operations.reconcileLiteratureOperation(input);
		const complete = await operations.reconcileLiteratureOperation(input);
		expect(complete.operation_id).toBe(partial.operation_id);
		expect(complete.attempts).toBe(2);
		expect(complete.destinations.completed).toBe(true);
		expect(
			journals.get("run/literature-operations.json")?.operations[complete.operation_id]?.history,
		).toHaveLength(2);
	});

	it("records observed writes without authorizing retries", async () => {
		const { ports } = makePorts([]);
		const operations = createLiteratureOperations(ports);
		const result = await operations.recordZoteroWrite({
			runDir: "run",
			receipt: { doi: "10.1234/Paper", status: "unverified", writesToLibraries: 1 },
		});
		expect(result).toMatchObject({ write_id: "write-id", writes: 1, autoRetry: false });
	});
});
