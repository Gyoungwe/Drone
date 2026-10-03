import { describe, expect, it } from "vitest";
import {
	DIAGNOSTICS_ARCHIVE_PREFIX,
	type DiagnosticsSnapshot,
	serializeDiagnosticsArchive,
	serializeDiagnosticsPackage,
} from "./diagnostics";

const snapshot: DiagnosticsSnapshot = {
	version: "0.11.0",
	platform: "darwin",
	node: "v22.19.0",
	generatedAt: "2026-10-01T00:00:00.000Z",
	stores: [
		{
			id: "agent-auth",
			path: "<redacted>/auth.json",
			owner: "settings/login",
			schema: 1,
			sensitivity: "secret",
			status: "ok",
		},
	],
	incidentSnapshot: { reason: "renderer-crash", path: "<redacted>/vault.json" },
	logTail: ["level=error message=renderer exited"],
};

function decodeArchivePayload(value: string): string {
	expect(value.startsWith(DIAGNOSTICS_ARCHIVE_PREFIX)).toBe(true);
	const base64 = value.slice(DIAGNOSTICS_ARCHIVE_PREFIX.length);
	const binary = atob(base64);
	return Array.from(binary, (character) => String.fromCharCode(character.charCodeAt(0))).join("");
}

describe("diagnostics archive", () => {
	it("retains the portable JSON package schema", () => {
		const packageJson = JSON.parse(serializeDiagnosticsPackage(snapshot)) as {
			format: string;
			schema: number;
		};
		expect(packageJson).toMatchObject({ format: "drone-diagnostics", schema: 1 });
	});

	it("serializes a ZIP payload with only redacted support entries", () => {
		const payload = serializeDiagnosticsArchive(snapshot);
		const binary = decodeArchivePayload(payload);

		// ZIP local-file and end-of-central-directory signatures are present.
		expect(binary.slice(0, 4)).toBe("PK\u0003\u0004");
		expect(binary).toContain("diagnostics.json");
		expect(binary).toContain("README.txt");
		expect(binary).toContain("drone-diagnostics");
		expect(binary).not.toContain("auth.json content");
		expect(binary).not.toContain("session body");
		expect(binary).not.toContain("apiKey");
	});
});
