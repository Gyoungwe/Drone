import { createHash } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	PluginCapabilityContext,
	PluginRuntimeCapabilitiesOptions,
	PluginSessionCallerContext,
} from "@drone/backend";
import type { StagedRefInput } from "@gyoungwe/plugin-api/p5-evidence";
import { expect, it, onTestFinished, vi } from "vitest";
import { createP5ByteRuntimeCapabilities } from "./p5-byte-runtime-capabilities";
import { selectP5ResourceRoot } from "./p5-resource-roots";

const contentHash = "a".repeat(64);
const source = {
	pluginId: "fixture",
	packageRoot: "/fixture",
	entrypoint: "/fixture/runtime.js",
	contentHash,
};
const bytes = Buffer.from([0x00, 0xff, 0x01, 0x80]);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const openInput = { requestId: "stage", path: "blob", bytes: bytes.length };
const ok = (value: unknown) => ({ status: "ok", value });
const failed = (code: string) => ({ status: "failed", code, receiptRef: null });

function session(directory: string) {
	const controller = new AbortController();
	const identity = {};
	const context: PluginSessionCallerContext = {
		identity,
		sessionIdentity: identity,
		scope: { kind: "session", sessionId: "session", workspaceId: "workspace", workspaceDirectory: directory },
		signal: controller.signal,
		readOnly: false,
		projectTrusted: true,
	};
	return { context, controller };
}

function fixture() {
	const base = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "drone-p5-bytes-")));
	const profile = join(base, "profile");
	const output = join(base, "output");
	fs.mkdirSync(profile);
	fs.mkdirSync(output);
	vi.stubEnv("HOME", base);
	const controller = new AbortController();
	const activation = {
		pluginId: source.pluginId,
		applicationId: "app",
		signal: controller.signal,
		events: { changed: vi.fn() },
	};
	const select = vi.fn(async (_signal: AbortSignal): Promise<readonly string[]> => [output]);
	let selected = session(base);
	const provider = createP5ByteRuntimeCapabilities({
		profileDirectory: profile,
		getSessionContext: (id) => (id === selected.context.scope.sessionId ? selected.context : undefined),
		selectStagedOutputDirectory: select,
	});
	const activate = (optedIn = true) =>
		provider(optedIn ? { ...source, p5: { bytes: "staged-output" } } : source)(activation);
	const callerIdentity = {};
	const callFor =
		(ports: PluginRuntimeCapabilitiesOptions): Call =>
		(name, input, options) =>
			invoke(ports, name, input, selected.context, options ?? { callerIdentity, envelopeBytes: 128 });
	onTestFinished(() => {
		vi.restoreAllMocks();
		controller.abort();
		vi.unstubAllEnvs();
		fs.rmSync(base, { recursive: true, force: true });
	});
	return {
		profile,
		output,
		controller,
		select,
		activate,
		callFor,
		callerIdentity,
		endSession: () => selected.controller.abort(),
		replaceSession: () => {
			selected = session(base);
		},
	};
}

interface CallOptions {
	readonly callerIdentity: object | undefined;
	readonly envelopeBytes?: number;
	readonly approved?: boolean;
}
type Call = (name: string, input: unknown, options?: CallOptions) => Promise<unknown>;

async function invoke(
	ports: PluginRuntimeCapabilitiesOptions,
	name: string,
	input: unknown,
	selected: PluginSessionCallerContext,
	options: CallOptions,
) {
	const handler = ports.handlers[name];
	if (!handler) throw new Error(`Missing byte handler: ${name}`);
	const invocation = new AbortController();
	const context: PluginCapabilityContext = {
		pluginId: source.pluginId,
		applicationId: "app",
		callerIdentity: options.callerIdentity,
		sessionIdentity: selected.identity,
		scope: selected.scope,
		signal: invocation.signal,
		bootstrap: false,
		envelopeBytes: options.envelopeBytes,
		capabilities: {
			call: async () => {
				throw new Error("Unexpected capability call");
			},
		},
	};
	const execute = () => handler.execute(input, context);
	try {
		return handler.observe
			? await handler.observe(input, context, { approved: options.approved ?? true, execute })
			: await execute();
	} finally {
		invocation.abort();
	}
}

async function open(call: Call) {
	const result = await call("bytes.stage.open", openInput);
	expect(result).toMatchObject({ status: "ok", value: { fileRef: expect.any(String) } });
	return (result as { value: StagedRefInput }).value;
}

const chunkInput = (ref: StagedRefInput) => ({ ...ref, offset: 0, base64: bytes.toString("base64") });

async function stage(call: Call) {
	const ref = await open(call);
	const sealed = { ...ref, bytes: bytes.length, sha256 };
	expect(await call("bytes.stage.chunk", chunkInput(ref))).toEqual(ok(null));
	expect(await call("bytes.stage.seal", sealed)).toEqual(ok(sealed));
	return { path: openInput.path, source: sealed, expected: null };
}

function stagingRoot(profile: string) {
	const parent = join(profile, "p5-staging", createHash("sha256").update(source.pluginId).digest("hex"));
	const [directory] = fs.readdirSync(parent);
	if (directory === undefined) throw new Error("Missing activation staging root");
	return join(parent, directory);
}

function reacquire(output: string) {
	const grant = { kind: "staged-output", handle: "fresh", path: output };
	return selectP5ResourceRoot([grant], grant, new AbortController().signal).acquire();
}

async function dispose(ports: PluginRuntimeCapabilitiesOptions) {
	if (!ports.dispose) throw new Error("Missing byte provider disposal");
	await ports.dispose();
}

it("does not select a directory or grant handlers without the bytes opt-in", async () => {
	const fixtureState = fixture();
	expect(await fixtureState.activate(false)).toEqual({ resources: [], handlers: {} });
	expect(fixtureState.select).not.toHaveBeenCalled();
});

it("rejects canceled and ambiguous directory selections", async () => {
	const fixtureState = fixture();
	fixtureState.select
		.mockResolvedValueOnce([])
		.mockResolvedValueOnce([fixtureState.output, fixtureState.profile]);
	await expect(fixtureState.activate()).rejects.toThrow("canceled");
	await expect(fixtureState.activate()).rejects.toThrow("exactly one");
	expect(fixtureState.select).toHaveBeenCalledTimes(2);
});

it("ignores a late directory selection after the activation aborts", async () => {
	const fixtureState = fixture();
	let finishSelection: (paths: readonly string[]) => void = () => {
		throw new Error("Picker did not start");
	};
	fixtureState.select.mockImplementationOnce(
		() =>
			new Promise<readonly string[]>((resolve) => {
				finishSelection = resolve;
			}),
	);
	const activated = fixtureState.activate();
	await Promise.resolve();
	expect(fixtureState.select).toHaveBeenCalledExactlyOnceWith(fixtureState.controller.signal);
	const reason = new Error("Activation ended");
	fixtureState.controller.abort(reason);
	await expect(activated).rejects.toBe(reason);
	finishSelection([fixtureState.output]);
	expect(fs.existsSync(join(fixtureState.profile, "p5-staging"))).toBe(false);
});

it("stages privately across calls and writes exact bytes only after approval", async () => {
	const fixtureState = fixture();
	const ports = await fixtureState.activate();
	const call = fixtureState.callFor(ports);
	expect(ports.resources).toEqual([]);
	const plan = await stage(call);
	expect(fs.readdirSync(fixtureState.output)).toEqual([]);
	const scratch = stagingRoot(fixtureState.profile);
	expect(fs.statSync(scratch).mode & 0o777).toBe(0o700);
	const [owner] = fs.readdirSync(scratch);
	if (owner === undefined) throw new Error("Missing owner staging directory");
	expect(fs.statSync(join(scratch, owner)).mode & 0o777).toBe(0o700);
	expect(
		await call("bytes.write", plan, { callerIdentity: fixtureState.callerIdentity, approved: false }),
	).toEqual(failed("DENIED"));
	expect(fs.readdirSync(fixtureState.output)).toEqual([]);
	expect(await call("bytes.write", plan)).toEqual(
		ok({ file: { path: plan.path, bytes: bytes.length, sha256 }, cleanup: "complete" }),
	);
	expect(fs.readFileSync(join(fixtureState.output, plan.path))).toEqual(bytes);
	expect(fixtureState.select).toHaveBeenCalledExactlyOnceWith(fixtureState.controller.signal);
	await dispose(ports);
});

it("rejects output that would include the private staging root", async () => {
	const fixtureState = fixture();
	fixtureState.select.mockResolvedValueOnce([fixtureState.profile]);
	await expect(fixtureState.activate()).rejects.toThrow("staging");
	expect(fs.readdirSync(fixtureState.profile)).toEqual([]);
});

it("does not let another caller read, chunk or write a staged reference", async () => {
	const fixtureState = fixture();
	const ports = await fixtureState.activate();
	const call = fixtureState.callFor(ports);
	const plan = await stage(call);
	const ref = { fileRef: plan.source.fileRef };
	const other = { callerIdentity: {}, envelopeBytes: 128 };
	expect(await call("bytes.stage.read", ref, other)).toEqual(failed("SCOPE_CHANGED"));
	expect(await call("bytes.stage.chunk", chunkInput(ref), other)).toEqual(failed("SCOPE_CHANGED"));
	expect(await call("bytes.write", plan, other)).toEqual(failed("SCOPE_CHANGED"));
	expect(await call("bytes.stage.read", ref)).toEqual(ok(plan.source));
	expect(fs.readdirSync(fixtureState.output)).toEqual([]);
	await dispose(ports);
});

it.each(["replaceSession", "endSession"] as const)(
	"invalidates the old reference after %s",
	async (revoke) => {
		const fixtureState = fixture();
		const ports = await fixtureState.activate();
		const call = fixtureState.callFor(ports);
		const plan = await stage(call);
		const ref = { fileRef: plan.source.fileRef };
		fixtureState[revoke]();
		if (revoke === "endSession") {
			expect(await call("bytes.stage.read", ref)).toMatchObject({ status: "failed" });
			fixtureState.replaceSession();
		}
		expect(await call("bytes.stage.read", ref)).toEqual(failed("SCOPE_CHANGED"));
		expect((await open(call)).fileRef).not.toBe(plan.source.fileRef);
		await dispose(ports);
	},
);

it("returns a failed chunk result when the host has no envelope measurement", async () => {
	const fixtureState = fixture();
	const ports = await fixtureState.activate();
	const call = fixtureState.callFor(ports);
	const ref = await open(call);
	expect(
		await call("bytes.stage.chunk", chunkInput(ref), { callerIdentity: fixtureState.callerIdentity }),
	).toEqual(failed("READBACK_FAILED"));
	await dispose(ports);
});

it("removes staging, releases the root lease and rejects all byte calls on disposal", async () => {
	const fixtureState = fixture();
	const ports = await fixtureState.activate();
	const call = fixtureState.callFor(ports);
	const plan = await stage(call);
	const ref = { fileRef: plan.source.fileRef };
	const scratch = stagingRoot(fixtureState.profile);
	const requests = {
		"bytes.stage.open": openInput,
		"bytes.stage.chunk": chunkInput(ref),
		"bytes.stage.seal": plan.source,
		"bytes.stage.read": ref,
		"bytes.stage.cancel": ref,
		"bytes.inspect": { path: plan.path },
		"bytes.write": plan,
	};
	expect(Object.keys(ports.handlers).sort()).toEqual(Object.keys(requests).sort());
	expect(() => reacquire(fixtureState.output)).toThrow("already reserved");
	await dispose(ports);
	expect(fs.existsSync(scratch)).toBe(false);
	for (const [name, input] of Object.entries(requests)) {
		expect(await call(name, input)).toEqual(failed("SCOPE_CHANGED"));
	}
	await reacquire(fixtureState.output).close(async () => undefined);
});

it("rejects disposal and retains the output lease after real transaction cleanup fails", async () => {
	const fixtureState = fixture();
	const parent = join(fixtureState.output, "parent");
	const displaced = join(fixtureState.output, "displaced");
	fs.mkdirSync(parent);
	const ports = await fixtureState.activate();
	const call = fixtureState.callFor(ports);
	const plan = await stage(call);
	const scratch = stagingRoot(fixtureState.profile);
	const fsync = fs.fsyncSync;
	vi.spyOn(fs, "fsyncSync").mockImplementationOnce((fd) => {
		fsync(fd);
		fs.renameSync(parent, displaced);
		fs.mkdirSync(parent);
	});
	expect(await call("bytes.write", { ...plan, path: `parent/${plan.path}` })).toEqual(
		failed("CLEANUP_FAILED"),
	);
	expect(fs.readdirSync(displaced)).toHaveLength(1);
	expect(fs.readdirSync(parent)).toEqual([]);
	await expect(dispose(ports)).rejects.toThrow("CLEANUP_FAILED");
	expect(fs.existsSync(scratch)).toBe(false);
	expect(() => reacquire(fixtureState.output)).toThrow("already reserved");
});
