import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getZoteroStatus } from "../src/zotero/status";

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "zotero-status-"));
	vi.stubEnv("PI_CODING_AGENT_DIR", dir);
});
afterEach(async () => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	await rm(dir, { recursive: true, force: true });
});

function writeMcp(value: unknown): Promise<void> {
	return writeFile(join(dir, "mcp.json"), JSON.stringify(value));
}

it("reports not-registered when mcp.json is absent", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(() => Promise.reject(new Error("unreachable"))),
	);
	const s = await getZoteroStatus();
	expect(s.registered).toBe(false);
	expect(s.enabled).toBe(false);
	expect(s.command).toBeNull();
	expect(s.localApiReachable).toBe(false);
	expect(typeof s.desktopDetected).toBe("boolean");
	expect(s.docsUrl).toContain("zotero-mcp");
});

it("reports registered but not enabled when the zotero server is disabled", async () => {
	await writeMcp({
		mcpServers: { zotero: { command: "/bin/zotero-mcp", env: { ZOTERO_LOCAL: "true" }, disabled: true } },
	});
	vi.stubGlobal(
		"fetch",
		vi.fn(() => Promise.reject(new Error("unreachable"))),
	);
	const s = await getZoteroStatus();
	expect(s.registered).toBe(true);
	expect(s.enabled).toBe(false);
	expect(s.command).toBe("/bin/zotero-mcp");
});

it("reports enabled and localApi reachable when disabled=false and fetch resolves", async () => {
	await writeMcp({ mcpServers: { zotero: { command: "z-mcp", disabled: false } } });
	vi.stubGlobal(
		"fetch",
		vi.fn(() => Promise.resolve(new Response("ok"))),
	);
	const s = await getZoteroStatus();
	expect(s.enabled).toBe(true);
	expect(s.localApiReachable).toBe(true);
});

it("treats a missing disabled flag as enabled (registered server)", async () => {
	await writeMcp({ mcpServers: { zotero: { command: "z-mcp" } } });
	vi.stubGlobal(
		"fetch",
		vi.fn(() => Promise.reject(new Error("unreachable"))),
	);
	const s = await getZoteroStatus();
	expect(s.registered).toBe(true);
	expect(s.enabled).toBe(true);
});
