import { describe, expect, it } from "vitest";
import { destinationRecovery } from "../src/literature-operations";

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
