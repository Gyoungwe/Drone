import { describe, expect, it } from "vitest";
import { KNOWLEDGE_MAX_NOTE_BYTES, validateKnowledgeNotePath } from "./knowledge-paths";

describe("knowledge path host contract", () => {
	it("keeps the WebDAV note limit explicit", () => {
		expect(KNOWLEDGE_MAX_NOTE_BYTES).toBe(1024 * 1024);
	});

	it("accepts a canonical Vault-relative note", () => {
		expect(validateKnowledgeNotePath("Library/example.md")).toBe("Library/example.md");
	});

	it.each(["/Library/example.md", "C:\\Library\\example.md", "Library/.secret.md", "library/example.md"])(
		"rejects unsafe path %s",
		(path) => {
			expect(() => validateKnowledgeNotePath(path)).toThrow();
		},
	);
});
