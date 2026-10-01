import type { WikiModelReviewResult } from "@drone/shared";
import { describe, expect, it, vi } from "vitest";
import { type KnowledgeSessionContext, KnowledgeSessionService } from "./knowledge-session";

const result = {} as WikiModelReviewResult;
const identity = {};
const input = {
	cwd: "/fixture",
	sessionId: "session-1",
	token: "candidate-token",
	requestId: "123e4567-e89b-12d3-a456-426614174000",
	acknowledged: true as const,
	autoApply: false,
};

function context(overrides: Partial<KnowledgeSessionContext> = {}): KnowledgeSessionContext {
	return {
		sessionId: "session-1",
		identity,
		cwd: "/fixture",
		readOnly: false,
		streaming: false,
		hasModel: true,
		projectTrusted: true,
		...overrides,
	};
}

describe("KnowledgeSessionService", () => {
	it("owns setup and resume prompts behind a session-bound port", async () => {
		const prompt = vi.fn(async () => undefined);
		const service = new KnowledgeSessionService({
			getContext: () => context(),
			evaluateReview: async () => result,
			prompt,
		});

		await service.startSetup({ sessionId: "session-1", path: "/fixture/Vault" });
		await service.resumeCheck("session-1");

		expect(prompt).toHaveBeenNthCalledWith(1, "session-1", '/obsidian-setup {"vaultPath":"/fixture/Vault"}');
		expect(prompt).toHaveBeenNthCalledWith(
			2,
			"session-1",
			"请继续完成上一任务的知识库检查：重新准备导航，按需阅读 Wiki、检索并阅读实际引用来源，然后发布回答。不要把界面阅读当作模型已经阅读，也不要绕过失败的检查。",
		);
	});

	it("cancels an in-flight review through the explicit service port", async () => {
		let resolveReview!: (value: WikiModelReviewResult) => void;
		let signal: AbortSignal | undefined;
		const review = new Promise<WikiModelReviewResult>((resolve) => {
			resolveReview = resolve;
		});
		const service = new KnowledgeSessionService({
			getContext: () => context(),
			evaluateReview: async (_input, control) => {
				signal = control.signal;
				return review;
			},
			prompt: async () => undefined,
		});

		const pending = service.reviewWithModel(input);
		await vi.waitFor(() => expect(signal).toBeDefined());
		await service.cancelModelReview({ sessionId: input.sessionId, requestId: input.requestId });
		expect(signal?.aborted).toBe(true);
		resolveReview(result);
		await expect(pending).resolves.toBe(result);
	});

	it.each([{ readOnly: true }, { streaming: true }])(
		"rejects setup while a session is busy or read-only: %o",
		async (state) => {
			const service = new KnowledgeSessionService({
				getContext: () => context(state),
				evaluateReview: async () => result,
				prompt: async () => undefined,
			});
			await expect(service.startSetup({ sessionId: "session-1" })).rejects.toThrow("current task");
		},
	);
});
