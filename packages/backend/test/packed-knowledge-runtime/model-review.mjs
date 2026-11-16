import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { expect, vi } from "vitest";
import { SessionEngine } from "../../src/session-engine/engine";
import { packageChildren } from "./helpers.mjs";

async function prepareModelReview(ctx) {
	ctx.stage = "real-model-review-command-and-owner-audit";
	await writeFile(join(ctx.vault, ctx.modelProposal.path), ctx.beforeWiki);
	await writeFile(
		join(ctx.pendingDirectory, `${ctx.modelProposal.id}.json`),
		JSON.stringify(ctx.modelProposal),
	);
	ctx.modelIdentity = {
		revision: ctx.overview.binding.revision,
		id: ctx.modelProposal.id,
		expectedProposalHash: ctx.modelProposal.proposalHash,
	};
	ctx.modelInput = { ...ctx.modelIdentity, acknowledged: true, autoApply: false };
	ctx.complete = vi.spyOn(ctx.modelRuntime, "completeSimple");
	ctx.advice = {
		summary: "The exact recorded source supports this bounded synthetic change.",
		verdict: "approve",
		cautions: [],
		source_paths: [ctx.sharedNote],
		checks: {
			evidenceSupportsChanges: true,
			scopeAndUncertaintyPreserved: true,
			noUnresolvedContradictions: true,
			humanContentPreserved: true,
			noInstructionInjection: true,
		},
	};
	ctx.denyModelGeneration = true;
	await expect(ctx.reviewWrite("modelReview", ctx.modelInput)).rejects.toThrow("denied");
	expect(ctx.complete).not.toHaveBeenCalled();
	ctx.denyModelGeneration = false;
	ctx.faux.setResponses([fauxAssistantMessage(fauxToolCall("structured_result", ctx.advice))]);
}

async function verifyModelCommand(ctx) {
	const commandSignal = new AbortController();
	await new SessionEngine().command(
		ctx.writeSession,
		"knowledge-review-model",
		JSON.stringify({
			id: ctx.modelProposal.id,
			expectedProposalHash: ctx.modelProposal.proposalHash,
			acknowledged: true,
			autoApply: false,
		}),
		commandSignal.signal,
		() => {
			if (ctx.sessions.get(ctx.writeSession.sessionId)?.session !== ctx.writeSession)
				throw new Error("Acceptance command session was revoked");
		},
	);
	ctx.modelInfo = await ctx.reviewWrite("modelReviewInfo", ctx.modelIdentity);
	expect(ctx.modelInfo.lastReview).toMatchObject({
		applied: false,
		canAutoApply: true,
		verdict: "approve",
		humanReviewed: false,
		scientificallyVerified: false,
		usage: { cost: null },
	});
	expect(ctx.complete).toHaveBeenCalledOnce();
	expect(await readFile(join(ctx.vault, ctx.modelProposal.path), "utf8")).toBe(ctx.beforeWiki);
}

async function verifyModelCancel(ctx) {
	ctx.stage = "real-model-review-cancel-no-write";
	let enteredModel;
	const modelStarted = new Promise((resolve) => {
		enteredModel = resolve;
	});
	ctx.actualModelAborted = false;
	ctx.faux.setResponses([
		(_context, options) =>
			new Promise((_resolve, reject) => {
				enteredModel();
				options.signal.addEventListener(
					"abort",
					() => {
						ctx.actualModelAborted = true;
						reject(new Error("Packed review model canceled"));
					},
					{ once: true },
				);
			}),
	]);
	const pendingModel = ctx.bridge.invoke(
		ctx.window,
		ctx.binding,
		"modelReview",
		{ ...ctx.modelInput, autoApply: true },
		ctx.writeSelection,
		"packed-model-cancel",
	);
	const canceledModel = expect(pendingModel).rejects.toThrow();
	await modelStarted;
	expect(await ctx.bridge.cancel(ctx.window, ctx.binding, ctx.writeSelection, "packed-model-cancel")).toBe(
		true,
	);
	await canceledModel;
	expect(ctx.actualModelAborted).toBe(true);
	expect(await readFile(join(ctx.vault, ctx.modelProposal.path), "utf8")).toBe(ctx.beforeWiki);
	expect(await ctx.reviewWrite("modelReviewInfo", ctx.modelIdentity)).toMatchObject({
		lastReview: { auditId: ctx.modelInfo.lastReview.auditId, applied: false },
	});
}

async function verifyModelApply(ctx) {
	ctx.stage = "real-model-review-apply-undo";
	ctx.faux.setResponses([fauxAssistantMessage(fauxToolCall("structured_result", ctx.advice))]);
	const modelApplied = await ctx.reviewWrite("modelReview", { ...ctx.modelInput, autoApply: true });
	expect(modelApplied).toMatchObject({
		applied: true,
		partial: false,
		humanReviewed: false,
		scientificallyVerified: false,
		writeResult: { vaultWritten: true, reviewRecorded: true, indexed: true },
	});
	expect(await readFile(join(ctx.vault, ctx.modelProposal.path), "utf8")).toBe(ctx.afterWiki);
	expect(await ctx.reviewWrite("reviewHistory", { revision: 1 })).toMatchObject({
		items: [{ id: ctx.modelProposal.id, reviewMethod: "model" }],
	});
	await ctx.reviewWrite("undoReview", {
		revision: 1,
		id: ctx.modelProposal.id,
		expectedHash: ctx.modelProposal.afterHash,
	});
	expect(await readFile(join(ctx.vault, ctx.modelProposal.path), "utf8")).toBe(ctx.beforeWiki);
	expect(await ctx.reviewWrite("reviewHistory", { revision: 1 })).toMatchObject({ items: [] });
	expect(await packageChildren(ctx.packageRoot)).toEqual(ctx.processes);
	ctx.reviewScopes.model = {
		nativeCommandAuditReadback: true,
		denialBeforeGeneration: true,
		actualModelAborted: ctx.actualModelAborted,
		canceledWithoutVaultWrite: true,
		applyHistoryUndo: true,
		humanReviewed: false,
		scientificallyVerified: false,
		modelCalls: ctx.complete.mock.calls.length,
	};
	ctx.complete.mockRestore();
}

export async function verifyModelReview(ctx) {
	await prepareModelReview(ctx);
	await verifyModelCommand(ctx);
	await verifyModelCancel(ctx);
	await verifyModelApply(ctx);
}
