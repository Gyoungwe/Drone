import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PermissionSettingsService } from "../src/services/permissions";

function makeAgentDir(): string {
	return mkdtempSync(join(tmpdir(), "drone-permission-service-"));
}

describe("PermissionSettingsService", () => {
	it("owns the permissions.json settings boundary without constructing PiBackend", () => {
		const service = new PermissionSettingsService(makeAgentDir());
		const initial = service.getSettings();

		expect(initial.exists).toBe(false);
		expect(service.getConfig()).toEqual({ enabled: true });
		expect(service.getAuditTail()).toEqual([]);
		expect(service.probe({ tool: "bash", input: { command: "git status" } }).action).toBe("allow");

		const saved = service.saveSettings({
			settings: initial.effective,
			expectedMtimeMs: initial.mtimeMs,
		});
		expect(saved.ok).toBe(true);
		if (!saved.ok) return;
		expect(saved.snapshot.exists).toBe(true);
		expect(service.resetSettings().exists).toBe(true);
	});
});
