import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ComputeRerunInput } from "@gyoungwe/plugin-api/p5-inquiry";
import type { Receipt, Scope } from "@gyoungwe/plugin-api/p5-receipts";
import { Type } from "typebox";
import { expect, it, vi } from "vitest";
import { createP5ComputePlanStore } from "../services/p5-compute-plans";
import { createP5ComputeSourceStore } from "../services/p5-compute-sources";
import { StorageRegistry } from "../storage/registry";
import { withP5ReviewPreparation } from "./p5-review-preparation";
import { PluginCapabilityBroker, type PluginCapabilityHandler } from "./runtime-capabilities";

const scope: Scope = {
	workspaceId: "workspace",
	sessionId: "session",
	callerSourceHash: "a".repeat(64),
	providerSourceHash: "b".repeat(64),
};
const request: ComputeRerunInput = {
	requestId: "request",
	sourceRunReceiptRef: "source-receipt",
	artifactId: "artifact",
	expectedSha256: createHash("sha256").update("reviewed").digest("hex"),
	profile: "local",
	preflightRef: "plan",
	budget: { maxTokens: 100, maxCost: 1, timeoutMs: 1000, maxOutputBytes: 100 },
};
const context = {
	pluginId: "plugin",
	applicationId: "app",
	callerIdentity: {},
	bootstrap: false,
	scope: {
		kind: "session" as const,
		workspaceId: "workspace",
		sessionId: "session",
		workspaceDirectory: "/synthetic",
	},
	signal: new AbortController().signal,
};
const base = () => ({
	inputSchema: ComputeRerunInput,
	resultSchema: Type.String(),
	effect: "write" as const,
	approval: "always" as const,
	approvalDetail: vi.fn((snapshot: unknown) => JSON.stringify(snapshot)),
	observe: vi.fn<NonNullable<PluginCapabilityHandler["observe"]>>((_input, _context, invocation) =>
		invocation.execute(),
	),
	execute: vi.fn(async (_snapshot: unknown) => "submitted"),
});
function invoke(
	handler: PluginCapabilityHandler,
	authorize: Parameters<PluginCapabilityBroker["run"]>[3] = vi.fn(async () => true),
	input: unknown = request,
	check: () => void = vi.fn(),
) {
	const broker = new PluginCapabilityBroker({ resources: [], handlers: { rerun: handler } });
	return broker.run(context, "write", check, authorize, () => broker.port.call("rerun", input));
}
const file = { path: "source.bin", bytes: 8, sha256: request.expectedSha256 };
const receipt: Receipt = {
	receiptRef: request.sourceRunReceiptRef,
	requestId: "source",
	operation: "execution.batch.run",
	inputSha256: "c".repeat(64),
	scope,
	category: "compute-preflight",
	decision: "approved",
	status: "succeeded",
	at: "2026-11-19T00:00:00Z",
	resultSha256: "d".repeat(64),
	readback: [file],
	parentReceiptRef: null,
};
async function setup() {
	const directory = await mkdtemp(join(tmpdir(), "drone-p5-review-"));
	const sourcePath = join(directory, "source.bin");
	await writeFile(sourcePath, "reviewed");
	const plans = createP5ComputePlanStore({
		path: join(directory, "plans.json"),
		registry: new StorageRegistry(),
	});
	const plan = await plans.issue(
		{
			preflightRef: request.preflightRef,
			profile: request.profile,
			image: "fixture@sha256:image",
			spec: { jobId: "job", hostAlias: "local", workflow: { name: "fixture", version: "1" } },
			collectionRoot: "/collected",
			expected: [{ path: "output.txt", bytes: 8, sha256: request.expectedSha256 }],
			budget: request.budget,
		},
		scope,
	);
	const current = { scope: { ...scope }, root: "/collected" };
	const sources = createP5ComputeSourceStore({
		path: join(directory, "sources.json"),
		registry: new StorageRegistry(),
		getByRef: async () => receipt,
		readback: async () => ({ collectionRoot: current.root, bytes: await readFile(sourcePath) }),
	});
	await sources.issue({
		scope,
		sourceRunReceiptRef: request.sourceRunReceiptRef,
		runId: "run",
		jobId: "source-job",
		profile: request.profile,
		artifact: { ...file, id: request.artifactId },
		collectionRoot: "/collected",
		planSha256: receipt.inputSha256,
	});
	const ports = {
		scope: () => current.scope,
		resolvePlan: vi.fn(plans.resolve),
		resolveSource: vi.fn(sources.resolveSource),
		checkRoot: vi.fn(async () => true),
	};
	const handler = base();
	return { handler, prepared: withP5ReviewPreparation(handler, ports), ports, plan, sourcePath, current };
}
function expectFrozen(value: unknown): void {
	if (value !== null && typeof value === "object") {
		expect(Object.isFrozen(value)).toBe(true);
		for (const child of Object.values(value)) expectFrozen(child);
	}
}

it("awaits resolution and shares one detached frozen snapshot between prompt and effect", async () => {
	const f = await setup();
	const input = { ...request, budget: { ...request.budget } };
	const authorize = vi.fn<Parameters<PluginCapabilityBroker["run"]>[3]>(
		async (_name, original, _effect, detail) => {
			expect(original).toBe(input);
			expect(f.ports.resolvePlan).toHaveBeenCalledTimes(1);
			expect(f.ports.resolveSource).toHaveBeenCalledTimes(1);
			const reviewed = vi.mocked(f.handler.approvalDetail).mock.calls[0]?.[0];
			expectFrozen(reviewed);
			expect(detail).toBe(JSON.stringify(reviewed));
			input.budget.timeoutMs = 2000;
			return true;
		},
	);
	expect(await invoke(f.prepared, authorize, input)).toBe("submitted");
	const reviewed = vi.mocked(f.handler.approvalDetail).mock.calls[0]?.[0];
	expect(vi.mocked(f.handler.execute).mock.calls[0]?.[0]).toBe(reviewed);
	expect(f.handler.observe.mock.calls[0]?.[0]).toBe(reviewed);
	expect(reviewed).toMatchObject({ request, plan: f.plan, scope, source: { runId: "run" } });
	expect(f.ports.resolvePlan).toHaveBeenCalledTimes(2);
});

it.each(["plan", "bytes", "source-root", "target-root", "grant", "scope"])(
	"refuses stale %s without another prompt",
	async (change) => {
		const f = await setup();
		const authorize = vi.fn(async () => {
			if (change === "plan") f.ports.resolvePlan.mockResolvedValue({ ...f.plan, sha256: "d".repeat(64) });
			if (change === "bytes") await writeFile(f.sourcePath, "tampered");
			if (change === "source-root") f.current.root = "/replacement";
			if (change === "target-root")
				f.ports.resolvePlan.mockResolvedValue({ ...f.plan, collectionRoot: "/replacement" });
			if (change === "scope") f.current.scope.providerSourceHash = "e".repeat(64);
			if (change === "grant") f.ports.checkRoot.mockResolvedValue(false);
			return true;
		});
		await expect(invoke(f.prepared, authorize)).rejects.toThrow("P5 review is stale");
		expect(f.handler.execute).not.toHaveBeenCalled();
		expect(authorize).toHaveBeenCalledTimes(1);
	},
);

it.each(["plan", "source"])("never requests authorization for an unresolvable %s", async (missing) => {
	const f = await setup();
	if (missing === "plan") f.ports.resolvePlan.mockResolvedValue(undefined);
	else f.ports.resolveSource.mockResolvedValue(undefined);
	const authorize = vi.fn(async () => true);
	await expect(invoke(f.prepared, authorize)).rejects.toThrow("P5 review cannot be resolved");
	expect(authorize).not.toHaveBeenCalled();
	expect(f.handler.execute).not.toHaveBeenCalled();
});

it("refuses an unavailable target root before requesting authorization", async () => {
	const f = await setup();
	f.ports.checkRoot.mockResolvedValue(false);
	const authorize = vi.fn(async () => true);
	await expect(invoke(f.prepared, authorize)).rejects.toThrow("P5 review root unavailable");
	expect(authorize).not.toHaveBeenCalled();
});

it("checks input and the caller before preparation and rechecks the caller after awaiting it", async () => {
	const f = await setup();
	const authorize = vi.fn(async () => true);
	await expect(invoke(f.prepared, authorize, {})).rejects.toThrow("Invalid plugin capability input");
	expect(f.ports.resolvePlan).not.toHaveBeenCalled();
	const check = vi.fn().mockImplementation(() => {
		throw new Error("caller revoked");
	});
	await expect(invoke(f.prepared, authorize, request, check)).rejects.toThrow("caller revoked");
	expect(f.ports.resolvePlan).not.toHaveBeenCalled();
	check
		.mockReset()
		.mockImplementationOnce(() => undefined)
		.mockImplementation(() => {
			throw new Error("caller revoked");
		});
	await expect(invoke(f.prepared, authorize, request, check)).rejects.toThrow("caller revoked");
	expect(authorize).not.toHaveBeenCalled();
});

it("preserves the original input and approval policy for capabilities without preparation", async () => {
	const handler = base();
	const authorize = vi.fn(async () => true);
	expect(await invoke(handler, authorize)).toBe("submitted");
	expect(vi.mocked(handler.approvalDetail).mock.calls[0]?.[0]).toBe(request);
	expect(vi.mocked(handler.execute).mock.calls[0]?.[0]).toBe(request);
	expect(handler.observe.mock.calls[0]?.[0]).toBe(request);
	expect(authorize).toHaveBeenCalledWith(
		"rerun",
		request,
		"write",
		JSON.stringify(request),
		context.signal,
		"always",
		undefined,
	);
});
