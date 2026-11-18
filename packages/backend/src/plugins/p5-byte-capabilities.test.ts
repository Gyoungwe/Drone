import { createHash } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PluginResourceReservations } from "@gyoungwe/plugin-api/node/reservations";
import type { StagedRef } from "@gyoungwe/plugin-api/p5-evidence";
import { expect, it, onTestFinished, vi } from "vitest";
import { p5ByteCapabilityHandlers } from "./p5-byte-capabilities";
import { P5ByteStaging, type P5StagingOwner } from "./p5-byte-staging";
import { P5ByteTransaction, type P5ByteVersion } from "./p5-byte-transaction";
import { PluginCapabilityBroker } from "./runtime-capabilities";

const sha256 = createHash("sha256").update("abcdef").digest("hex");
const failed = (code: string) => ({ status: "failed", code, receiptRef: null });
const ok = (value: unknown) => ({ status: "ok", value });
const openInput = { requestId: "stage", path: "blob", bytes: 6 };
type Opened = { value: { fileRef: string } };
function fixture() {
	const base = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "p5-capabilities-")));
	const root = join(base, "outputs");
	const stagingRoot = join(base, "staging");
	for (const directory of [root, stagingRoot]) fs.mkdirSync(directory);
	const controller = new AbortController();
	const owner: P5StagingOwner = {
		workspaceId: "workspace",
		sessionId: "session",
		callerId: "caller",
		action: "import",
		callerSourceHash: "a".repeat(64),
		providerSourceHash: "b".repeat(64),
		signal: controller.signal,
	};
	const staging = new P5ByteStaging(stagingRoot, () => owner);
	const leases = new PluginResourceReservations(join(base, "leases"));
	const transaction = new P5ByteTransaction(root, staging, () => owner, leases);
	const state = { approved: true, granted: true };
	const grantOf = vi.fn(() => (state.granted ? { staging, transaction } : undefined));
	const handlers = p5ByteCapabilityHandlers(grantOf, () => 120);
	const broker = new PluginCapabilityBroker({ handlers, resources: [] });
	const authorize = vi.fn<Parameters<PluginCapabilityBroker["run"]>[3]>(async () => state.approved);
	// Match coordinator routing: reads and own bookkeeping bypass the approval prompt.
	const decide = vi.fn<Parameters<PluginCapabilityBroker["run"]>[3]>((...args) =>
		args[2] === "read" || args[5] === "own" ? Promise.resolve(true) : authorize(...args),
	);
	const { workspaceId, sessionId } = owner;
	const context = {
		pluginId: "caller",
		applicationId: "app",
		callerIdentity: {},
		signal: controller.signal,
		bootstrap: false,
		scope: { kind: "session" as const, workspaceId, sessionId, workspaceDirectory: root },
	};
	const call = (name: string, input: unknown) => {
		const invoke = () => broker.port.call(name, input);
		return broker.run(context, "write", () => undefined, decide, invoke);
	};
	onTestFinished(() => {
		vi.restoreAllMocks();
		controller.abort();
		leases.dispose();
		fs.rmSync(base, { recursive: true, force: true });
	});
	return { base, root, owner, transaction, state, grantOf, authorize, decide, call };
}
async function staged(f: ReturnType<typeof fixture>) {
	const opened = (await f.call("bytes.stage.open", openInput)) as Opened;
	const source: StagedRef = { ...opened.value, bytes: 6, sha256 };
	for (const offset of [0, 2, 4]) {
		const base64 = Buffer.from("abcdef".slice(offset, offset + 2)).toString("base64");
		expect(await f.call("bytes.stage.chunk", { ...opened.value, offset, base64 })).toEqual(ok(null));
	}
	expect(await f.call("bytes.stage.seal", source)).toEqual({ status: "ok", value: source });
	return { path: "blob", source, expected: null };
}
it("requests S only for open and write across three chunks and verifies readback", async () => {
	const f = fixture();
	const plan = await staged(f);
	const result = { status: "ok", value: { file: { path: "blob", bytes: 6, sha256 }, cleanup: "complete" } };
	expect(await f.call("bytes.write", plan)).toEqual(result);
	expect(f.authorize.mock.calls.map((call) => [call[0], call[2], call[3], call[5]])).toEqual([
		["bytes.stage.open", "write", "application-state-write", "always"],
		["bytes.write", "write", "application-state-write", "always"],
	]);
	const inspected = (await f.call("bytes.inspect", { path: "blob" })) as { value: P5ByteVersion };
	expect(await f.call("bytes.write", { ...plan, expected: inspected.value })).toEqual(result);
	expect(fs.readFileSync(join(f.root, "blob"), "utf8")).toBe("abcdef");
	const ref = { fileRef: plan.source.fileRef };
	expect(await f.call("bytes.stage.read", ref)).toEqual({ status: "ok", value: plan.source });
	f.state.granted = false;
	expect(await f.call("bytes.inspect", { path: "blob" })).toEqual(failed("SCOPE_CHANGED"));
	expect(await f.call("bytes.stage.read", ref)).toEqual(failed("SCOPE_CHANGED"));
	f.state.granted = true;
	expect(await f.call("bytes.stage.cancel", ref)).toEqual({ status: "ok", value: null });
	expect(await f.call("bytes.stage.read", ref)).toEqual(failed("SCOPE_CHANGED"));
	expect(f.authorize).toHaveBeenCalledTimes(3);
	for (const call of f.decide.mock.calls)
		if (!["bytes.stage.open", "bytes.write"].includes(call[0]))
			expect([call[3], call[5]]).toEqual([undefined, call[2] === "read" ? undefined : "own"]);
});
it.each(["callerId", "sessionId", "forged", "cancelled"])("rejects %s staging refs", async (kind) => {
	for (const operation of ["chunk", "seal", "cancel"] as const) {
		const f = fixture();
		const { source } = await staged(f);
		const ref = { fileRef: kind === "forged" ? "forged" : source.fileRef };
		if (kind === "cancelled") await f.call("bytes.stage.cancel", ref);
		if (kind === "callerId" || kind === "sessionId") Object.assign(f.owner, { [kind]: "other" });
		const inputs = {
			chunk: { ...ref, offset: 0, base64: "YWJjZGVm" },
			seal: { ...source, ...ref },
			cancel: ref,
		};
		expect(await f.call(`bytes.stage.${operation}`, inputs[operation])).toEqual(failed("SCOPE_CHANGED"));
		expect(fs.readdirSync(f.root)).toEqual([]);
	}
});
it.each(["open", "write", "scope"])("rejects %s without output bytes", async (kind) => {
	const f = fixture();
	const input = kind === "open" ? openInput : await staged(f);
	f.grantOf.mockClear();
	if (kind !== "scope") f.state.approved = false;
	else Object.assign(f.owner, { sessionId: "other" });
	const operation = kind === "open" ? "bytes.stage.open" : "bytes.write";
	expect(await f.call(operation, input)).toEqual(failed(kind === "scope" ? "SCOPE_CHANGED" : "DENIED"));
	expect(f.grantOf).toHaveBeenCalledTimes(kind === "scope" ? 1 : 0);
	expect(fs.readdirSync(f.root)).toEqual([]);
});
it("retains the writer lease after cleanup fails and exposes only the public code", async () => {
	const f = fixture();
	const plan = await staged(f);
	vi.spyOn(fs, "unlinkSync").mockImplementationOnce(() => {
		throw new Error("private filesystem diagnostic");
	});
	expect(await f.call("bytes.write", plan)).toEqual(failed("CLEANUP_FAILED"));
	expect(() => f.transaction.releaseReservations()).toThrow("CLEANUP_FAILED");
	const competitor = new PluginResourceReservations(join(f.base, "leases"));
	expect(() => competitor.reserve("state-writers", [f.root])).toThrow("already reserved");
});
it.each(["root", "scope", "approval"])("rejects request-supplied %s before authorization", async (field) => {
	const f = fixture();
	const plan = await staged(f);
	f.authorize.mockClear();
	const inputs = { "bytes.stage.open": openInput, "bytes.write": plan };
	for (const [name, input] of Object.entries(inputs)) {
		const rejected = f.call(name, { ...input, [field]: "forged" });
		await expect(rejected).rejects.toThrow("Invalid plugin capability input");
	}
	expect(f.authorize).not.toHaveBeenCalled();
	expect(fs.readdirSync(f.root)).toEqual([]);
});
