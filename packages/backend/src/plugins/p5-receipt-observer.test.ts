import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { JsonStore } from "../json-store";
import { StorageRegistry } from "../storage/registry";
import { createP5ReceiptObserver, type P5ReceiptObservation } from "./p5-receipt-observer";
import { createP5ReceiptStore } from "./p5-receipt-store";
import { PluginCapabilityBroker } from "./runtime-capabilities";

const request = { requestId: "host-request-1" };
const fixture = { directory: "", path: "", output: "", bytes: Buffer.alloc(0) };
const now = () => "2026-11-18T00:00:00Z";
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const open = () => createP5ReceiptStore({ path: fixture.path, registry: new StorageRegistry() });
const unchanged = async () => expect(await readFile(fixture.output)).toEqual(fixture.bytes);
const observation = (
	overrides: Partial<P5ReceiptObservation<string>> = {},
): P5ReceiptObservation<string> => ({
	request,
	metadata: {
		operation: "files.writeBundle",
		inputSha256: "a".repeat(64),
		scope: {
			workspaceId: "workspace-1",
			sessionId: "session-1",
			callerSourceHash: "b".repeat(64),
			providerSourceHash: "c".repeat(64),
		},
		category: "compute-preflight",
		parentReceiptRef: null,
	},
	expectedReadback: [{ path: "export.json", sha256: hash(fixture.bytes), bytes: fixture.bytes.length }],
	approved: true,
	execute: vi.fn(async () => "done"),
	readback: async () => {
		const bytes = await readFile(fixture.output);
		return [{ path: "export.json", sha256: hash(bytes), bytes: bytes.length }];
	},
	...overrides,
});

beforeEach(async () => {
	fixture.directory = await mkdtemp(join(tmpdir(), "drone-p5-observer-"));
	fixture.path = join(fixture.directory, "receipts.json");
	fixture.output = join(fixture.directory, "export.json");
	await new JsonStore({ path: fixture.output, storageId: "test-output", defaultValue: () => "" }).write(
		"original",
	);
	fixture.bytes = await readFile(fixture.output);
});
afterEach(async () => {
	await rm(fixture.directory, { recursive: true, force: true });
});

it("records denial with zero effect calls and preserves output bytes", async () => {
	const attempt = observation({ approved: false });
	await expect(createP5ReceiptObserver(open(), now)(attempt)).rejects.toMatchObject({ code: "DENIED" });
	expect(attempt.execute).not.toHaveBeenCalled();
	expect(await open().get(request)).toMatchObject({
		decision: "denied",
		status: "failed",
		resultSha256: null,
		readback: [],
	});
	await unchanged();
});

it("reads durable acceptance inside the effect and persists result hash plus actual file readback", async () => {
	const attempt = observation({
		execute: vi.fn(async () => {
			expect(await open().get(request)).toMatchObject({ status: "accepted", resultSha256: null });
			return "done";
		}),
	});
	expect(await createP5ReceiptObserver(open(), now)(attempt)).toBe("done");
	expect(attempt.execute).toHaveBeenCalledTimes(1);
	expect(await open().get(request)).toMatchObject({
		status: "succeeded",
		resultSha256: hash(JSON.stringify("done")),
		readback: attempt.expectedReadback,
	});
});

it("records an undefined result as succeeded with the hash of null", async () => {
	const attempt = { ...observation(), execute: vi.fn(async () => undefined) };
	await expect(createP5ReceiptObserver(open(), now)(attempt)).resolves.toBeUndefined();
	expect(attempt.execute).toHaveBeenCalledTimes(1);
	expect(await open().get(request)).toMatchObject({
		status: "succeeded",
		resultSha256: hash("null"),
		readback: attempt.expectedReadback,
	});
});

it("does not classify result serialization errors as effect uncertainty", async () => {
	const error = new Error("synthetic result serialization failure");
	const attempt = {
		...observation(),
		execute: vi.fn(async () => ({
			toJSON() {
				throw error;
			},
		})),
	};
	await expect(createP5ReceiptObserver(open(), now)(attempt)).rejects.toBe(error);
	expect(attempt.execute).toHaveBeenCalledTimes(1);
	expect(await open().get(request)).toMatchObject({ status: "accepted", resultSha256: null });
});

it("does not invoke or change either file when durable acceptance fails", async () => {
	const store = open();
	await createP5ReceiptObserver(store, now)(observation({ request: { requestId: "other-request" } }));
	const bytes = await readFile(fixture.path);
	vi.spyOn(store, "accept").mockRejectedValue(new Error("synthetic storage failure"));
	const attempt = observation();
	await expect(createP5ReceiptObserver(store, now)(attempt)).rejects.toMatchObject({
		code: "PERSISTENCE_PENDING",
	});
	expect(attempt.execute).not.toHaveBeenCalled();
	expect(await readFile(fixture.path)).toEqual(bytes);
	await unchanged();
});

it.each(["effect", "readback"])("records uncertainty on %s error without exposing content", async (stage) => {
	const attempt = observation({
		[stage === "effect" ? "execute" : "readback"]: async () => {
			throw new Error("synthetic private payload");
		},
	});
	const result = createP5ReceiptObserver(open(), now)(attempt);
	await expect(result).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
	await expect(result).rejects.toThrow("P5 receipt observation failed: OUTCOME_UNKNOWN");
	expect(await open().get(request)).toMatchObject({ status: "outcome-unknown", resultSha256: null });
	expect(await readFile(fixture.path, "utf8")).not.toContain("synthetic private payload");
	await unchanged();
});

it.each(["hash", "bytes", "missing", "extra"])("rejects a %s readback mismatch", async (kind) => {
	const attempt = observation();
	const files = attempt.expectedReadback;
	const actual =
		kind === "missing"
			? []
			: kind === "extra"
				? [...files, ...files]
				: files.map((file) => ({
						...file,
						...(kind === "hash" ? { sha256: "d".repeat(64) } : { bytes: 0 }),
					}));
	await expect(
		createP5ReceiptObserver(open(), now)({ ...attempt, readback: async () => actual }),
	).rejects.toMatchObject({ code: "READBACK_FAILED" });
	expect(await open().get(request)).toMatchObject({ status: "failed", resultSha256: null, readback: actual });
	await unchanged();
});

it("reports terminal persistence failure and preserves accepted ledger and output bytes", async () => {
	const store = open();
	const snapshot = { bytes: Buffer.alloc(0) };
	const attempt = observation({
		execute: async () => {
			snapshot.bytes = await readFile(fixture.path);
			vi.spyOn(store, "finish").mockImplementation(async () => {
				throw new Error("synthetic terminal write failure");
			});
			return "done";
		},
	});
	await expect(createP5ReceiptObserver(store, now)(attempt)).rejects.toMatchObject({
		code: "PERSISTENCE_PENDING",
	});
	expect(await open().get(request)).toMatchObject({ status: "accepted", resultSha256: null, readback: [] });
	expect(await readFile(fixture.path)).toEqual(snapshot.bytes);
	await unchanged();
});

it("never replays a stored request and lets only one concurrent observer invoke the effect", async () => {
	const attempt = observation();
	const results = await Promise.allSettled([
		createP5ReceiptObserver(open(), now)(attempt),
		createP5ReceiptObserver(open(), now)(attempt),
	]);
	expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
	expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
	expect(attempt.execute).toHaveBeenCalledTimes(1);
	const bytes = await readFile(fixture.path);
	await expect(createP5ReceiptObserver(open(), now)(attempt)).rejects.toMatchObject({
		code: "STATE_CONFLICT",
	});
	expect(attempt.execute).toHaveBeenCalledTimes(1);
	expect(await readFile(fixture.path)).toEqual(bytes);
	await unchanged();
});

it.each(["approved", "denied", "invalid-input", "invalid-result", "read-only"])(
	"observes broker %s without bypassing its gates",
	async (kind) => {
		const observe = createP5ReceiptObserver(open(), now);
		const attempt = observation();
		const broker = new PluginCapabilityBroker({
			resources: [],
			handlers: {
				save: {
					inputSchema: Type.Null(),
					resultSchema: kind === "invalid-result" ? Type.Null() : Type.String(),
					effect: "write",
					execute: attempt.execute,
					observe: (_input, _context, invocation) => observe({ ...attempt, ...invocation }),
				},
			},
		});
		const result = broker.run(
			{
				pluginId: "plugin",
				applicationId: "app",
				scope: { kind: "application" },
				callerIdentity: {},
				signal: new AbortController().signal,
				bootstrap: false,
			},
			kind === "read-only" ? "read" : "write",
			() => undefined,
			async () => kind !== "denied",
			() => broker.port.call("save", kind === "invalid-input" ? "invalid" : null),
		);
		if (kind === "approved") await expect(result).resolves.toBe("done");
		else await expect(result).rejects.toThrow();
		expect(attempt.execute).toHaveBeenCalledTimes(["approved", "invalid-result"].includes(kind) ? 1 : 0);
		if (["invalid-input", "read-only"].includes(kind))
			await expect(readFile(fixture.path)).rejects.toMatchObject({ code: "ENOENT" });
		else
			expect(await open().get(request)).toMatchObject({
				status: kind === "approved" ? "succeeded" : kind === "denied" ? "failed" : "outcome-unknown",
			});
		await unchanged();
	},
);
