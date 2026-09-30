import { DIAGNOSTICS_ARCHIVE_PREFIX, serializeDiagnosticsArchive } from "@drone/shared";
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
			path: "/Users/test-user/private/auth.json",
			owner: "settings",
			schema: 1,
			sensitivity: "secret",
		});
		const snapshot = await buildDiagnostics(registry, { version: "test", logTail: ["token=hidden"] });
		expect(snapshot.stores[0]).toMatchObject({ id: "auth", sensitivity: "secret", status: "missing" });
		expect(snapshot.logTail?.[0]).not.toContain("hidden");
		expect(snapshot.stores[0]?.path).not.toContain("/Users/test-user/private");
		const windows = await buildDiagnostics(
			new StorageRegistry().register({
				id: "windows-auth",
				path: "C:\\Users\\test-user\\auth.json",
				owner: "settings",
				schema: 1,
				sensitivity: "secret",
			}),
			{ version: "test" },
		);
		expect(windows.stores[0]?.path).toBe("<redacted>/auth.json");
	});

	it("redacts incident credentials, paths, and session content", async () => {
		const registry = new StorageRegistry();
		const snapshot = await buildDiagnostics(registry, {
			version: "test",
			incidentSnapshot: {
				reason: "renderer-crash",
				path: "/Users/test-user/private/vault.json",
				apiKey: "sk-fake-key",
				message: "private session body",
				processes: [{ type: "GPU", memoryMb: 12 }],
				sessions: [{ id: "abcd1234", rate1m: 4, lastEventAgeMs: 8 }],
			},
			logTail: ["authorization=Bearer fake-token", "path=/Users/test-user/private/session.jsonl"],
		});
		const serialized = JSON.stringify(snapshot);
		expect(serialized).not.toContain("sk-fake-key");
		expect(serialized).not.toContain("fake-token");
		expect(serialized).not.toContain("/Users/test-user/private");
		expect(serialized).not.toContain("private session body");
		expect(snapshot.incidentSnapshot).toMatchObject({
			reason: "renderer-crash",
			path: "<redacted>/vault.json",
			processes: [{ type: "GPU", memoryMb: 12 }],
			sessions: [{ id: "abcd1234", rate1m: 4, lastEventAgeMs: 8 }],
		});
	});

	it("packages the redacted snapshot without exposing raw storage data", async () => {
		const snapshot = await buildDiagnostics(new StorageRegistry(), {
			version: "test",
			incidentSnapshot: { apiKey: "sk-never-export", path: "/Users/test-user/vault.json" },
			logTail: ["token=never-export"],
		});
		const archive = serializeDiagnosticsArchive(snapshot);
		expect(archive.startsWith(DIAGNOSTICS_ARCHIVE_PREFIX)).toBe(true);
		const binary = atob(archive.slice(DIAGNOSTICS_ARCHIVE_PREFIX.length));
		const text = Array.from(binary, (character) => String.fromCharCode(character.charCodeAt(0))).join("");
		expect(text).toContain("diagnostics.json");
		expect(text).not.toContain("sk-never-export");
		expect(text).not.toContain("never-export");
		expect(text).not.toContain("/Users/test-user");
	});
});
