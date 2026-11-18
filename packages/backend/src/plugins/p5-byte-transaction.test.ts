import { createHash } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PluginResourceReservations } from "@gyoungwe/plugin-api/node/reservations";
import { expect, it, onTestFinished, vi } from "vitest";
import { StorageRegistry } from "../storage/registry";
import { P5ByteStaging, type P5StagingOwner } from "./p5-byte-staging";
import { P5ByteTransaction } from "./p5-byte-transaction";
import { createP5ReceiptObserver } from "./p5-receipt-observer";
import { createP5ReceiptStore } from "./p5-receipt-store";

const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
function fixture() {
	const base = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "p5-transaction-")));
	const root = join(base, "outputs");
	const stagingRoot = join(base, "staging");
	for (const directory of [root, stagingRoot]) fs.mkdirSync(directory);
	const controller = new AbortController();
	const owner: P5StagingOwner = {
		workspaceId: "workspace",
		sessionId: "session",
		callerSourceHash: "a".repeat(64),
		providerSourceHash: "b".repeat(64),
		callerId: "caller",
		action: "import",
		signal: controller.signal,
	};
	const staging = new P5ByteStaging(stagingRoot, () => owner);
	const ref = staging.open({ requestId: "stage", path: "blob", bytes: 6 });
	staging.chunk({ ...ref, offset: 0, base64: Buffer.from("abcdef").toString("base64") }, 120);
	const source = staging.seal({ ...ref, bytes: 6, sha256: hash("abcdef") });
	const leases = new PluginResourceReservations(join(base, "leases"));
	const transaction = new P5ByteTransaction(root, staging, () => owner, leases);
	onTestFinished(() => {
		vi.restoreAllMocks();
		controller.abort();
		leases.dispose();
		fs.rmSync(base, { recursive: true, force: true });
	});
	const plan = { path: "blob", source, expected: null };
	return { root, base, owner, source, transaction, staging, controller, leases, plan };
}
it("rejects a replacement caller signal even when its state is identical", () => {
	const f = fixture();
	Object.assign(f.owner, { signal: new AbortController().signal });
	expect(() => f.transaction.write(f.plan, true)).toThrow("SCOPE_CHANGED");
	expect(fs.readdirSync(f.root)).toEqual([]);
});
it("records durable acceptance, file readback and cleanup through the existing observer", async () => {
	const f = fixture();
	const path = join(f.base, "receipts.json");
	const store = createP5ReceiptStore({ path, registry: new StorageRegistry() });
	const observe = createP5ReceiptObserver(store, () => "2026-11-18T00:00:00Z");
	const { workspaceId, sessionId, callerSourceHash, providerSourceHash } = f.owner;
	const file = { path: "blob", bytes: 6, sha256: hash("abcdef") };
	const result = await observe({
		request: { requestId: "write" },
		approved: true,
		expectedReadback: [file],
		metadata: {
			operation: "bytes.write",
			inputSha256: hash(JSON.stringify(f.plan)),
			scope: { workspaceId, sessionId, callerSourceHash, providerSourceHash },
			category: "application-state-write",
			parentReceiptRef: null,
		},
		execute: async () => {
			expect(await store.get({ requestId: "write" })).toMatchObject({ status: "accepted" });
			return f.transaction.write(f.plan, true);
		},
		readback: async () => {
			const bytes = fs.readFileSync(join(f.root, "blob"));
			return [{ path: "blob", bytes: bytes.length, sha256: hash(bytes) }];
		},
	});
	expect(result).toEqual({ file, cleanup: "complete" });
	expect(fs.readFileSync(join(f.root, "blob"), "utf8")).toBe("abcdef");
	expect(await store.get({ requestId: "write" })).toMatchObject({ status: "succeeded", readback: [file] });
	expect(fs.readdirSync(f.root)).toEqual(["blob"]);
});
it("requires fresh approval for replacement and preserves existing output on denial", () => {
	const f = fixture();
	f.transaction.write(f.plan, true);
	const plan = { ...f.plan, expected: f.transaction.inspect("blob") };
	expect(() => f.transaction.write(plan, false)).toThrow("DENIED");
	expect(fs.readFileSync(join(f.root, "blob"), "utf8")).toBe("abcdef");
	expect(f.transaction.write(plan, true).cleanup).toBe("complete");
});
it.each(["edit", "replace", "delete", "appear"])("rejects prior target CAS conflict: %s", (kind) => {
	const f = fixture();
	const target = join(f.root, "blob");
	if (kind !== "appear") fs.writeFileSync(target, "before");
	const expected = f.transaction.inspect("blob");
	if (kind === "replace" || kind === "delete") fs.unlinkSync(target);
	if (kind !== "delete") fs.writeFileSync(target, kind === "replace" ? "before" : "edited");
	expect(() => f.transaction.write({ ...f.plan, expected }, true)).toThrow("STATE_CONFLICT");
	expect(fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null).toBe(
		kind === "delete" ? null : kind === "replace" ? "before" : "edited",
	);
	expect(fs.readdirSync(f.root)).toEqual(kind === "delete" ? [] : ["blob"]);
});
it.each(["edit", "cancel", "parent", "root"])("rechecks after temporary write: %s", (kind) => {
	const f = fixture();
	fs.mkdirSync(join(f.root, "branch"));
	vi.spyOn(fs, "fsyncSync").mockImplementationOnce(() => {
		if (kind === "edit") fs.writeFileSync(join(f.root, "branch/blob"), "edited");
		if (kind === "cancel") f.controller.abort();
		if (kind === "root" || kind === "parent") {
			const parent = kind === "root" ? f.root : join(f.root, "branch");
			fs.renameSync(parent, join(f.base, "moved"));
			fs.mkdirSync(parent);
			if (kind === "root") fs.mkdirSync(join(parent, "branch"));
		}
	});
	expect(() => f.transaction.write({ ...f.plan, path: "branch/blob" }, true)).toThrow(
		kind === "edit" ? "STATE_CONFLICT" : kind === "cancel" ? "CANCELLED" : "CLEANUP_FAILED",
	);
	expect(fs.readdirSync(join(f.root, "branch"))).toEqual(kind === "edit" ? ["blob"] : []);
});
it("fails on mismatched final readback without deleting the committed output", () => {
	const f = fixture();
	f.transaction.write(f.plan, true);
	const rename = fs.renameSync;
	vi.spyOn(fs, "renameSync").mockImplementationOnce((from, to) => {
		rename(from, to);
		fs.writeFileSync(to, "edited");
	});
	expect(() => f.transaction.write({ ...f.plan, expected: f.transaction.inspect("blob") }, true)).toThrow(
		"READBACK_FAILED",
	);
	expect(fs.readFileSync(join(f.root, "blob"), "utf8")).toBe("edited");
	expect(fs.readdirSync(f.root)).toEqual(["blob"]);
});
it("cleans a failed temporary write and preserves the prior file", () => {
	const f = fixture();
	fs.writeFileSync(join(f.root, "blob"), "before");
	const plan = { ...f.plan, expected: f.transaction.inspect("blob") };
	vi.spyOn(fs, "fsyncSync").mockImplementationOnce(() => {
		throw new Error("private filesystem diagnostic");
	});
	expect(() => f.transaction.write(plan, true)).toThrow("P5 byte transaction: READBACK_FAILED");
	expect(fs.readFileSync(join(f.root, "blob"), "utf8")).toBe("before");
	expect(fs.readdirSync(f.root)).toEqual(["blob"]);
});
it.each(["../escape", "/absolute", "link/blob"])("confines target %s", (path) => {
	const f = fixture();
	fs.symlinkSync(f.base, join(f.root, "link"));
	expect(() => f.transaction.write({ ...f.plan, path }, true)).toThrow("PATH_ESCAPE");
	expect(fs.readdirSync(f.root)).toEqual(["link"]);
});
it.each(["open", "copied", "tampered"])("accepts only current sealed staging: %s", (kind) => {
	const f = fixture();
	const source =
		kind === "open"
			? { ...f.source, ...f.staging.open({ requestId: "open", path: "blob", bytes: 6 }) }
			: kind === "copied"
				? { ...f.source, fileRef: "foreign" }
				: f.source;
	if (kind === "tampered") fs.writeFileSync(join(f.base, "staging", `${source.fileRef}.staged`), "edited");
	expect(() => f.transaction.write({ ...f.plan, source }, true)).toThrow("READBACK_FAILED");
	expect(fs.readdirSync(f.root)).toEqual([]);
});
it("retains the lease and reports cleanup failure without leaking filesystem errors", () => {
	const f = fixture();
	vi.spyOn(fs, "unlinkSync").mockImplementationOnce(() => {
		throw new Error("private filesystem diagnostic");
	});
	expect(() => f.transaction.write(f.plan, true)).toThrow("P5 byte transaction: CLEANUP_FAILED");
	expect(() => f.transaction.releaseReservations()).toThrow("CLEANUP_FAILED");
	const competitor = new PluginResourceReservations(join(f.base, "leases"));
	expect(() => competitor.reserve("state-writers", [f.root])).toThrow("already reserved");
	expect(fs.readdirSync(f.root).filter((name) => name.endsWith(".tmp"))).toHaveLength(1);
});
it("closes a temporary descriptor when its identity cannot be read", () => {
	const f = fixture();
	f.leases.reserve("state-writers", [f.root]);
	const actual = { openSync: fs.openSync, fstatSync: fs.fstatSync };
	const descriptor = { fd: -1 };
	vi.spyOn(fs, "openSync").mockImplementationOnce((path, flags, mode) => {
		const fd = actual.openSync(path, flags, mode);
		descriptor.fd = fd;
		vi.spyOn(fs, "fstatSync").mockImplementationOnce(() => {
			throw new Error("private filesystem diagnostic");
		});
		return fd;
	});
	expect(() => f.transaction.write(f.plan, true)).toThrow("CLEANUP_FAILED");
	expect(() => actual.fstatSync(descriptor.fd)).toThrow("bad file descriptor");
	expect(() => f.transaction.releaseReservations()).toThrow("CLEANUP_FAILED");
});
