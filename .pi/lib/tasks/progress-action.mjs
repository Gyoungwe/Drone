// @ts-nocheck
/** Compatibility artifact generated from packages/tasks/src/runtime/progress-action.ts; packaged resources share the .pi runtime bridge. */
import { remainingExplanation } from "./remaining.mjs";
import { explainReason } from "./workbench.mjs";
function createTaskProgression(journal, { askAuthorization, checkBinding, continueAuthorized, prepareRemaining, send, getGeneration = () => 0 }) {
  const pending = /* @__PURE__ */ new Map();
  return async (input, ctx) => {
    const key = `${journal.scope()}:${input.taskId}:${input.revision}`;
    if (pending.has(key)) return pending.get(key);
    const run = (async () => {
      const generation = getGeneration();
      const scope = journal.scope(), binding = await checkBinding();
      const validate = async () => {
        const view = journal.view(), task2 = view.tasks.find((t) => t.id === input.taskId);
        if (!task2 || view.revision !== input.revision || journal.scope() !== scope || getGeneration() !== generation || await checkBinding() !== binding || ctx.signal?.aborted || ctx.isIdle && !ctx.isIdle())
          throw new Error("\u4EFB\u52A1\u7684\u60C5\u51B5\u521A\u53D1\u751F\u4E86\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u770B\u4E00\u4E0B\u6700\u65B0\u72B6\u6001\u518D\u64CD\u4F5C\u3002");
        if (["completed", "cancelled", "archived"].includes(task2.state))
          throw new Error("\u8FD9\u4E2A\u4EFB\u52A1\u5DF2\u7ECF\u7ED3\u675F\u4E86\uFF0C\u53BB\u770B\u770B\u4EA4\u4ED8\u7684\u7ED3\u679C\u5427\uFF1B\u60F3\u518D\u505A\u7C7B\u4F3C\u7684\u4E8B\u5C31\u91CD\u65B0\u63CF\u8FF0\u4E00\u6B21\u9700\u6C42\u3002");
        return task2;
      };
      const task = await validate();
      if (!ctx.ui?.select) return;
      if (!task.executionConsent && task.milestones.length) {
        if (await askAuthorization({ ...input, action: "authorize-task" }, ctx)) {
          send("\u4F60\u5DF2\u786E\u8BA4\uFF0C\u63A5\u7740\u5B8C\u6210\u5269\u4E0B\u7684\u4EA4\u4ED8\u3002");
          continueAuthorized(ctx);
        }
        return;
      }
      const action = task.actions.find((a) => a.state === "pending");
      if (action?.kind === "authorization") {
        if (await askAuthorization({ ...input, action: "ask-authorization", actionId: action.id }, ctx)) {
          journal.command({ taskId: task.id, revision: journal.view().revision, action: "select" });
          send("\u4F60\u5DF2\u540C\u610F\u8FD9\u9879\u65B0\u589E\u7684\u5185\u5BB9\uFF0C\u7EE7\u7EED\u5F80\u4E0B\u505A\u3002");
          continueAuthorized(ctx);
        }
        return;
      }
      const report = `ask_user \xB7 \u63A8\u8FDB\u5269\u4F59\u4E8B\u9879

${remainingExplanation(task)}

${task.reason ? `\u76EE\u524D\u7684\u60C5\u51B5\uFF1A${explainReason(task.reason)}
` : ""}\u53EA\u5904\u7406\u8FD9\u4E2A\u4EFB\u52A1\u5269\u4E0B\u7684\u90E8\u5206\uFF1B\u5DF2\u7ECF\u505A\u5B8C\u7684\u4E0D\u4F1A\u91CD\u505A\uFF0C\u5B8C\u6210\u6807\u51C6\u4E5F\u4E0D\u4F1A\u53D8\u3002`;
      const uncertain = task.operations.some((o) => ["started", "unknown"].includes(o.state));
      const file = action && ["file", "download"].includes(action.kind) && !uncertain;
      const review = action?.kind === "review" && task.milestones.find((m) => m.id === action.milestoneId)?.acceptance.kind === "human_review" && !uncertain;
      const proceed = file ? "\u63D0\u4EA4\u6240\u9700\u6587\u4EF6" : review ? "\u6211\u5DF2\u4EB2\u81EA\u770B\u8FC7\u8FD9\u4E9B\u5185\u5BB9" : uncertain ? "\u5148\u6838\u5BF9\u4E0A\u6B21\u6CA1\u7ED3\u679C\u7684\u64CD\u4F5C" : "\u63A5\u7740\u505A\u5B8C\u5269\u4E0B\u7684";
      const unsupportedReview = action?.kind === "review" && !review || ["binding-changed", "total-budget"].includes(task.reason);
      const choices = unsupportedReview ? ["\u6682\u4E0D\u5904\u7406", "\u4EC5\u6838\u5BF9\u5DF2\u6709\u4EA7\u7269"] : ["\u6682\u4E0D\u5904\u7406", "\u4EC5\u6838\u5BF9\u5DF2\u6709\u4EA7\u7269", proceed];
      const selected = await ctx.ui.select(report, choices, { signal: ctx.signal });
      if (!choices.includes(selected) || selected === "\u6682\u4E0D\u5904\u7406" || ctx.signal?.aborted) return;
      await validate();
      let path;
      if (file && selected === proceed) {
        path = await ctx.ui.input(
          `ask_user \xB7 \u63D0\u4EA4\u6587\u4EF6

${action.title}
${action.reason}
\u8BF7\u628A\u6587\u4EF6\u7684\u5B8C\u6574\u8DEF\u5F84\u586B\u5728\u4E0B\u9762\u3002\u7A0B\u5E8F\u4F1A\u81EA\u5DF1\u6838\u5BF9\u8FD9\u4EFD\u6587\u4EF6\u5BF9\u4E0D\u5BF9\uFF0C\u4E0D\u4F1A\u76F2\u76EE\u91C7\u7528\u3002`,
          "\u5B8C\u6574\u6587\u4EF6\u8DEF\u5F84",
          { signal: ctx.signal }
        );
        if (!path?.trim() || ctx.signal?.aborted) return;
        await validate();
      }
      journal.command({ ...input, action: "select" });
      const command = (extra) => ({ taskId: task.id, revision: journal.view().revision, ...extra });
      if (path) {
        await journal.acceptFile(
          command({ action: "file", actionId: action.id, path: path.trim() }),
          ctx.cwd
        );
        journal.command(command({ action: "acknowledge", actionId: action.id }));
      }
      if (review && selected === proceed)
        journal.command(command({ action: "acknowledge", actionId: action.id }));
      await journal.reconcile(ctx.cwd);
      if (journal.scope() !== scope || journal.snapshot()?.id !== task.id || getGeneration() !== generation || ctx.signal?.aborted || await checkBinding() !== binding)
        return;
      send();
      if (selected === "\u4EC5\u6838\u5BF9\u5DF2\u6709\u4EA7\u7269" || uncertain || journal.snapshot()?.state === "completed") return;
      if (journal.authorization()) continueAuthorized(ctx);
      else if (!task.milestones.length) await prepareRemaining();
    })();
    pending.set(key, run);
    try {
      return await run;
    } finally {
      pending.delete(key);
    }
  };
}
export {
  createTaskProgression
};
