import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { expect } from "vitest";

async function expectPendingWithoutWrite(ctx, pendingBytes) {
	expect(await readFile(join(ctx.vault, ctx.modelProposal.path), "utf8")).toBe(ctx.beforeWiki);
	expect(await readFile(join(ctx.pendingDirectory, `${ctx.modelProposal.id}.json`), "utf8")).toBe(
		pendingBytes,
	);
	expect(await ctx.reviewWrite("previewReview", ctx.modelIdentity)).toMatchObject({
		id: ctx.modelProposal.id,
		status: "pending",
		canApply: true,
	});
	expect(await ctx.reviewWrite("reviewHistory", { revision: ctx.modelIdentity.revision })).toMatchObject({
		items: [],
	});
}

async function expectPersistedAudit(ctx, review) {
	expect(await ctx.reviewWrite("modelReviewInfo", ctx.modelIdentity)).toMatchObject({
		lastReview: review,
	});
	const directory = join(ctx.state, ctx.overview.binding.vaultId, "wiki-review/model-audits");
	const latest = JSON.parse(await readFile(join(directory, `${ctx.modelProposal.id}.latest.json`), "utf8"));
	expect(latest).toEqual({
		auditId: review.auditId,
		proposalHash: ctx.modelProposal.proposalHash,
	});
	expect(JSON.parse(await readFile(join(directory, `${latest.auditId}.json`), "utf8"))).toEqual(review);
}

async function verifyNonApprovingVerdict(ctx, verdict, pendingBytes) {
	ctx.stage = `real-model-review-${verdict}-no-write`;
	const requestsBefore = ctx.faux.state.callCount;
	ctx.faux.setResponses([
		fauxAssistantMessage(fauxToolCall("structured_result", { ...ctx.advice, verdict })),
	]);
	const review = await ctx.reviewWrite("modelReview", { ...ctx.modelInput, autoApply: true });
	expect(review).toMatchObject({
		proposalId: ctx.modelProposal.id,
		proposalHash: ctx.modelProposal.proposalHash,
		verdict,
		canAutoApply: false,
		autoApplyAuthorized: true,
		applied: false,
		humanReviewed: false,
		scientificallyVerified: false,
	});
	expect(review.applyError).toBeUndefined();
	expect(review.writeResult).toBeUndefined();
	expect(ctx.faux.state.callCount - requestsBefore).toBe(1);
	await expectPendingWithoutWrite(ctx, pendingBytes);
	await expectPersistedAudit(ctx, review);
}

async function verifyDeniedWrite(ctx, pendingBytes) {
	ctx.stage = "real-model-review-approved-write-denied";
	const approvalsBefore = ctx.approvals.length;
	const requestsBefore = ctx.faux.state.callCount;
	ctx.faux.setResponses([fauxAssistantMessage(fauxToolCall("structured_result", ctx.advice))]);
	ctx.denyFileWrite = true;
	try {
		const review = await ctx.reviewWrite("modelReview", { ...ctx.modelInput, autoApply: true });
		expect(review).toMatchObject({
			proposalId: ctx.modelProposal.id,
			proposalHash: ctx.modelProposal.proposalHash,
			verdict: "approve",
			checks: ctx.advice.checks,
			cautions: [],
			canAutoApply: true,
			autoApplyAuthorized: true,
			applied: false,
			applyError: "Plugin capability denied: files.writeText",
			humanReviewed: false,
			scientificallyVerified: false,
		});
		expect(review.writeResult).toBeUndefined();
		expect(ctx.faux.state.callCount - requestsBefore).toBe(1);
		const operations = ctx.approvals.slice(approvalsBefore).map((approval) => approval.operation);
		expect(operations).toEqual(
			expect.arrayContaining(["modelReview", "capability:model.generate", "capability:files.writeText"]),
		);
		expect(operations.indexOf("capability:model.generate")).toBeLessThan(
			operations.indexOf("capability:files.writeText"),
		);
		await expectPendingWithoutWrite(ctx, pendingBytes);
		await expectPersistedAudit(ctx, review);
	} finally {
		ctx.denyFileWrite = false;
	}
}

async function verifyReadOnlyRejection(ctx, pendingBytes) {
	ctx.stage = "real-model-review-readonly-before-provider";
	const previous = await ctx.reviewWrite("modelReviewInfo", ctx.modelIdentity);
	const requestsBefore = ctx.faux.state.callCount;
	ctx.faux.setResponses([fauxAssistantMessage(fauxToolCall("structured_result", ctx.advice))]);
	const readOnlySelection = ctx.bridge.selectSession(ctx.window, ctx.session.sessionId);
	try {
		await expect(
			ctx.bridge.invoke(
				ctx.window,
				ctx.binding,
				"modelReview",
				{ ...ctx.modelInput, autoApply: true },
				readOnlySelection,
			),
		).rejects.toThrow("Plugin operation denied: modelReview");
	} finally {
		ctx.writeSelection = ctx.bridge.selectSession(ctx.window, ctx.writeSession.sessionId);
	}
	expect(ctx.faux.state.callCount - requestsBefore, "read-only review made zero provider requests").toBe(0);
	expect(ctx.faux.getPendingResponseCount()).toBe(1);
	await expectPendingWithoutWrite(ctx, pendingBytes);
	await expectPersistedAudit(ctx, previous.lastReview);
}

export async function verifyModelReviewVerdicts(ctx) {
	ctx.stage = "real-model-review-verdict-fixture";
	// The preceding apply/undo phase consumed the pending proposal and restored the target.
	expect(await readFile(join(ctx.vault, ctx.modelProposal.path), "utf8")).toBe(ctx.beforeWiki);
	const pendingBytes = JSON.stringify(ctx.modelProposal);
	await writeFile(join(ctx.pendingDirectory, `${ctx.modelProposal.id}.json`), pendingBytes);
	const callsBefore = ctx.capabilityScopes.length;
	await verifyNonApprovingVerdict(ctx, "needs-human", pendingBytes);
	await verifyNonApprovingVerdict(ctx, "reject", pendingBytes);
	await verifyDeniedWrite(ctx, pendingBytes);
	await verifyReadOnlyRejection(ctx, pendingBytes);
	expect(
		ctx.capabilityScopes.slice(callsBefore).filter((call) => call.name === "files.writeText"),
		"no Wiki write capability executed during verdict and approval checks",
	).toEqual([]);
	ctx.reviewScopes.modelVerdicts = {
		needsHumanPendingWithAudit: true,
		rejectPendingWithAudit: true,
		modelApprovedWriteDenied: true,
		readOnlyProviderRequests: 0,
		vaultUnchanged: true,
	};
}
