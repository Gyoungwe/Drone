import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { expect, vi } from "vitest";
import { SessionEngine } from "../../src/session-engine/engine";
import { packageChildren, sha256 } from "./helpers.mjs";
import { createWritableSession } from "./sdk-sessions.mjs";

export function reviewCommand(ctx, signal = new AbortController().signal) {
	const session = ctx.writeSession;
	const { revision: _revision, ...input } = ctx.modelInput;
	return new SessionEngine().command(session, "knowledge-review-model", JSON.stringify(input), signal, () => {
		if (ctx.sessions.get(session.sessionId)?.session !== session)
			throw new Error("Lifecycle command session was revoked");
	});
}

export async function blockReview(ctx, invoke) {
	const reply = Promise.withResolvers();
	ctx.modelReply = fauxAssistantMessage(fauxToolCall("structured_result", ctx.advice));
	ctx.modelGate = { reply };
	// Ignore abort here so the host must fence a valid late reply, even from a misbehaving provider.
	ctx.complete = vi.spyOn(ctx.modelRuntime, "completeSimple").mockImplementationOnce(() => reply.promise);
	const settled = trackLifecycle(ctx, invoke());
	await vi.waitFor(() => expect(ctx.complete).toHaveBeenCalledOnce());
	const signal = ctx.complete.mock.calls[0][2].signal;
	expect(signal.aborted).toBe(false);
	return { signal, settled, reply };
}

export async function expectNoReviewWrites(ctx) {
	const entries = await readdir(ctx.state, { recursive: true });
	const audits = entries.filter((path) => path.includes("wiki-review/model-audits/"));
	expect(audits, "no late audit").toEqual([]);
	expect(
		ctx.capabilityScopes.filter((call) => call.name === "files.writeText"),
		"no Wiki write capability was called",
	).toEqual([]);
	expect(sha256(await readFile(join(ctx.vault, ctx.modelProposal.path)))).toBe(sha256(ctx.beforeWiki));
	expect(sha256(await readFile(join(ctx.pendingDirectory, `${ctx.modelProposal.id}.json`)))).toBe(
		sha256(ctx.pendingBytes),
	);
}

export async function finishRevokedReview(ctx, gate) {
	await vi.waitFor(() => expect(gate.signal.aborted).toBe(true));
	await expectNoReviewWrites(ctx);
	gate.reply.resolve(ctx.modelReply);
	const result = await gate.settled;
	expect(result.status, "revoked review must reject without a result").toBe("rejected");
	expect(result.reason).toBeInstanceOf(Error);
	await expectNoReviewWrites(ctx);
	return result.reason;
}

export async function expectFreshReview(ctx, invoke = () => reviewCommand(ctx)) {
	ctx.modelInput.autoApply = false;
	ctx.faux.setResponses([fauxAssistantMessage(fauxToolCall("structured_result", ctx.advice))]);
	await invoke();
	const info = await ctx.reviewWrite("modelReviewInfo", ctx.modelIdentity);
	expect(info.lastReview).toMatchObject({
		proposalId: ctx.modelProposal.id,
		proposalHash: ctx.modelProposal.proposalHash,
		verdict: "approve",
		applied: false,
		canAutoApply: true,
		humanReviewed: false,
		scientificallyVerified: false,
	});
	const directory = join(ctx.state, ctx.overview.binding.vaultId, "wiki-review/model-audits");
	const latest = JSON.parse(await readFile(join(directory, `${ctx.modelProposal.id}.latest.json`), "utf8"));
	expect(latest).toEqual({
		auditId: info.lastReview.auditId,
		proposalHash: ctx.modelProposal.proposalHash,
	});
	const audit = JSON.parse(await readFile(join(directory, `${latest.auditId}.json`), "utf8"));
	expect(audit).toEqual(info.lastReview);
	expect(sha256(await readFile(join(ctx.vault, ctx.modelProposal.path)))).toBe(sha256(ctx.beforeWiki));
}

export async function closeWritableSession(ctx) {
	const session = ctx.writeSession;
	ctx.sessions.revoke(session.sessionId);
	await new SessionEngine().dispose(session);
	ctx.sessions.delete(session.sessionId);
	ctx.writeSession = undefined;
	await ctx.writeBootstrap.dispose();
	ctx.writeBootstrap = undefined;
}

export async function expectWorkersReleased(ctx) {
	expect(await packageChildren(ctx.packageRoot)).toEqual([]);
	for (const namespace of await readdir(ctx.leases))
		expect(await readdir(join(ctx.leases, namespace))).toEqual([]);
}

export function disableKnowledge(ctx) {
	ctx.disabledSources.add("knowledge-artifact");
	const stopping = ctx.bridge.revoke("knowledge-artifact");
	trackLifecycle(ctx, stopping);
	return stopping;
}

export function trackLifecycle(ctx, pending) {
	const settled = Promise.allSettled([pending]).then(([result]) => result);
	ctx.lifecyclePending.push(settled);
	return settled;
}

export async function reenableKnowledge(ctx) {
	await closeWritableSession(ctx);
	ctx.disabledSources.delete("knowledge-artifact");
	ctx.binding = await ctx.bridge.bind("knowledge-artifact", ctx.window);
	ctx.application = ctx.bridge.selectSession(ctx.window, null);
	await ctx.bridge.invoke(ctx.window, ctx.binding, "overview", null, ctx.application);
	ctx.processes = await packageChildren(ctx.packageRoot);
	expect(ctx.processes).toHaveLength(2);
	await createWritableSession(ctx);
}

export function expectAbort(error) {
	const messages = errorMessages(error);
	expect(messages.some((message) => /abort|cancel/i.test(message))).toBe(true);
}

function errorMessages(error) {
	return error instanceof AggregateError ? error.errors.flatMap(errorMessages) : [error.message];
}
