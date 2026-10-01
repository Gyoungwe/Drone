import { explainTaskReason } from "@drone/shared";
import { type RemainingTask, remainingExplanation } from "./remaining";

/**
 * Host-owned task view used by the progression policy.  The policy only
 * coordinates an already-authorized task; it never grants consent itself.
 */
export interface TaskProgressionTask extends RemainingTask {
	id?: string;
	state?: string;
	reason?: unknown;
	executionConsent?: unknown;
	acceptanceSummary?: unknown;
}

export interface TaskProgressionView {
	revision: number;
	tasks: readonly TaskProgressionTask[];
}

export interface TaskProgressionJournal {
	scope(): string;
	view(): TaskProgressionView;
	snapshot?(): TaskProgressionTask | null | undefined;
	command(command: Record<string, unknown>): unknown;
	acceptFile(command: Record<string, unknown>, cwd?: string): Promise<unknown>;
	reconcile(cwd?: string): Promise<unknown>;
	authorization?(): unknown;
}

export interface TaskProgressionUi {
	select?: (
		message: string,
		choices: readonly string[],
		options?: { signal?: AbortSignal },
	) => Promise<string | undefined>;
	input?: (
		message: string,
		placeholder?: string,
		options?: { signal?: AbortSignal },
	) => Promise<string | undefined>;
}

export interface TaskProgressionContext {
	cwd?: string;
	signal?: AbortSignal;
	isIdle?: () => boolean;
	ui?: TaskProgressionUi;
}

export interface TaskProgressionInput {
	taskId: string;
	revision: number;
	action?: string;
	[key: string]: unknown;
}

export interface TaskProgressionOptions {
	taskJournal: TaskProgressionJournal;
	taskAuthorization: (
		input: TaskProgressionInput & Record<string, unknown>,
		ctx: TaskProgressionContext,
	) => Promise<boolean>;
	checkBinding: () => Promise<unknown>;
	continueAuthorized: (ctx: TaskProgressionContext) => unknown;
	prepareRemaining?: () => Promise<unknown>;
	send?: (content?: string) => unknown;
	getGeneration?: () => number;
	/** Runtime extension hook; defaults to the shared host reason vocabulary. */
	explainReason?: (reason: unknown) => string | null | undefined;
	/** Runtime extension hook for acceptance-specific pending hints. */
	explainRemaining?: (task: RemainingTask) => string;
}

const TERMINAL_STATES = new Set(["completed", "cancelled", "archived"]);

/**
 * Native ask_user progression policy.
 *
 * Every readback is guarded by the original scope, revision, binding and
 * generation.  A changed context therefore cancels the old continuation
 * before it can send a status message or schedule more work.
 */
export function createTaskProgression({
	taskJournal,
	taskAuthorization,
	checkBinding,
	continueAuthorized,
	prepareRemaining = async () => {},
	send = () => {},
	getGeneration = () => 0,
	explainReason = (reason) => (reason ? explainTaskReason(String(reason)) : null),
	explainRemaining = remainingExplanation,
}: TaskProgressionOptions) {
	const pending = new Map<string, Promise<void>>();
	return async (input: TaskProgressionInput, ctx: TaskProgressionContext): Promise<void> => {
		const key = `${taskJournal.scope()}:${input.taskId}:${input.revision}`;
		const existing = pending.get(key);
		if (existing) return existing;
		const run = (async () => {
			const generation = getGeneration();
			const scope = taskJournal.scope();
			const binding = await checkBinding();
			const validate = async (): Promise<TaskProgressionTask> => {
				const view = taskJournal.view();
				const task = view.tasks.find((candidate) => candidate.id === input.taskId);
				if (
					!task ||
					view.revision !== input.revision ||
					taskJournal.scope() !== scope ||
					getGeneration() !== generation ||
					(await checkBinding()) !== binding ||
					ctx.signal?.aborted ||
					(ctx.isIdle && !ctx.isIdle())
				)
					throw new Error("任务的情况刚发生了变化，请刷新看一下最新状态再操作。");
				if (TERMINAL_STATES.has(task.state || ""))
					throw new Error("这个任务已经结束了，去看看交付的结果吧；想再做类似的事就重新描述一次需求。");
				return task;
			};
			const task = await validate();
			if (!ctx.ui?.select) return;
			if (!task.executionConsent && (task.milestones || []).length) {
				if (await taskAuthorization({ ...input, action: "authorize-task" }, ctx)) {
					send("你已确认，接着完成剩下的交付。");
					continueAuthorized(ctx);
				}
				return;
			}
			const action = (task.actions || []).find((candidate) => candidate.state === "pending");
			if (action?.kind === "authorization") {
				if (await taskAuthorization({ ...input, action: "ask-authorization", actionId: action.id }, ctx)) {
					taskJournal.command({ taskId: task.id, revision: taskJournal.view().revision, action: "select" });
					send("你已同意这项新增的内容，继续往下做。");
					continueAuthorized(ctx);
				}
				return;
			}
			const report = `ask_user · 推进剩余事项\n\n${explainRemaining(task)}\n\n${task.reason ? `目前的情况：${explainReason(task.reason)}\n` : ""}只处理这个任务剩下的部分；已经做完的不会重做，完成标准也不会变。`;
			const uncertain = (task.operations || []).some((operation) =>
				["started", "unknown"].includes(String(operation.state)),
			);
			const file = action && ["file", "download"].includes(String(action.kind)) && !uncertain;
			const review =
				action?.kind === "review" &&
				(task.milestones || []).find((milestone) => milestone.id === action.milestoneId)?.acceptance?.kind ===
					"human_review" &&
				!uncertain;
			const proceed = file
				? "提交所需文件"
				: review
					? "我已亲自看过这些内容"
					: uncertain
						? "先核对上次没结果的操作"
						: "接着做完剩下的";
			const unsupportedReview =
				(action?.kind === "review" && !review) ||
				["binding-changed", "total-budget"].includes(String(task.reason));
			const choices = unsupportedReview
				? ["暂不处理", "仅核对已有产物"]
				: ["暂不处理", "仅核对已有产物", proceed];
			const selected = await ctx.ui.select(report, choices, { signal: ctx.signal });
			if (!choices.includes(selected || "") || selected === "暂不处理" || ctx.signal?.aborted) return;
			await validate();
			let path: string | undefined;
			if (file && selected === proceed) {
				path = await ctx.ui.input?.(
					`ask_user · 提交文件\n\n${action?.title}\n${action?.reason}\n请把文件的完整路径填在下面。程序会自己核对这份文件对不对，不会盲目采用。`,
					"完整文件路径",
					{ signal: ctx.signal },
				);
				if (!path?.trim() || ctx.signal?.aborted) return;
				await validate();
			}
			taskJournal.command({ ...input, action: "select" });
			const command = (extra: Record<string, unknown>) => ({
				taskId: task.id,
				revision: taskJournal.view().revision,
				...extra,
			});
			if (path) {
				await taskJournal.acceptFile(
					command({ action: "file", actionId: action?.id, path: path.trim() }),
					ctx.cwd,
				);
				taskJournal.command(command({ action: "acknowledge", actionId: action?.id }));
			}
			if (review && selected === proceed)
				taskJournal.command(command({ action: "acknowledge", actionId: action?.id }));
			await taskJournal.reconcile(ctx.cwd);
			if (
				taskJournal.scope() !== scope ||
				taskJournal.snapshot?.()?.id !== task.id ||
				getGeneration() !== generation ||
				ctx.signal?.aborted ||
				(await checkBinding()) !== binding
			)
				return;
			send();
			if (selected === "仅核对已有产物" || uncertain || taskJournal.snapshot?.()?.state === "completed")
				return;
			if (taskJournal.authorization?.()) continueAuthorized(ctx);
			else if (!(task.milestones || []).length) await prepareRemaining();
		})();
		pending.set(key, run);
		try {
			await run;
		} finally {
			pending.delete(key);
		}
	};
}
