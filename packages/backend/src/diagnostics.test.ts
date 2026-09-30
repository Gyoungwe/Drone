import { describe, expect, it } from "vitest";
import { buildDiagnostics, redactDiagnosticText } from "./diagnostics";
import { StorageRegistry } from "./storage/registry";

describe("diagnostics", () => {
	it("redacts credential-like values", () => {
		const redacted = redactDiagnosticText("apiKey=sk-test token:abc123 password=hunter2");
		expect(redacted).not.toContain("sk-test");
		expect(redacted).not.toContain("abc123");
		expect(redacted).not.toContain("hunter2");
	});

	it("includes store metadata but never reads store contents", async () => {
		const registry = new StorageRegistry().register({
			id: "auth",
			path: "/does/not/exist/auth.json",
			owner: "settings",
			schema: 1,
			sensitivity: "secret",
		});
		const snapshot = await buildDiagnostics(registry, { version: "test", logTail: ["token=hidden"] });
		expect(snapshot.stores[0]).toMatchObject({ id: "auth", sensitivity: "secret", status: "missing" });
		expect(snapshot.logTail?.[0]).not.toContain("hidden");
	});
});
