import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CriticInput, CriticResult } from "@gyoungwe/plugin-api/p5-discovery";
import { type Scope, validateP5Receipt } from "@gyoungwe/plugin-api/p5-receipts";
import { afterEach, expect, it, vi } from "vitest";
import { StorageRegistry } from "../storage/registry";
import { createP5CriticHandler, type P5CriticPorts } from "./p5-critic-capability";
import { createP5PrimaryRunResolver, type PrimaryRunRecord } from "./p5-primary-run-facts";
import { createP5ReceiptStore } from "./p5-receipt-store";
import { PluginCapabilityBroker } from "./runtime-capabilities";

const scope: Scope = {
	workspaceId: "workspace-1",
	sessionId: "session-1",
	callerSourceHash: "a".repeat(64),
	providerSourceHash: "b".repeat(64),
};
const request: CriticInput = {
	requestId: "critic-1",
	findingId: "finding-1",
	findingStatement: "Synthetic finding",
	artifactIds: ["artifact-1"],
	primaryRunReceiptRef: "primary-1",
	profile: "critic",
	budget: { maxTokens: 100, maxCost: null, timeoutMs: 1000, maxOutputBytes: 10000 },
};
const answer: CriticResult = {
	status: "complete",
	provider: "model-asserted",
	questions: [],
	modelReceiptRef: "asserted-ref",
	journalVersion: null,
	inquiryReceiptRefs: [],
};
const reported = { inputTokens: 120, outputTokens: 30, cost: null };
const directories: string[] = [];
const caller = {
	pluginId: "fixture",
	applicationId: "fixture",
	callerIdentity: {},
	bootstrap: false,
	scope: {
		kind: "session" as const,
		workspaceId: "workspace-1",
		sessionId: "session-1",
		workspaceDirectory: "/fixture",
	},
	signal: new AbortController().signal,
};
afterEach(async () => {
	await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })));
});
async function fixture(metered = true, overrides: Partial<PrimaryRunRecord> = {}) {
	const directory = await mkdtemp(join(tmpdir(), "drone-p5-critic-"));
	directories.push(directory);
	const path = join(directory, "receipts.json");
	const open = () => createP5ReceiptStore({ path, registry: new StorageRegistry() });
	const primary = createP5PrimaryRunResolver({
		runOf: async () => ({
			primaryRunReceiptRef: "primary-1",
			workspaceId: scope.workspaceId,
			sessionId: scope.sessionId,
			sourceHash: scope.callerSourceHash,
			origin: "host",
			findingIds: ["finding-1"],
			provider: { providerId: "primary-provider", modelId: "primary-model" },
			...overrides,
		}),
	});
	const check = vi.fn(async (): Promise<"allowed" | "denied"> => "denied");
	const record = vi.fn<P5CriticPorts["spend"]["record"]>(async () => undefined);
	const resolveProfile = vi.fn(async () => ({ providerId: "critic-provider", modelId: "critic-model" }));
	const generateStructured = vi.fn<P5CriticPorts["generateStructured"]>(async () => ({
		value: answer,
		usage: reported,
	}));
	const ports: P5CriticPorts = {
		store: open(),
		now: () => "2026-11-18T00:00:00Z",
		scope: () => scope,
		metered,
		primary,
		spend: { check, record },
		resolveProfile,
		generateStructured,
	};
	const broker = new PluginCapabilityBroker({
		resources: [],
		handlers: { "model.critic.review": createP5CriticHandler(ports) },
	});
	const run = async (input: unknown = request, approved = true, effect: "read" | "write" = "write") => {
		const result = await broker.run(
			caller,
			effect,
			() => undefined,
			async () => approved,
			() => broker.port.call("model.critic.review", input),
		);
		const receipt = await open().get(request);
		for (const [recorded] of record.mock.calls) {
			expect(validateP5Receipt({ ...receipt, usage: recorded.usage })).toEqual({ ok: true });
			expect(recorded.usage).toEqual(receipt?.usage);
		}
		return result;
	};
	return { open, path, ports, run, check, record, resolveProfile, generateStructured };
}
it("records exhausted spend before dispatch with zero model calls", async () => {
	const host = await fixture();
	expect(await host.run()).toMatchObject({ status: "failed", code: "BUDGET_EXHAUSTED" });
	expect(host.generateStructured).toHaveBeenCalledTimes(0);
	expect(host.check).toHaveBeenCalledExactlyOnceWith({ workspaceId: scope.workspaceId, metered: true });
	expect(await host.open().get(request)).toMatchObject({ decision: "denied", status: "failed" });
	expect(host.record).not.toHaveBeenCalled();
});
it.each([
	[{ origin: "imported" }, "DENIED"],
	[{ findingIds: ["unrelated"] }, "INVALID_INPUT"],
	[{ workspaceId: "foreign" }, "DENIED"],
	[
		{ provider: { providerId: "critic-provider", modelId: "different-model" } },
		"INDEPENDENT_PROVIDER_REQUIRED",
	],
] satisfies [Partial<PrimaryRunRecord>, string][])(
	"refuses non-independent primary metadata %j",
	async (primary, code) => {
		const host = await fixture(true, primary);
		host.check.mockResolvedValue("allowed");
		expect(await host.run()).toMatchObject({ status: "failed", code });
		expect(host.generateStructured).toHaveBeenCalledTimes(0);
		expect(host.check).not.toHaveBeenCalled();
		expect(await host.open().get(request)).toMatchObject({ decision: "denied", status: "failed" });
	},
);
it.each([true, false])("records known token usage without cost with metered=%s", async (metered) => {
	const host = await fixture(metered);
	if (metered) host.check.mockResolvedValue("allowed");
	const result = await host.run();
	const receipt = await host.open().get(request);
	expect(result).toEqual({
		status: "ok",
		value: { ...answer, provider: "critic-provider", modelReceiptRef: receipt?.receiptRef },
	});
	expect(receipt).toMatchObject({
		status: "succeeded",
		category: "background-model-spend",
		usage: { state: "known", metered, ...reported },
	});
	expect(host.generateStructured).toHaveBeenCalledTimes(1);
	expect(host.generateStructured.mock.calls[0]?.[0]).toMatchObject({
		selection: { providerId: "critic-provider", modelId: "critic-model" },
	});
	expect(host.generateStructured.mock.calls[0]?.[0]).not.toHaveProperty("tools");
	expect(host.check).toHaveBeenCalledTimes(metered ? 1 : 0);
	expect(host.record).toHaveBeenCalledExactlyOnceWith({
		workspaceId: scope.workspaceId,
		usage: receipt?.usage,
	});
	expect(await readFile(host.path, "utf8")).not.toContain(request.findingStatement);
	expect(await host.run()).toMatchObject({ status: "failed", code: "STATE_CONFLICT" });
	expect(host.generateStructured).toHaveBeenCalledTimes(1);
});
it.each(
	[null, -1, 1.5, Infinity, NaN].flatMap((count) =>
		(["inputTokens", "outputTokens"] as const).map((field) => ({ field, count })),
	),
)("persists unknown token counts: $field=$count", async ({ field, count }) => {
	const host = await fixture(false);
	const usage = { ...reported, [field]: count, cost: { amountMicros: 250, currency: "USD" } };
	host.generateStructured.mockResolvedValue({ value: answer, usage });
	const expected = { ...usage, [field]: null, state: "unknown", metered: false };
	expect(await host.run()).toMatchObject({ status: "ok" });
	expect((await host.open().get(request))?.usage).toEqual(expected);
	expect(host.record).toHaveBeenCalledExactlyOnceWith({
		workspaceId: scope.workspaceId,
		usage: expected,
	});
});
it.each([
	{ amountMicros: -3, currency: "USD" },
	{ amountMicros: 250, currency: "usd" },
])("persists known tokens with invalid cost %j as null", async (cost) => {
	const host = await fixture(false);
	host.generateStructured.mockResolvedValue({ value: answer, usage: { ...reported, cost } });
	expect(await host.run()).toMatchObject({ status: "ok" });
	expect((await host.open().get(request))?.usage).toEqual({
		...reported,
		state: "known",
		metered: false,
	});
});
it.each(["invalid", "unknown", "throws"])(
	"records %s model output without inventing success or usage",
	async (mode) => {
		const host = await fixture(false);
		const usage = mode === "invalid" ? reported : { inputTokens: null, outputTokens: null, cost: null };
		host.generateStructured.mockResolvedValue({
			value: mode === "invalid" ? { ...answer, tools: [] } : answer,
			usage,
		});
		if (mode === "throws")
			host.generateStructured.mockRejectedValue(new Error("Synthetic private model payload"));
		const result = await host.run();
		const receipt = await host.open().get(request);
		if (mode === "unknown") expect(result).toMatchObject({ status: "ok" });
		else
			expect(result).toMatchObject({
				status: "failed",
				code: mode === "invalid" ? "INVALID_INPUT" : "OUTCOME_UNKNOWN",
			});
		expect(receipt).toMatchObject({
			status: mode === "invalid" ? "failed" : mode === "throws" ? "outcome-unknown" : "succeeded",
			usage: { ...usage, metered: false, state: mode === "invalid" ? "known" : "unknown" },
		});
		expect(host.record).toHaveBeenCalledTimes(1);
		expect(host.generateStructured).toHaveBeenCalledTimes(1);
		expect(await readFile(host.path, "utf8")).not.toContain("Synthetic private model payload");
	},
);
