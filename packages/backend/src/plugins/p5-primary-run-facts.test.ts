import { contractContentHash } from "@drone/shared";
import type { Scope } from "@gyoungwe/plugin-api/p5-receipts";
import { expect, it, vi } from "vitest";
import {
	createP5PrimaryRunResolver,
	type PrimaryRunRecord,
	verifyP5PrimaryRunBinding,
} from "./p5-primary-run-facts";

const scope: Scope = {
	workspaceId: "workspace-1",
	sessionId: "session-1",
	callerSourceHash: "a".repeat(64),
	providerSourceHash: "b".repeat(64),
};
const input = { primaryRunReceiptRef: "primary-run-1", findingId: "finding-1" };
const denied = { status: "failed", code: "DENIED", receiptRef: null };
const invalid = { status: "failed", code: "INVALID_INPUT", receiptRef: null };
const runRecord = (overrides: Partial<PrimaryRunRecord> = {}): PrimaryRunRecord => ({
	primaryRunReceiptRef: input.primaryRunReceiptRef,
	workspaceId: scope.workspaceId,
	sessionId: scope.sessionId,
	sourceHash: scope.callerSourceHash,
	origin: "host",
	findingIds: [input.findingId, "finding-2"],
	provider: { providerId: "host-provider", modelId: "host-model" },
	...overrides,
});

it("binds only host provider identity and freezes a detached snapshot with the exact hash", async () => {
	const provider = { providerId: "host-provider", modelId: "host-model" };
	const record = runRecord({ provider });
	const runOf = vi.fn(async () => record);
	const result = await createP5PrimaryRunResolver({ runOf }).resolve(input, scope);
	expect(runOf).toHaveBeenCalledExactlyOnceWith(input.primaryRunReceiptRef, scope);
	expect(result).toEqual({
		status: "ok",
		value: {
			...input,
			provider,
			bindingSha256: contractContentHash({
				...input,
				provider,
				workspaceId: scope.workspaceId,
				sessionId: scope.sessionId,
			}),
		},
	});
	if (result.status !== "ok") throw new Error("Expected a primary run binding");
	expect(Object.isFrozen(result.value)).toBe(true);
	expect(Object.isFrozen(result.value.provider)).toBe(true);
	expect(Reflect.set(result.value, "findingId", "replacement")).toBe(false);
	expect(Reflect.set(result.value.provider, "providerId", "replacement")).toBe(false);
	expect(Object.isFrozen(provider)).toBe(false);
	provider.providerId = "changed-host-provider";
	expect(result.value.provider.providerId).toBe("host-provider");
});

it.each([
	{ provider: { providerId: "asserted-provider", modelId: "asserted-model" } },
	{ providerId: "asserted-provider" },
	{ modelId: "asserted-model" },
	{ origin: "host" },
	{ unexpected: "extra-value" },
])("rejects extra input keys %j before consulting the port", async (extra) => {
	const runOf = vi.fn(async () => runRecord());
	const resolver = createP5PrimaryRunResolver({ runOf });
	expect(await resolver.resolve({ ...input, ...extra }, scope)).toEqual(invalid);
	expect(runOf).not.toHaveBeenCalled();
});

it.each([null, [], {}, { ...input, findingId: 1 }, { ...input, primaryRunReceiptRef: "" }])(
	"rejects malformed input %j without a port call",
	async (candidate) => {
		const runOf = vi.fn(async () => runRecord());
		expect(await createP5PrimaryRunResolver({ runOf }).resolve(candidate, scope)).toEqual(invalid);
		expect(runOf).not.toHaveBeenCalled();
	},
);

it.each([
	{ workspaceId: "foreign-workspace" },
	{ sessionId: "foreign-session" },
	{ sourceHash: "c".repeat(64) },
])("returns byte-identical denial for unknown and foreign-scope runs %j", async (foreignScope) => {
	const unknown = createP5PrimaryRunResolver({ runOf: async () => undefined });
	const foreign = createP5PrimaryRunResolver({
		runOf: async () => runRecord({ ...foreignScope, findingIds: [] }),
	});
	const unknownResult = await unknown.resolve(input, scope);
	const foreignResult = await foreign.resolve(input, scope);
	expect(unknownResult).toEqual(denied);
	expect(JSON.stringify(foreignResult)).toBe(JSON.stringify(unknownResult));
});

it.each(["imported", "plugin"] as const)("rejects %s run identity", async (origin) => {
	const resolver = createP5PrimaryRunResolver({ runOf: async () => runRecord({ origin }) });
	expect(await resolver.resolve(input, scope)).toEqual(denied);
});

it("rejects a primary run that did not produce the requested finding", async () => {
	const resolver = createP5PrimaryRunResolver({ runOf: async () => runRecord() });
	expect(await resolver.resolve({ ...input, findingId: "unrelated-finding" }, scope)).toEqual(invalid);
	const first = await resolver.resolve(input, scope);
	const second = await resolver.resolve({ ...input, findingId: "finding-2" }, scope);
	if (first.status !== "ok" || second.status !== "ok") throw new Error("Expected related bindings");
	expect(second.value.bindingSha256).not.toBe(first.value.bindingSha256);
});

it("re-resolves through a new resolver after reopen and rejects a changed binding hash", async () => {
	const record = runRecord();
	const first = createP5PrimaryRunResolver({ runOf: async () => record });
	const result = await first.resolve(input, scope);
	if (result.status !== "ok") throw new Error("Expected a primary run binding");
	const runOf = vi.fn(async () => structuredClone(record));
	const reopened = createP5PrimaryRunResolver({ runOf });
	expect(await verifyP5PrimaryRunBinding(reopened, result.value, scope)).toBe(true);
	expect(runOf).toHaveBeenCalledExactlyOnceWith(input.primaryRunReceiptRef, scope);
	expect(
		await verifyP5PrimaryRunBinding(reopened, { ...result.value, bindingSha256: "0".repeat(64) }, scope),
	).toBe(false);
});

it.each(["providerId", "modelId"] as const)("detects host %s drift", async (key) => {
	const provider = { providerId: "host-provider", modelId: "host-model" };
	const resolver = createP5PrimaryRunResolver({ runOf: async () => runRecord({ provider }) });
	const result = await resolver.resolve(input, scope);
	if (result.status !== "ok") throw new Error("Expected a primary run binding");
	provider[key] = "changed-identity";
	expect(await verifyP5PrimaryRunBinding(resolver, result.value, scope)).toBe(false);
});

it.each([
	{ workspaceId: "changed-workspace" },
	{ sessionId: "changed-session" },
	{ callerSourceHash: "c".repeat(64) },
])("rejects verification after caller scope changes %j", async (changedScope) => {
	const resolver = createP5PrimaryRunResolver({ runOf: async () => runRecord() });
	const result = await resolver.resolve(input, scope);
	if (result.status !== "ok") throw new Error("Expected a primary run binding");
	expect(await verifyP5PrimaryRunBinding(resolver, result.value, { ...scope, ...changedScope })).toBe(false);
});

it("rejects verification if the durable host run disappears", async () => {
	const runOf = vi.fn<() => Promise<PrimaryRunRecord | undefined>>().mockResolvedValue(runRecord());
	const resolver = createP5PrimaryRunResolver({ runOf });
	const result = await resolver.resolve(input, scope);
	if (result.status !== "ok") throw new Error("Expected a primary run binding");
	runOf.mockResolvedValue(undefined);
	expect(await verifyP5PrimaryRunBinding(resolver, result.value, scope)).toBe(false);
});

it("propagates port errors unchanged during resolution and verification", async () => {
	const error = new Error("Synthetic host run read failure");
	const runOf = vi.fn(async () => runRecord());
	const resolver = createP5PrimaryRunResolver({ runOf });
	const result = await resolver.resolve(input, scope);
	if (result.status !== "ok") throw new Error("Expected a primary run binding");
	runOf.mockRejectedValue(error);
	await expect(resolver.resolve(input, scope)).rejects.toBe(error);
	await expect(verifyP5PrimaryRunBinding(resolver, result.value, scope)).rejects.toBe(error);
});
