import type { WikiModelReviewInput, WikiModelReviewResult } from "@drone/shared";
import { canonicalProjectId } from "../project-id";

/** Read-only session facts needed by the knowledge management boundary. */
export interface KnowledgeSessionContext {
	sessionId: string;
	/** Stable token for the lifetime of one open session. */
	identity: object;
	cwd: string;
	readOnly: boolean;
	streaming: boolean;
	hasModel: boolean;
	projectTrusted: boolean;
}

export interface KnowledgeReviewControl {
	signal: AbortSignal;
	check(): Promise<void>;
}

export interface KnowledgeSessionServiceDependencies {
	getContext(sessionId: string): KnowledgeSessionContext | undefined;
	evaluateReview(
		input: WikiModelReviewInput,
		control: KnowledgeReviewControl,
	): Promise<WikiModelReviewResult>;
	prompt(sessionId: string, text: string): Promise<unknown>;
}

export interface KnowledgeSessionServicePort {
	reviewWithModel(input: WikiModelReviewInput): Promise<WikiModelReviewResult>;
	cancelModelReview(input: { sessionId: string; requestId: string }): Promise<void>;
	startSetup(input: { sessionId: string; path?: string }): Promise<void>;
	resumeCheck(sessionId: string): Promise<void>;
	disposeSession(sessionId: string): void;
}

/** Session-bound knowledge actions kept outside the compatibility façade. */
export class KnowledgeSessionService implements KnowledgeSessionServicePort {
	private readonly reviews = new Map<string, { sessionId: string; controller: AbortController }>();

	constructor(private readonly deps: KnowledgeSessionServiceDependencies) {}

	async reviewWithModel(input: WikiModelReviewInput): Promise<WikiModelReviewResult> {
		if (!input || !/^[0-9a-f-]{36}$/i.test(input.requestId))
			throw new Error("Invalid model review request id");
		const initial = this.requireContext(input.sessionId);
		if (initial.readOnly || canonicalProjectId(initial.cwd) !== canonicalProjectId(input.cwd))
			throw new Error("Open the candidate's originating project in a writable session");
		if (initial.streaming) throw new Error("Wait for the current conversation to finish before model review");
		if (this.reviews.has(input.requestId) || this.reviews.size >= 2)
			throw new Error("Model review is already running; wait or cancel it");
		if (!initial.hasModel) throw new Error("Select a model before review");

		const controller = new AbortController();
		const check = async (): Promise<void> => {
			controller.signal.throwIfAborted();
			const current = this.deps.getContext(input.sessionId);
			if (
				!current ||
				current.identity !== initial.identity ||
				canonicalProjectId(current.cwd) !== canonicalProjectId(input.cwd) ||
				!current.projectTrusted
			)
				throw new Error("Session closed or project is not trusted for model review");
		};
		this.reviews.set(input.requestId, { sessionId: input.sessionId, controller });
		const timer = setTimeout(() => controller.abort(), 120_000);
		try {
			await check();
			return await this.deps.evaluateReview(input, { signal: controller.signal, check });
		} finally {
			clearTimeout(timer);
			this.reviews.delete(input.requestId);
		}
	}

	async cancelModelReview({ sessionId, requestId }: { sessionId: string; requestId: string }): Promise<void> {
		const run = this.reviews.get(requestId);
		if (run?.sessionId === sessionId) run.controller.abort();
	}

	async startSetup(input: { sessionId: string; path?: string }): Promise<void> {
		const context = this.requireContext(input.sessionId);
		if (context.readOnly || context.streaming)
			throw new Error("Wait for the current task to finish before setup");
		if (input.path && (typeof input.path !== "string" || input.path.length > 4096))
			throw new Error("Invalid Vault path");
		const args = input.path ? JSON.stringify({ vaultPath: input.path }) : "";
		await this.deps.prompt(input.sessionId, `/obsidian-setup ${args}`);
	}

	async resumeCheck(sessionId: string): Promise<void> {
		const context = this.requireContext(sessionId);
		if (context.readOnly || context.streaming) throw new Error("Wait for the current task to finish");
		await this.deps.prompt(
			sessionId,
			"请继续完成上一任务的知识库检查：重新准备导航，按需阅读 Wiki、检索并阅读实际引用来源，然后发布回答。不要把界面阅读当作模型已经阅读，也不要绕过失败的检查。",
		);
	}

	disposeSession(sessionId: string): void {
		for (const run of this.reviews.values()) if (run.sessionId === sessionId) run.controller.abort();
	}

	private requireContext(sessionId: string): KnowledgeSessionContext {
		const context = this.deps.getContext(sessionId);
		if (!context) throw new Error(`Session not found: ${sessionId}`);
		return context;
	}
}
