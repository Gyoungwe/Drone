/** Opt-in installed-artifact lifecycle acceptance; each test owns an isolated runtime and SDK session. */
import { expect, it } from "vitest";
import {
	blockReview,
	closeWritableSession,
	disableKnowledge,
	expectAbort,
	expectFreshReview,
	expectWorkersReleased,
	finishRevokedReview,
	reenableKnowledge,
	reviewCommand,
	trackLifecycle,
} from "./packed-knowledge-runtime/lifecycle.mjs";
import { withLifecycle } from "./packed-knowledge-runtime/lifecycle-fixture.mjs";

it.skipIf(!process.env.DRONE_KNOWLEDGE_TARBALL)(
	"caller cancel drops a late model reply and permits another review on the same SDK session",
	async () =>
		withLifecycle(async (ctx) => {
			const controller = new AbortController();
			const sessionId = ctx.writeSession.sessionId;
			const gate = await blockReview(ctx, () => reviewCommand(ctx, controller.signal));
			controller.abort(new Error("Lifecycle caller aborted"));
			expectAbort(await finishRevokedReview(ctx, gate));
			expect((await ctx.reviewWrite("modelReviewInfo", ctx.modelIdentity)).lastReview).toBeNull();
			await expectFreshReview(ctx);
			expect(ctx.writeSession.sessionId).toBe(sessionId);
		}),
	120000,
);

it.skipIf(!process.env.DRONE_KNOWLEDGE_TARBALL)(
	"session close drains the last native owner and ignores a late model reply",
	async () =>
		withLifecycle(async (ctx) => {
			// Remove the UI lease first: closing this SDK session must now release the shared owner.
			await ctx.bridge.revoke("knowledge-artifact", ctx.window.id);
			const sessionId = ctx.writeSession.sessionId;
			const gate = await blockReview(ctx, () => reviewCommand(ctx));
			const closing = closeWritableSession(ctx);
			trackLifecycle(ctx, closing);
			await finishRevokedReview(ctx, gate);
			await closing;
			expect(ctx.sessions.has(sessionId)).toBe(false);
			await expectWorkersReleased(ctx);
		}),
	120000,
);

it.skipIf(!process.env.DRONE_KNOWLEDGE_TARBALL)(
	"plugin disable rejects an in-flight review and releases its workers",
	async () =>
		withLifecycle(async (ctx) => {
			const gate = await blockReview(ctx, () => reviewCommand(ctx));
			const stopping = disableKnowledge(ctx);
			await finishRevokedReview(ctx, gate);
			await stopping;
			await expectWorkersReleased(ctx);
			await expect(
				ctx.bridge.invoke(ctx.window, ctx.binding, "modelReview", ctx.modelInput, ctx.writeSelection),
			).rejects.toThrow();
		}),
	120000,
);

it.skipIf(!process.env.DRONE_KNOWLEDGE_TARBALL)(
	"re-enable after in-flight disable creates a usable owner and audits a fresh SDK review",
	async () =>
		withLifecycle(async (ctx) => {
			const previousSessionId = ctx.writeSession.sessionId;
			const previousPids = ctx.processes.map((child) => child.pid);
			const gate = await blockReview(ctx, () => reviewCommand(ctx));
			const stopping = disableKnowledge(ctx);
			await finishRevokedReview(ctx, gate);
			await stopping;
			await expectWorkersReleased(ctx);
			await reenableKnowledge(ctx);
			expect(ctx.writeSession.sessionId).not.toBe(previousSessionId);
			expect(ctx.processes.some((child) => previousPids.includes(child.pid))).toBe(false);
			await expectFreshReview(ctx);
		}),
	120000,
);

it.skipIf(!process.env.DRONE_KNOWLEDGE_TARBALL)(
	"window caller cancel drops a late model reply and permits another review",
	async () =>
		withLifecycle(async (ctx) => {
			const requestId = "lifecycle-window-review";
			const gate = await blockReview(ctx, () =>
				ctx.bridge.invoke(
					ctx.window,
					ctx.binding,
					"modelReview",
					{ ...ctx.modelInput, autoApply: true },
					ctx.writeSelection,
					requestId,
				),
			);
			const canceling = ctx.bridge.cancel(ctx.window, ctx.binding, ctx.writeSelection, requestId);
			trackLifecycle(ctx, canceling);
			expectAbort(await finishRevokedReview(ctx, gate));
			expect(await canceling).toBe(true);
			expect((await ctx.reviewWrite("modelReviewInfo", ctx.modelIdentity)).lastReview).toBeNull();
			await expectFreshReview(ctx, () => ctx.reviewWrite("modelReview", ctx.modelInput));
		}),
	120000,
);
