import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect } from "vitest";
import { run, sha256 } from "./helpers.mjs";

async function createReviewProposals(ctx) {
	ctx.stage = "review-proposal-fixtures";
	ctx.beforeWiki =
		"# Orchid Wiki\nHuman-owned header.\n<!-- pi-agent:managed:start -->\nOld summary\n<!-- pi-agent:managed:end -->\nHuman-owned footer.\n";
	ctx.afterWiki = ctx.beforeWiki.replace("Old summary", "New summary");
	ctx.sourceText = await readFile(join(ctx.vault, ctx.sharedNote), "utf8");
	ctx.sourceReceipt = {
		path: ctx.sharedNote,
		hash: sha256(ctx.sourceText),
		startLine: 1,
		endLine: 2,
		excerptHash: sha256(ctx.sourceText.split("\n").slice(0, 2).join("\n")),
		paperDois: [],
	};
	ctx.proposals = ["alpha", "beta", "alpha"].map((project, index) => ({
		id: randomUUID(),
		vaultId: ctx.overview.binding.vaultId,
		bindingRevision: ctx.overview.binding.revision,
		project,
		path: `Projects/${project}/Wiki/${index === 2 ? "Model" : "Orchid"}.md`,
		title: `${project} Orchid`,
		rationale: "Synthetic review fixture",
		createdAt: Date.now(),
		before: ctx.beforeWiki,
		beforeHash: sha256(ctx.beforeWiki),
		after: ctx.afterWiki,
		afterHash: sha256(ctx.afterWiki),
		status: "pending",
		sources: [ctx.sourceReceipt],
	}));
}

async function finalizeReviewProposals(ctx) {
	// Build hashes with the installed package's public API, never copied domain algorithms.
	const proposalFile = join(ctx.prefix, "proposal-fixtures.json");
	await writeFile(proposalFile, JSON.stringify(ctx.proposals));
	const { stdout: finalizedJson } = await run(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			'import {readFile} from "node:fs/promises";import {immutableWikiProposalHash} from "@gyoungwe/pi-knowledge/host";const proposals=JSON.parse(await readFile(process.argv[1],"utf8"));process.stdout.write(JSON.stringify(proposals.map(p=>({...p,proposalHash:immutableWikiProposalHash(p)}))));',
			proposalFile,
		],
		{
			cwd: ctx.prefix,
			env: {
				PATH: process.env.PATH,
				TMPDIR: ctx.root,
				DRONE_KNOWLEDGE_DIR: ctx.state,
				PI_CODING_AGENT_DIR: ctx.agentDir,
			},
		},
	);
	[ctx.alphaProposal, ctx.betaProposal, ctx.modelProposal] = JSON.parse(finalizedJson);
	ctx.pendingDirectory = join(ctx.state, ctx.overview.binding.vaultId, "wiki-review/pending");
	await mkdir(ctx.pendingDirectory, { recursive: true });
	for (const proposal of [ctx.alphaProposal, ctx.betaProposal]) {
		await mkdir(dirname(join(ctx.vault, proposal.path)), { recursive: true });
		await writeFile(join(ctx.vault, proposal.path), ctx.beforeWiki);
		await writeFile(join(ctx.pendingDirectory, `${proposal.id}.json`), JSON.stringify(proposal));
	}
	ctx.proposalBytes = await readFile(join(ctx.pendingDirectory, `${ctx.alphaProposal.id}.json`), "utf8");
}

async function verifyReviewList(ctx) {
	ctx.stage = "review-application-isolation";
	const reviewApplication = ctx.bridge.selectSession(ctx.window, null);
	expect(
		await ctx.bridge.invoke(
			ctx.window,
			ctx.binding,
			"reviews",
			{ revision: ctx.overview.binding.revision },
			reviewApplication,
		),
	).toMatchObject({ project: null, total: 0, items: [] });
	ctx.stage = "review-readonly-session-preview";
	ctx.reviewSelection = ctx.bridge.selectSession(ctx.window, ctx.session.sessionId);
	const reviewList = await ctx.bridge.invoke(
		ctx.window,
		ctx.binding,
		"reviews",
		{ revision: ctx.overview.binding.revision, limit: 1 },
		ctx.reviewSelection,
	);
	expect(reviewList).toMatchObject({ project: "alpha", total: 1, nextOffset: null, problems: [] });
	expect(reviewList.items.map((value) => ({ id: value.id, proposalHash: value.proposalHash }))).toEqual([
		{ id: ctx.alphaProposal.id, proposalHash: ctx.alphaProposal.proposalHash },
	]);
	ctx.reviewInput = {
		revision: ctx.overview.binding.revision,
		id: ctx.alphaProposal.id,
		expectedProposalHash: ctx.alphaProposal.proposalHash,
	};
	ctx.preview = await ctx.bridge.invoke(
		ctx.window,
		ctx.binding,
		"previewReview",
		ctx.reviewInput,
		ctx.reviewSelection,
	);
}

async function verifyReviewIsolation(ctx) {
	await expect(
		ctx.bridge.invoke(ctx.window, ctx.binding, "applyReview", ctx.reviewInput, ctx.reviewSelection),
	).rejects.toThrow("denied");
	expect(ctx.preview).toMatchObject({
		before: "Old summary",
		after: "New summary",
		protectedText: "# Orchid Wiki\nHuman-owned header.\n（此处为智能体托管区）\nHuman-owned footer.\n",
		project: "alpha",
		canApply: true,
		targetChanged: false,
		scientificallyVerified: false,
		sources: [{ ...ctx.sourceReceipt, currentHash: ctx.sourceReceipt.hash, changed: false, error: null }],
	});
	await expect(
		ctx.bridge.invoke(
			ctx.window,
			ctx.binding,
			"previewReview",
			{ ...ctx.reviewInput, id: ctx.betaProposal.id, expectedProposalHash: ctx.betaProposal.proposalHash },
			ctx.reviewSelection,
		),
	).rejects.toThrow("different project");
	await expect(
		ctx.bridge.invoke(
			ctx.window,
			ctx.binding,
			"previewReview",
			{ ...ctx.reviewInput, expectedProposalHash: "0".repeat(64) },
			ctx.reviewSelection,
		),
	).rejects.toThrow("changed");
	await expect(
		ctx.bridge.invoke(
			ctx.window,
			ctx.binding,
			"reviews",
			{ revision: ctx.overview.binding.revision, project: "beta" },
			ctx.reviewSelection,
		),
	).rejects.toThrow("Invalid plugin operation input");
	expect(await readFile(join(ctx.vault, ctx.alphaProposal.path), "utf8")).toBe(ctx.beforeWiki);
	expect(await readFile(join(ctx.pendingDirectory, `${ctx.alphaProposal.id}.json`), "utf8")).toBe(
		ctx.proposalBytes,
	);
}

async function verifyReviewChanges(ctx) {
	ctx.stage = "review-source-and-target-change";
	await writeFile(join(ctx.vault, ctx.sharedNote), `${ctx.sourceText}Changed source after review list.\n`);
	const changedSource = await ctx.bridge.invoke(
		ctx.window,
		ctx.binding,
		"previewReview",
		ctx.reviewInput,
		ctx.reviewSelection,
	);
	expect(changedSource).toMatchObject({
		canApply: false,
		sources: [{ changed: true, currentHash: sha256(`${ctx.sourceText}Changed source after review list.\n`) }],
	});
	await writeFile(join(ctx.vault, ctx.sharedNote), ctx.sourceText);
	await writeFile(join(ctx.vault, ctx.alphaProposal.path), `${ctx.beforeWiki}Edited human footer.\n`);
	expect(
		await ctx.bridge.invoke(ctx.window, ctx.binding, "previewReview", ctx.reviewInput, ctx.reviewSelection),
	).toMatchObject({ targetChanged: true, canApply: false });
	await writeFile(join(ctx.vault, ctx.alphaProposal.path), ctx.beforeWiki);
	await writeFile(
		join(ctx.pendingDirectory, `${ctx.alphaProposal.id}.json`),
		JSON.stringify({ ...ctx.alphaProposal, after: `${ctx.afterWiki}tampered` }),
	);
	await expect(
		ctx.bridge.invoke(ctx.window, ctx.binding, "previewReview", ctx.reviewInput, ctx.reviewSelection),
	).rejects.toThrow("changed");
	await writeFile(join(ctx.pendingDirectory, `${ctx.alphaProposal.id}.json`), ctx.proposalBytes);
	ctx.reviewScopes = {
		application: 0,
		alpha: 1,
		betaHidden: true,
		readOnlySession: true,
		proposalHash: ctx.alphaProposal.proposalHash,
		beforeAfterProtectedExact: true,
		sourceLineHashes: true,
		sourceChangeDetected: true,
		targetChangeDetected: true,
		staleAndTamperedProposalRejected: true,
		readOnlyPreviewStagesDidNotWrite: true,
	};
}

export async function prepareReviewProposals(ctx) {
	await createReviewProposals(ctx);
	await finalizeReviewProposals(ctx);
}

export async function verifyReviewPreview(ctx) {
	await verifyReviewList(ctx);
	await verifyReviewIsolation(ctx);
	await verifyReviewChanges(ctx);
}
