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
	const broker = new PluginCapabilityBroker({
		handlers: p5ByteCapabilityHandlers(grantOf, () => 120),
		resources: [],
	});
	const authorize = vi.fn<Parameters<PluginCapabilityBroker["run"]>[3]>(async () => state.approved);
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
		return broker.run(context, "write", () => undefined, authorize, invoke);
	};
	onTestFinished(() => {
		vi.restoreAllMocks();
		controller.abort();
		leases.dispose();
		fs.rmSync(base, { recursive: true, force: true });
	});
	return { base, root, owner, transaction, state, grantOf, authorize, call };
}
async function staged(f: ReturnType<typeof fixture>) {
	const opened = (await f.call("bytes.stage.open", { requestId: "stage", path: "blob", bytes: 6 })) as Opened;
	const source: StagedRef = { ...opened.value, bytes: 6, sha256 };
	expect(await f.call("bytes.stage.chunk", { ...opened.value, offset: 0, base64: "YWJjZGVm" })).toEqual({
		status: "ok",
		value: null,
	});
	expect(await f.call("bytes.stage.seal", source)).toEqual({ status: "ok", value: source });
	return { path: "blob", source, expected: null };
}
it("requests fresh S for each write and returns verified file readback", async () => {
	const f = fixture();
	const plan = await staged(f);
	expect(f.authorize.mock.calls.every((call) => call[5] === "always")).toBe(true);
	f.authorize.mockClear();
	const result = { status: "ok", value: { file: { path: "blob", bytes: 6, sha256 }, cleanup: "complete" } };
	expect(await f.call("bytes.write", plan)).toEqual(result);
	const inspected = (await f.call("bytes.inspect", { path: "blob" })) as { value: P5ByteVersion };
	expect(await f.call("bytes.write", { ...plan, expected: inspected.value })).toEqual(result);
	const writes = f.authorize.mock.calls.filter(([name]) => name === "bytes.write");
	expect(writes).toHaveLength(2);
	expect(writes.every((call) => call[2] === "write" && call[5] === "always")).toBe(true);
	expect(fs.readFileSync(join(f.root, "blob"), "utf8")).toBe("abcdef");
	const ref = { fileRef: plan.source.fileRef };
	expect(await f.call("bytes.stage.read", ref)).toEqual({ status: "ok", value: plan.source });
	expect(await f.call("bytes.stage.cancel", ref)).toEqual({ status: "ok", value: null });
	expect(await f.call("bytes.stage.read", ref)).toEqual(failed("SCOPE_CHANGED"));
	f.state.granted = false;
	expect(await f.call("bytes.inspect", { path: "blob" })).toEqual(failed("SCOPE_CHANGED"));
});
it.each(["DENIED", "SCOPE_CHANGED"])("rejects %s without output bytes", async (code) => {
	const f = fixture();
	const plan = await staged(f);
	f.grantOf.mockClear();
	if (code === "DENIED") f.state.approved = false;
	else Object.assign(f.owner, { sessionId: "other" });
	expect(await f.call("bytes.write", plan)).toEqual(failed(code));
	expect(f.grantOf).toHaveBeenCalledTimes(code === "DENIED" ? 0 : 1);
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
	for (const [name, input] of [
		["bytes.stage.open", { requestId: "forged", path: "blob", bytes: 6 }],
		["bytes.write", plan],
	] as const) {
		await expect(f.call(name, { ...input, [field]: "forged" })).rejects.toThrow(
			"Invalid plugin capability input",
		);
	}
	expect(f.authorize).not.toHaveBeenCalled();
	expect(fs.readdirSync(f.root)).toEqual([]);
});
