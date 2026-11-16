import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

async function verifyReviewAuthority(ctx) {
	ctx.stage = "review-write-authority-and-project";
	ctx.denyReviewWrites = true;
	await expect(ctx.reviewWrite("applyReview", ctx.reviewInput)).rejects.toThrow("denied");
	ctx.denyReviewWrites = false;
	expect(await readFile(join(ctx.vault, ctx.alphaProposal.path), "utf8")).toBe(ctx.beforeWiki);
	await expect(
		ctx.reviewWrite("applyReview", {
			...ctx.reviewInput,
			id: ctx.betaProposal.id,
			expectedProposalHash: ctx.betaProposal.proposalHash,
		}),
	).rejects.toThrow("different project");
	await expect(
		ctx.reviewWrite("applyReview", { ...ctx.reviewInput, expectedProposalHash: "0".repeat(64) }),
	).rejects.toThrow("changed");
	await writeFile(join(ctx.vault, ctx.alphaProposal.path), `${ctx.beforeWiki}Human edit before apply.\n`);
	await expect(ctx.reviewWrite("applyReview", ctx.reviewInput)).rejects.toThrow(
		"no user edits were overwritten",
	);
	expect(await readFile(join(ctx.vault, ctx.alphaProposal.path), "utf8")).toBe(
		`${ctx.beforeWiki}Human edit before apply.\n`,
	);
	await writeFile(join(ctx.vault, ctx.alphaProposal.path), ctx.beforeWiki);
}

async function verifyPartialWrite(ctx) {
	ctx.stage = "review-partial-write-receipt";
	ctx.failNextReviewRecord = true;
	ctx.writesBefore = ctx.capabilityScopes.filter((call) => call.name === "files.writeText").length;
	ctx.partial = await ctx.reviewWrite("applyReview", ctx.reviewInput);
	expect(ctx.partial).toMatchObject({
		vaultWritten: true,
		reviewRecorded: false,
		indexed: true,
		recovered: false,
		recordError: "Acceptance record persistence failure",
	});
	expect(await readFile(join(ctx.vault, ctx.alphaProposal.path), "utf8")).toBe(ctx.afterWiki);
	expect(await readFile(join(ctx.pendingDirectory, `${ctx.alphaProposal.id}.json`), "utf8")).toBe(
		ctx.proposalBytes,
	);
	expect(await ctx.reviewWrite("reviewHistory", { revision: 1 })).toMatchObject({ items: [] });
}

async function verifyRetryRecovery(ctx) {
	ctx.stage = "review-partial-retry-recovery";
	ctx.applied = await ctx.reviewWrite("applyReview", ctx.reviewInput);
	expect(ctx.applied).toMatchObject({
		vaultWritten: true,
		reviewRecorded: true,
		indexed: true,
		recovered: true,
		recordError: null,
		indexError: null,
	});
	expect(
		ctx.capabilityScopes.filter((call) => call.name === "files.writeText").length - ctx.writesBefore,
	).toBe(1);
	ctx.history = await ctx.reviewWrite("reviewHistory", { revision: 1 });
	expect(ctx.history).toMatchObject({
		project: "alpha",
		items: [
			{
				id: ctx.alphaProposal.id,
				path: ctx.alphaProposal.path,
				afterHash: ctx.alphaProposal.afterHash,
			},
		],
	});
	await expect(
		ctx.reviewWrite("undoReview", {
			revision: 1,
			id: ctx.betaProposal.id,
			expectedHash: ctx.betaProposal.afterHash,
		}),
	).rejects.toThrow();
	await expect(
		ctx.reviewWrite("undoReview", { revision: 1, id: ctx.alphaProposal.id, expectedHash: "0".repeat(64) }),
	).rejects.toThrow("Refresh Wiki history before undo");
	await writeFile(join(ctx.vault, ctx.alphaProposal.path), `${ctx.afterWiki}Human edit after apply.\n`);
	await expect(
		ctx.reviewWrite("undoReview", {
			revision: 1,
			id: ctx.alphaProposal.id,
			expectedHash: ctx.alphaProposal.afterHash,
		}),
	).rejects.toThrow("undo would overwrite edits");
	expect(await readFile(join(ctx.vault, ctx.alphaProposal.path), "utf8")).toBe(
		`${ctx.afterWiki}Human edit after apply.\n`,
	);
	await writeFile(join(ctx.vault, ctx.alphaProposal.path), ctx.afterWiki);
}

async function verifyUndoReadback(ctx) {
	ctx.stage = "review-undo-and-history-readback";
	expect(
		await ctx.reviewWrite("undoReview", {
			revision: 1,
			id: ctx.alphaProposal.id,
			expectedHash: ctx.alphaProposal.afterHash,
		}),
	).toMatchObject({ status: "reverted", path: ctx.alphaProposal.path });
	expect(await readFile(join(ctx.vault, ctx.alphaProposal.path), "utf8")).toBe(ctx.beforeWiki);
	expect(await ctx.reviewWrite("reviewHistory", { revision: 1 })).toMatchObject({ items: [] });
	expect(await readFile(join(ctx.vault, ctx.betaProposal.path), "utf8")).toBe(ctx.beforeWiki);
}

export async function verifyReviewWrites(ctx) {
	await verifyReviewAuthority(ctx);
	await verifyPartialWrite(ctx);
	await verifyRetryRecovery(ctx);
	await verifyUndoReadback(ctx);
}
