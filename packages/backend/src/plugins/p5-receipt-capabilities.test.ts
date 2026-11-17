import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Receipt, Scope } from "@gyoungwe/plugin-api/p5-receipts";
import { expect, it, vi } from "vitest";
import { StorageRegistry } from "../storage/registry";
import { p5ReceiptCapabilityHandlers } from "./p5-receipt-capabilities";
import { createP5ReceiptStore } from "./p5-receipt-store";
import { PluginCapabilityBroker, type PluginCapabilityContext } from "./runtime-capabilities";

type Caller = Omit<PluginCapabilityContext, "capabilities">;
interface Host {
	readonly path: string;
	readonly receipt: Receipt;
	readonly caller: Caller;
	readonly source: { generation: string; providerSourceHash: string };
	read(input: unknown, caller?: Caller): Promise<unknown>;
}

const sourceHash = (pluginId: string, generation: string) =>
	createHash("sha256")
		.update(JSON.stringify([pluginId, generation]))
		.digest("hex");

const accepted: Omit<Receipt, "requestId" | "scope"> = {
	receiptRef: "host-receipt-1",
	operation: "files.writeBundle",
	inputSha256: "c".repeat(64),
	category: "compute-preflight",
	decision: "approved",
	status: "accepted",
	at: "2026-11-18T00:00:00Z",
	resultSha256: null,
	readback: [],
	parentReceiptRef: null,
};

function createCaller(): Caller {
	return {
		pluginId: "fixture-plugin",
		applicationId: "fixture-application",
		scope: {
			kind: "session",
			workspaceId: "workspace-1",
			workspaceDirectory: "/fixture",
			sessionId: "session-1",
		},
		callerIdentity: {},
		signal: new AbortController().signal,
		bootstrap: false,
	};
}

const test = it.extend<{ host: Host }>({
	host: async ({ task: _task }, use) => {
		const directory = await mkdtemp(join(tmpdir(), "drone-p5-receipt-read-"));
		const path = join(directory, "receipts.json");
		const store = createP5ReceiptStore({ path, registry: new StorageRegistry() });
		const source = { generation: "generation-1", providerSourceHash: "b".repeat(64) };
		const caller = createCaller();
		const scopeOf = (context: PluginCapabilityContext): Scope | undefined =>
			context.scope.kind === "session"
				? {
						workspaceId: context.scope.workspaceId,
						sessionId: context.scope.sessionId,
						callerSourceHash: sourceHash(context.pluginId, source.generation),
						providerSourceHash: source.providerSourceHash,
					}
				: undefined;
		const receipt = await store.accept(
			{ requestId: "host-request-1" },
			{
				...accepted,
				scope: {
					workspaceId: "workspace-1",
					sessionId: "session-1",
					callerSourceHash: sourceHash(caller.pluginId, source.generation),
					providerSourceHash: "b".repeat(64),
				},
			},
		);
		const broker = new PluginCapabilityBroker({
			handlers: p5ReceiptCapabilityHandlers(store, scopeOf),
			resources: [],
		});
		const read = (input: unknown, context = caller) =>
			broker.run(
				context,
				"read",
				vi.fn(),
				async () => true,
				() => broker.port.call("receipts.read", input),
			);
		try {
			await use({ path, receipt, caller, source, read });
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	},
});

test("reads only host metadata without changing the ledger", async ({ host }) => {
	const bytes = await readFile(host.path);
	expect(await host.read({ receiptRef: host.receipt.receiptRef })).toEqual({
		status: "ok",
		value: host.receipt,
	});
	expect(await readFile(host.path)).toEqual(bytes);
});

test.for(["plugin", "generation", "workspace", "session", "provider"] as const)(
	"rejects a ref copied to another %s exactly like an unknown ref without writing",
	async (change, { host }) => {
		const bytes = await readFile(host.path);
		if (change === "generation") host.source.generation = "generation-2";
		if (change === "provider") host.source.providerSourceHash = "d".repeat(64);
		const caller: Caller = {
			...host.caller,
			pluginId: change === "plugin" ? "other-plugin" : host.caller.pluginId,
			scope: {
				kind: "session",
				workspaceDirectory: "/fixture",
				workspaceId: change === "workspace" ? "workspace-2" : "workspace-1",
				sessionId: change === "session" ? "session-2" : "session-1",
			},
		};
		const copied = await host.read({ receiptRef: host.receipt.receiptRef }, caller);
		expect(copied).toEqual({ status: "failed", code: "DENIED", receiptRef: null });
		expect(await readFile(host.path)).toEqual(bytes);
		expect(await host.read({ receiptRef: "unknown-ref" }, caller)).toEqual(copied);
		expect(await readFile(host.path)).toEqual(bytes);
	},
);

test("denies an unknown ref without changing the ledger", async ({ host }) => {
	const bytes = await readFile(host.path);
	expect(await host.read({ receiptRef: "unknown-ref" })).toEqual({
		status: "failed",
		code: "DENIED",
		receiptRef: null,
	});
	expect(await readFile(host.path)).toEqual(bytes);
});

test("denies a caller without a host session scope without changing the ledger", async ({ host }) => {
	const bytes = await readFile(host.path);
	expect(
		await host.read(
			{ receiptRef: host.receipt.receiptRef },
			{ ...host.caller, scope: { kind: "application" } },
		),
	).toEqual({ status: "failed", code: "DENIED", receiptRef: null });
	expect(await readFile(host.path)).toEqual(bytes);
});

test.for([
	"workspaceId",
	"sessionId",
	"pluginId",
	"sourceGeneration",
	"callerSourceHash",
	"providerSourceHash",
	"scope",
	"receipt",
] as const)("rejects request-selected %s before lookup without writing", async (field, { host }) => {
	const bytes = await readFile(host.path);
	const request = {
		receiptRef: host.receipt.receiptRef,
		[field]: field === "receipt" ? host.receipt : field === "scope" ? host.receipt.scope : "other-scope",
	};
	await expect(host.read(request)).rejects.toThrow("Invalid plugin capability input: receipts.read");
	expect(await readFile(host.path)).toEqual(bytes);
});

test("rejects a receipt object used as proof without changing the ledger", async ({ host }) => {
	const bytes = await readFile(host.path);
	await expect(host.read(host.receipt)).rejects.toThrow("Invalid plugin capability input: receipts.read");
	expect(await readFile(host.path)).toEqual(bytes);
});
