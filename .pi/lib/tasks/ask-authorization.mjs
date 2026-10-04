// @ts-nocheck
/** Compatibility artifact generated from packages/tasks/src/runtime/ask-authorization.ts; packaged resources share the .pi runtime bridge. */
import { describeAcceptance, effectiveAcceptance } from "./acceptance.mjs";
import { hasTaskConsent } from "./consent.mjs";
const TASK_TOTAL_CALLS = 192;
function computeAuthorizationDetails(compute) {
  if (!compute || typeof compute !== "object") return null;
  const hosts = Array.isArray(compute.hosts) && compute.hosts.every((host) => typeof host === "string") ? compute.hosts : null;
  const remoteRead = Array.isArray(compute.remoteRead) && compute.remoteRead.every((path) => typeof path === "string") ? compute.remoteRead : null;
  const remoteWrite = Array.isArray(compute.remoteWrite) && compute.remoteWrite.every((path) => typeof path === "string") ? compute.remoteWrite : null;
  const budget = compute.budget;
  if (!hosts || !remoteRead || !remoteWrite || !budget || typeof budget !== "object") return null;
  if (![budget.maxCoreHours, budget.maxWalltimeMinutes, budget.maxConcurrentJobs, budget.maxDiskGb].every(
    (value) => typeof value === "number" && Number.isFinite(value) && value >= 0
  ) || ![budget.maxWalltimeMinutes, budget.maxConcurrentJobs, budget.maxDiskGb].every(
    (value) => typeof value === "number" && Number.isInteger(value) && value > 0
  ))
    return null;
  return `\u8BA1\u7B97\u8303\u56F4\uFF1A\u4E3B\u673A ${hosts.join(", ")}\uFF1B\u8FDC\u7A0B\u8BFB\u53D6 ${remoteRead.join(", ") || "\u672A\u58F0\u660E"}\uFF1B\u8FDC\u7A0B\u5199\u5165 ${remoteWrite.join(", ") || "\u672A\u58F0\u660E"}\uFF1B\u6700\u591A ${budget.maxCoreHours} \u6838\u65F6\u3001\u5355\u4F5C\u4E1A ${budget.maxWalltimeMinutes} \u5206\u949F\u3001${budget.maxConcurrentJobs} \u4E2A\u5E76\u53D1\u4F5C\u4E1A\u3001${budget.maxDiskGb} GiB\u3002${compute.agentCode === true ? "\u5141\u8BB8\u6C99\u7BB1\u4E2D\u7684 Agent \u6A21\u5757\u3002" : "\u4E0D\u5141\u8BB8 Agent \u7F16\u5199\u6A21\u5757\u3002"}`;
}
function createTaskAuthorization(journal, checkBinding = async () => null) {
  const pending = /* @__PURE__ */ new Map();
  return async function ask(input, ctx, signal = ctx.signal) {
    const view = journal.view();
    const task = view.tasks.find((t) => t.id === input.taskId);
    if (!task || view.revision !== input.revision)
      throw new Error("Task changed. Refresh before requesting authorization.");
    if (["completed", "cancelled", "archived"].includes(task.state))
      throw new Error("Task is no longer awaiting authorization.");
    if (input.action === "authorize-task" && hasTaskConsent(task, TASK_TOTAL_CALLS) && (await checkBinding() ?? null) === (task.binding ?? null))
      return true;
    const action = input.action === "ask-authorization" ? task.actions.find(
      (a) => a.id === input.actionId && ["authorization", "rebind"].includes(a.kind) && a.state === "pending"
    ) : null;
    if (input.action === "ask-authorization" && !action)
      throw new Error("Authorization action is no longer pending.");
    if (!["authorize-task", "approve-plan", "next-stage", "ask-authorization", "confirm-outcome"].includes(
      input.action
    ))
      throw new Error("Unknown authorization request.");
    const scope = journal.scope();
    const key = `${scope}:${task.id}:${view.revision}:${input.action}:${input.actionId || input.operationId || ""}`;
    if (pending.has(key)) return pending.get(key);
    const operation = (async () => {
      if (!ctx.ui?.select || signal?.aborted) return false;
      const binding = await checkBinding();
      const allow = "\u540C\u610F\u672C\u6B21\u8BF7\u6C42", deny = "\u6682\u4E0D\u6388\u6743";
      const rebind = action?.kind === "rebind" ? action : null;
      const title = input.action === "next-stage" ? "ask_user \xB7 \u7EE7\u7EED\u4E0B\u4E00\u9636\u6BB5\uFF1F" : input.action === "confirm-outcome" ? "ask_user \xB7 \u786E\u8BA4\u8FD9\u4E00\u6B65\u7684\u7ED3\u679C" : rebind ? "ask_user \xB7 \u66F4\u6362\u8FD9\u4E00\u9879\u5BF9\u5E94\u7684\u6587\u732E\uFF1F" : "ask_user \xB7 \u5F00\u59CB\u6267\u884C\u8FD9\u4E2A\u4EFB\u52A1\uFF1F";
      const acceptanceLabel = (m) => describeAcceptance(effectiveAcceptance(m));
      const rebindTarget = rebind ? task.milestones.find((m) => m.id === rebind.milestoneId) : null;
      const computeDetails = computeAuthorizationDetails(task.compute);
      const details = [
        `\u8981\u505A\u7684\u4E8B\uFF1A${task.goal}`,
        rebind ? [
          `${action.title}
${action.reason}`,
          `\u8981\u6539\u7684\u4EA4\u4ED8\u9879\uFF1A${rebindTarget?.title || rebind.milestoneId}`,
          `\u539F\u6765\u7684 DOI\uFF1A${rebind.previous || "\uFF08\u8BA1\u5212\u91CC\u6CA1\u6709\u5199\u6B7B\uFF0C\u4E4B\u524D\u4E5F\u6CA1\u7ED1\u5B9A\uFF09"}`,
          `\u6362\u6210\u7684 DOI\uFF1A${rebind.expected?.doi}`,
          "\u540C\u610F\u540E\uFF1A\u8FD9\u4E00\u9879\u6539\u6309\u65B0 DOI \u6838\u5BF9\uFF0C\u65E7\u7684\u6838\u5BF9\u7ED3\u679C\u4F5C\u5E9F\uFF1B\u65B0 DOI \u4E0E\u8BA1\u5212\u91CC\u70B9\u540D\u7684\u6587\u732E\u540C\u7B49\u5BF9\u5F85\uFF08\u5199\u5165\u65F6\u4E0D\u518D\u53E6\u5916\u5F39\u7A97\uFF09\u3002\u5DF2\u7ECF\u5199\u8FDB Zotero \u7684\u65E7\u6761\u76EE\u4E0D\u4F1A\u88AB\u5220\u9664\u6216\u79FB\u52A8\uFF0C\u9700\u8981\u7684\u8BDD\u8BF7\u4F60\u81EA\u5DF1\u6574\u7406\u3002"
        ].join("\n") : action ? `${action.title}
${action.reason}` : task.authorizationSummary || task.goal,
        (task.writeRoots || []).length ? `\u4F1A\u5199\u5165\u8FD9\u4E9B\u6587\u4EF6\u5939\uFF08\u5305\u62EC\u5B50\u6587\u4EF6\u5939\uFF09\uFF1A
${task.writeRoots.map((r) => `- ${r}`).join("\n")}` : "\u4E0D\u4F1A\u65B0\u589E\u53EF\u5199\u6587\u4EF6\u5939\uFF1B\u6539\u52A8\u6587\u4EF6\u4ECD\u6309\u4F60\u73B0\u6709\u7684\u6743\u9650\u8BBE\u7F6E\u9010\u9879\u786E\u8BA4\u3002",
        computeDetails || "\u4E0D\u5305\u542B\u8FDC\u7A0B\u8BA1\u7B97\u8303\u56F4\uFF1B\u8BA1\u7B97\u5DE5\u5177\u53EA\u80FD\u505A\u53EA\u8BFB\u63A2\u6D4B\u3002",
        `\u505A\u5B8C\u7684\u6807\u51C6\uFF1A
${task.milestones.map((m) => `- ${m.title}\uFF1A${acceptanceLabel(m)}`).join("\n")}`,
        input.action === "confirm-outcome" ? "\u8FD9\u91CC\u53EA\u8BB0\u5F55\u4F60\u5DF2\u6838\u5BF9\u8FC7\u8FD9\u4E00\u6B65\u7684\u7ED3\u679C\uFF0C\u4E0D\u4F1A\u91CD\u65B0\u6267\u884C\u5B83\u3002" : rebind ? "\u8FD9\u53EA\u6539\u53D8\u8FD9\u4E00\u9879\u6309\u54EA\u7BC7\u6587\u732E\u6838\u5BF9\uFF0C\u4E0D\u6269\u5927\u53EF\u5199\u76EE\u5F55\u6216\u5176\u5B83\u6743\u9650\u3002" : "\u540C\u610F\u540E\u5B83\u4F1A\u81EA\u5DF1\u505A\u5B8C\u8FD9\u4E9B\u4E8B\uFF0C\u4E2D\u9014\u4E0D\u518D\u53CD\u590D\u95EE\u4F60\uFF1B\u505A\u522B\u7684\u3001\u5220\u4E1C\u897F\u6216\u78B0\u654F\u611F\u6587\u4EF6\u4ECD\u4F1A\u5148\u5F81\u5F97\u4F60\u540C\u610F\u3002\u4F60\u968F\u65F6\u53EF\u4EE5\u505C\u6B62\u3002",
        "\u4E0D\u60F3\u7EE7\u7EED\u5C31\u9009\u201C\u6682\u4E0D\u6388\u6743\u201D\u6216\u76F4\u63A5\u5173\u6389\uFF0C\u90FD\u4E0D\u4F1A\u5F00\u59CB\u6267\u884C\u3002"
      ].join("\n\n");
      const selected = await ctx.ui.select(`${title}

${details}`, [deny, allow], { signal });
      if (selected !== allow || signal?.aborted) return false;
      if (journal.scope() !== scope || await checkBinding() !== binding)
        throw new Error("Task context or knowledge binding changed; ask again in the current context.");
      journal.command({ ...input, action: action ? "acknowledge" : input.action });
      return true;
    })();
    pending.set(key, operation);
    try {
      return await operation;
    } finally {
      pending.delete(key);
    }
  };
}
export {
  createTaskAuthorization
};
