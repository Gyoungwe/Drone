import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { sha256 } from "./helpers.mjs";

async function verifyReadOnlyGrant(ctx) {
	ctx.stage = "state-policy-readonly-grant";
	const readOnly = await ctx.bridge.invoke(ctx.window, ctx.binding, "preferences", null, ctx.application);
	expect(readOnly).toMatchObject({
		canWriteState: false,
		reviewPolicy: { version: null, persistedMode: null, diagnostic: null },
	});
	await expect(
		ctx.bridge.invoke(
			ctx.window,
			ctx.binding,
			"setReviewPolicy",
			{ bindingRevision: 1, expectedVersion: null, mode: "strict" },
			ctx.application,
		),
	).rejects.toThrow("write permission");
	await expect(readFile(join(ctx.state, "review-policy.json"))).rejects.toMatchObject({ code: "ENOENT" });
	await ctx.bridge.revoke("knowledge-artifact");
	ctx.grantStateWrite = true;
	ctx.binding = await ctx.bridge.bind("knowledge-artifact", ctx.window);
}

async function verifyFileGrant(ctx) {
	ctx.stage = "review-file-grant-required";
	await expect(
		ctx.bridge.invoke(
			ctx.window,
			ctx.binding,
			"applyReview",
			{
				revision: 1,
				id: randomUUID(),
				expectedProposalHash: "0".repeat(64),
			},
			ctx.application,
		),
	).rejects.toThrow("Vault write permission");
	await ctx.bridge.revoke("knowledge-artifact");
	ctx.grantFileWrite = true;
	ctx.binding = await ctx.bridge.bind("knowledge-artifact", ctx.window);
}

async function verifyPolicyWrite(ctx) {
	ctx.stage = "state-policy-write-and-readback";
	const writable = await ctx.bridge.invoke(ctx.window, ctx.binding, "preferences", null, ctx.application);
	expect(writable.canWriteState).toBe(true);
	ctx.denyStateWrite = true;
	await expect(
		ctx.bridge.invoke(
			ctx.window,
			ctx.binding,
			"setReviewPolicy",
			{ bindingRevision: 1, expectedVersion: null, mode: "strict" },
			ctx.application,
		),
	).rejects.toThrow("denied");
	await expect(readFile(join(ctx.state, "review-policy.json"))).rejects.toMatchObject({ code: "ENOENT" });
	ctx.denyStateWrite = false;
	ctx.saved = await ctx.bridge.invoke(
		ctx.window,
		ctx.binding,
		"setReviewPolicy",
		{ bindingRevision: 1, expectedVersion: null, mode: "strict" },
		ctx.application,
	);
	ctx.raw = await readFile(join(ctx.state, "review-policy.json"), "utf8");
	expect(JSON.parse(ctx.raw)).toEqual({ version: 1, mode: "strict" });
	expect(ctx.saved.reviewPolicy).toMatchObject({
		mode: "strict",
		persistedMode: "strict",
		version: sha256(ctx.raw),
		diagnostic: null,
	});
	expect(await ctx.bridge.invoke(ctx.window, ctx.binding, "preferences", null, ctx.application)).toEqual(
		ctx.saved,
	);
}

async function verifyPolicyConflicts(ctx) {
	await expect(
		ctx.bridge.invoke(
			ctx.window,
			ctx.binding,
			"setReviewPolicy",
			{ bindingRevision: 1, expectedVersion: null, mode: "automatic" },
			ctx.application,
		),
	).rejects.toThrow("version conflict");
	expect(await readFile(join(ctx.state, "review-policy.json"), "utf8")).toBe(ctx.raw);
	await writeFile(join(ctx.state, "review-policy.json"), "{broken");
	const corrupted = await ctx.bridge.invoke(ctx.window, ctx.binding, "preferences", null, ctx.application);
	expect(corrupted.reviewPolicy).toMatchObject({ mode: "strict", diagnostic: "invalid-json" });
	await expect(
		ctx.bridge.invoke(
			ctx.window,
			ctx.binding,
			"setReviewPolicy",
			{ bindingRevision: 1, expectedVersion: null, mode: "automatic" },
			ctx.application,
		),
	).rejects.toThrow();
	expect(await readFile(join(ctx.state, "review-policy.json"), "utf8")).toBe("{broken");
	await writeFile(join(ctx.state, "review-policy.json"), ctx.raw);
}

async function verifyPolicyReload(ctx) {
	ctx.stage = "state-policy-revoke-and-reload";
	await ctx.bridge.revoke("knowledge-artifact");
	await expect(
		ctx.bridge.invoke(ctx.window, ctx.binding, "preferences", null, ctx.application),
	).rejects.toThrow();
	ctx.binding = await ctx.bridge.bind("knowledge-artifact", ctx.window);
	expect(await ctx.bridge.invoke(ctx.window, ctx.binding, "preferences", null, ctx.application)).toEqual(
		ctx.saved,
	);

	ctx.stateReceipt = {
		status: "PASS",
		readOnlyGrantRejected: true,
		deniedApprovalNoWrite: true,
		atomicReadback: true,
		staleVersionRejected: true,
		malformedStrictDiagnostic: true,
		savedVersion: sha256(ctx.raw),
		revokedBindingRejected: true,
		reloadedPersistedValue: true,
	};
}

export async function verifyStatePolicy(ctx) {
	if (ctx.source.requestsStateWrite) {
		await verifyReadOnlyGrant(ctx);
		await verifyFileGrant(ctx);
		await verifyPolicyWrite(ctx);
		await verifyPolicyConflicts(ctx);
		await verifyPolicyReload(ctx);
	}
}
