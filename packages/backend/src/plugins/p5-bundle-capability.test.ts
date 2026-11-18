import { createHash } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PluginResourceReservations } from "@gyoungwe/plugin-api/node/reservations";
import type { ExportFile } from "@gyoungwe/plugin-api/p5-evidence";
import type { Code } from "@gyoungwe/plugin-api/p5-receipts";
import { expect, it, onTestFinished, vi } from "vitest";
import { StorageRegistry } from "../storage/registry";
import { p5BundleCapability } from "./p5-bundle-capability";
import { createP5BundleReviewer } from "./p5-bundle-review";
import { P5ByteStaging } from "./p5-byte-staging";
import { createP5ReceiptStore } from "./p5-receipt-store";

const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
function file(path = "capsule.json", mediaType: ExportFile["mediaType"] = "application/json"): ExportFile {
	return { path, mediaType, source: { kind: "text", text: "{}" }, bytes: 2, sha256: hash("{}") };
}
const pair = () => [file("script.py", "text/x-python"), file("book.ipynb", "application/x-ipynb+json")];
const failed = (code: Code, path?: string) => ({
	status: "failed",
	code,
	committed: path ? [{ path }] : [],
	cleanup: "complete",
});
function reviewerFor(
	base: string,
	state: { denied: boolean; category: "compute-preflight" | "application-state-write" },
) {
	const store = createP5ReceiptStore({ path: join(base, "receipts.json"), registry: new StorageRegistry() });
	return createP5BundleReviewer(store, async (bundle) => {
		if (state.denied) return null;
		await store.accept(
			{ requestId: "decision" },
			{
				receiptRef: "review",
				operation: "files.writeBundle",
				inputSha256: bundle.sha256,
				scope: bundle.scope,
				category: state.category,
				decision: "approved",
				status: "accepted",
				at: "2026-11-18T00:00:00Z",
				resultSha256: null,
				readback: [],
				parentReceiptRef: null,
			},
		);
		return { requestId: "decision" };
	});
}
function fixture(files = [file()]) {
	const base = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "p5-bundle-")));
	const output = join(base, "exports"),
		stagingRoot = join(base, "staging");
	for (const directory of [output, stagingRoot]) fs.mkdirSync(directory);
	const controller = new AbortController();
	const scope = {
		workspaceId: "w",
		sessionId: "s",
		callerSourceHash: hash("c"),
		providerSourceHash: hash("p"),
	};
	const owner = { ...scope, callerId: "caller", action: "export", signal: controller.signal };
	const state = {
		consent: true,
		denied: false,
		category: "compute-preflight" as "compute-preflight" | "application-state-write",
	};
	const staging = new P5ByteStaging(stagingRoot, () => owner);
	const leases = new PluginResourceReservations(join(base, "leases"));
	const ports = {
		root: base,
		target: { destination: "exports", audience: "private" as const },
		staging,
		owner: () => owner,
		reviewer: reviewerFor(base, state),
		consent: () => state.consent,
		reservations: () => leases,
	};
	const request = { requestId: "export", files };
	const run = async (input: unknown = request) => {
		const result = await p5BundleCapability(ports).execute(input, {
			pluginId: "plugin",
			applicationId: "app",
			scope: { kind: "application" },
			callerIdentity: {},
			signal: controller.signal,
			bootstrap: false,
			capabilities: { call: async () => null },
		});
		expect(JSON.stringify(result)).not.toContain(base);
		return result;
	};
	onTestFinished(() => {
		vi.restoreAllMocks();
		controller.abort();
		leases.dispose();
		fs.rmSync(base, { recursive: true, force: true });
	});
	const stage = (bytes = Buffer.from("{}")) => {
		const ref = staging.open({ requestId: "stage", path: "capsule.json", bytes: bytes.length });
		staging.chunk({ ...ref, offset: 0, base64: bytes.toString("base64") }, 150);
		return staging.seal({ ...ref, bytes: bytes.length, sha256: hash(bytes) });
	};
	return { base, output, owner, state, ports, request, controller, stagingRoot, run, stage };
}
it.each([[file()], pair()])("commits %j with actual byte/hash readback", async (...files) => {
	const f = await fixture(files);
	const expected = files.map(({ path, bytes, sha256 }) => ({ path: `exports/${path}`, bytes, sha256 }));
	const result = await f.run();
	expect(result).toMatchObject({ status: "ok", code: null, cleanup: "complete" });
	expect(result).toMatchObject({ committed: expected, readback: expected });
	for (const entry of files) expect(fs.readFileSync(join(f.output, entry.path))).toEqual(Buffer.from("{}"));
	expect(fs.readdirSync(f.output)).toHaveLength(files.length);
});
it.each("third single-script two-capsules source root scope approval review unreviewed denied S".split(" "))(
	"rejects %s before writing",
	async (kind) => {
		const f = await fixture();
		if (kind === "third") f.request.files = [...pair(), file()];
		if (kind === "single-script") f.request.files = [file("script.py", "text/x-python")];
		if (kind === "two-capsules") f.request.files = [file(), file("second.json")];
		if (kind === "source") Reflect.set(f.request, "files", [{ ...file(), source: { kind: "path" } }]);
		if (["root", "scope", "approval", "review"].includes(kind)) Reflect.set(f.request, kind, f.base);
		if (kind === "unreviewed")
			vi.spyOn(f.ports.reviewer, "review").mockImplementation(async (bundle) => ({
				bundle,
				computeReceiptRef: "old",
			}));
		if (kind === "denied") f.state.denied = true;
		if (kind === "S") f.state.category = "application-state-write";
		expect(await f.run()).toMatchObject(
			failed(["unreviewed", "denied", "S"].includes(kind) ? "DENIED" : "INVALID_INPUT"),
		);
		expect(fs.readdirSync(f.output)).toEqual([]);
	},
);
it.each(["scope", "consent", "cancel"])(
	"reports the first commit when %s changes during file two",
	async (kind) => {
		const f = await fixture(pair());
		const sync = fs.fsyncSync;
		vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
			sync(fd);
			if (!fs.existsSync(join(f.output, "script.py"))) return;
			if (kind === "scope") f.owner.sessionId = "other";
			if (kind === "consent") f.state.consent = false;
			if (kind === "cancel") f.controller.abort();
		});
		const code = kind === "scope" ? "SCOPE_CHANGED" : kind === "consent" ? "DENIED" : "CANCELLED";
		expect(await f.run()).toMatchObject(failed(code, "exports/script.py"));
		expect(fs.readdirSync(f.output)).toEqual(["script.py"]);
	},
);
it("preserves a pre-existing output on conflict", async () => {
	const f = await fixture();
	fs.writeFileSync(join(f.output, "capsule.json"), "prior");
	expect(await f.run()).toMatchObject(failed("STATE_CONFLICT"));
	expect(fs.readFileSync(join(f.output, "capsule.json"), "utf8")).toBe("prior");
	expect(fs.readdirSync(f.output)).toEqual(["capsule.json"]);
});
it.each(["valid", "hash", "tampered", "utf8"])("re-verifies staged source: %s", async (kind) => {
	const f = await fixture(kind === "utf8" ? pair() : [file()]);
	const { fileRef, bytes, sha256 } = f.stage(kind === "utf8" ? Buffer.from([0xff, 0xfe]) : undefined);
	f.request.files[0] = {
		...(kind === "utf8" ? file("script.py", "text/x-python") : file()),
		source: { kind: "staged-file", fileRef },
		bytes,
		sha256: kind === "hash" ? hash("different") : sha256,
	};
	if (kind === "tampered") fs.writeFileSync(join(f.stagingRoot, `${fileRef}.staged`), "xx");
	expect(await f.run()).toMatchObject({
		status: kind === "valid" ? "ok" : "failed",
		...(kind === "valid" ? {} : { committed: [] }),
	});
	expect(fs.readdirSync(f.output)).toEqual(kind === "valid" ? ["capsule.json"] : []);
});
it("rejects a parent replaced with a symlink between files", async () => {
	const f = fixture(pair());
	vi.spyOn(f.ports, "consent").mockImplementation(() => {
		if (fs.existsSync(join(f.output, "script.py"))) {
			fs.renameSync(f.output, join(f.base, "moved"));
			fs.symlinkSync(f.stagingRoot, f.output);
		}
		return true;
	});
	expect(await f.run()).toMatchObject(failed("PATH_ESCAPE", "exports/script.py"));
	expect(fs.readdirSync(join(f.base, "moved"))).toEqual(["script.py"]);
	expect(fs.readdirSync(f.stagingRoot)).toEqual([]);
});
