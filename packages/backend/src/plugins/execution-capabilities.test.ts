import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { canonicalProjectId } from "../project-id";
import { StorageRegistry } from "../storage/registry";
import { createPluginExecutionCapabilities } from "./execution-capabilities";
import { PluginRuntimeRegistry } from "./runtime";
import type { PluginCapabilityContext } from "./runtime-capabilities";
import type { PluginSessionCallerContext } from "./session-caller";

let root: string;
let selected: PluginSessionCallerContext;
beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "execution-capability-test-")));
	selected = {
		identity: {},
		scope: {
			kind: "session",
			sessionId: "live-session",
			workspaceDirectory: root,
			workspaceId: canonicalProjectId(root),
		},
		signal: new AbortController().signal,
		readOnly: false,
		projectTrusted: true,
	};
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});
const request = {
	requestId: "missing-image-1",
	language: "python",
	code: "print('never executes without the exact cached image')",
	runDirectory: "runs/never-started",
	image: `sha256:${"0".repeat(64)}`,
	timeoutMs: 1000,
	maxOutputBytes: 1024,
	dataClassification: "public",
};
async function capabilities() {
	return createPluginExecutionCapabilities({
		directory: join(root, "private-receipts"),
		sourceIdentity: "actual-installed-content",
		integrityKey: randomBytes(32),
		storage: new StorageRegistry(),
		getSessionContext: (id) => (id === selected.scope.sessionId ? selected : undefined),
	});
}
const context = (): PluginCapabilityContext => ({
	pluginId: "@example/runner",
	applicationId: "application",
	scope: selected.scope,
	signal: selected.signal,
	callerIdentity: selected.identity,
	bootstrap: false,
	capabilities: {
		call: async () => {
			throw new Error("No nested calls");
		},
	},
});
it("requires actual per-call approval before even a missing-image execution is accepted", async () => {
	const ports = await capabilities();
	const registry = new PluginRuntimeRegistry(
		{
			authorizeActivation: async () => true,
			authorizeInvocation: async (input) => input.operation !== "capability:execution.run",
		},
		"application",
		async () => ({ resources: [], handlers: ports.handlers, dispose: ports.dispose }),
	);
	registry.register("@example/runner", async ({ capabilities }) => ({
		operations: {
			run: {
				effect: "write",
				inputSchema: { type: "null" },
				resultSchema: { type: "object" },
				execute: () => capabilities.call("execution.run", request),
			},
		},
		dispose: async () => {},
	}));
	const client = await registry.activate("@example/runner", () => selected);
	await expect(client.invoke("run", null)).rejects.toThrow("denied");
	expect(await readdir(join(root, "private-receipts"))).toEqual([]);
	expect(await readdir(root)).toEqual(["private-receipts"]);
	await registry.deactivate("@example/runner");
});
it("returns an honest unavailable error for an exact image that is not cached and creates no accepted receipt or run directory", async () => {
	const ports = await capabilities();
	await expect(ports.handlers["execution.run"].execute(request, context())).rejects.toThrow("not cached");
	expect(
		await ports.handlers["execution.receipt"].execute({ requestId: request.requestId }, context()),
	).toEqual({ kind: "missing" });
	expect(await readdir(join(root, "private-receipts"))).toEqual([]);
	expect(await readdir(root)).toEqual(["private-receipts"]);
	await ports.dispose();
});
it("rejects stale, read-only and untrusted callers before any execution infrastructure is probed", async () => {
	const ports = await capabilities();
	const original = context();
	selected = { ...selected, identity: {} };
	await expect(ports.handlers["execution.describe"].execute(null, original)).rejects.toThrow("stale");
	selected = { ...selected, readOnly: true };
	await expect(ports.handlers["execution.run"].execute(request, context())).rejects.toThrow("read-only");
	selected = { ...selected, readOnly: false, projectTrusted: false };
	await expect(ports.handlers["execution.run"].execute(request, context())).rejects.toThrow("untrusted");
	expect(await readdir(join(root, "private-receipts"))).toEqual([]);
	await ports.dispose();
});
