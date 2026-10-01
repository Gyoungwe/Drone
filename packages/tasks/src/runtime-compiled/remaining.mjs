import { acceptanceVerifier, effectiveAcceptance } from "./acceptance.mjs";
const text = (value, max = 180) => String(value || "").replace(/\s+/g, " ").slice(0, max);
function remainingExplanation(task) {
  const milestones = task.milestones || [], remaining = milestones.filter((m) => m.state !== "completed");
  const lines = [
    milestones.length ? `\u5DF2\u9A8C\u6536 ${milestones.length - remaining.length}/${milestones.length} \u9879\uFF1B\u5269\u4F59 ${remaining.length} \u9879\u3002` : "\u8FD8\u6CA1\u7EA6\u5B9A\u8981\u4EA4\u4ED8\u4EC0\u4E48\uFF0C\u6682\u4E0D\u8BA1\u7B97\u5B8C\u6210\u767E\u5206\u6BD4\uFF1B\u5148\u8BF4\u6E05\u695A\u60F3\u8981\u4EC0\u4E48\u7ED3\u679C\u3001\u505A\u5230\u4EC0\u4E48\u7A0B\u5EA6\u7B97\u5B8C\u6210\u3002"
  ];
  for (const m of remaining) {
    const acceptance = effectiveAcceptance(m);
    const deps = (m.dependsOn || []).map((id) => milestones.find((x) => x.id === id)).filter((x) => x && x.state !== "completed");
    const action = (task.actions || []).find((a) => a.milestoneId === m.id && a.state === "pending");
    const recorded = (task.operations || []).some(
      (o) => o.artifact?.path === acceptance.path && !o.artifact?.intentOnly && o.state !== "started"
    );
    let reason = "", next = "";
    if (deps.length) {
      reason = `\u524D\u7F6E\u9879\u5C1A\u672A\u9A8C\u6536\uFF1A${deps.map((d) => text(d.title, 70)).join("\u3001")}`;
      next = "\u5148\u628A\u524D\u9762\u8FD9\u51E0\u9879\u505A\u5B8C\uFF0C\u8FD9\u4E00\u9879\u81EA\u7136\u4F1A\u8DDF\u4E0A";
    } else if (action) {
      reason = `\u7B49\u5F85\u4F60\u5904\u7406\uFF1A${text(action.title)}\uFF1B${text(action.reason)}`;
      next = action.kind === "authorization" ? "\u5728\u5F39\u51FA\u7684\u786E\u8BA4\u6846\u91CC\u70B9\u540C\u610F" : action.kind === "rebind" ? "\u5728\u5F39\u51FA\u7684\u786E\u8BA4\u6846\u91CC\u51B3\u5B9A\u662F\u5426\u6362\u6210\u65B0\u7684\u6587\u732E" : action.kind === "file" || action.kind === "download" ? "\u628A\u5DF2\u6709\u6587\u4EF6\u7684\u8DEF\u5F84\u586B\u8FDB\u6765\uFF0C\u7A0B\u5E8F\u4F1A\u6838\u5BF9\uFF0C\u4E0D\u7528\u91CD\u65B0\u4E0B\u8F7D" : "\u4EB2\u81EA\u770B\u8FC7\u4E4B\u540E\u56DE\u6765\u786E\u8BA4\u4E00\u4E0B";
    } else if (acceptanceVerifier(m.acceptance.kind)?.pending) {
      const hint = acceptanceVerifier(m.acceptance.kind).pending({ ...m, acceptance }) || {};
      reason = hint.reason || `\u8FD9\u4E00\u9879\u8981\u7B49 ${m.acceptance.kind} \u6838\u5BF9\u901A\u8FC7`;
      next = hint.next || "\u5148\u6838\u5BF9\u5DF2\u6709\u7ED3\u679C\uFF0C\u518D\u51B3\u5B9A\u662F\u5426\u7EE7\u7EED";
    } else if (m.acceptance.kind === "human_review") {
      reason = "\u8FD9\u4E00\u9879\u7EA6\u5B9A\u8981\u4F60\u4EB2\u81EA\u770B\u8FC7\u624D\u7B97\u6570\uFF0C\u76EE\u524D\u8FD8\u6CA1\u6709";
      next = "\u5185\u5BB9\u51C6\u5907\u597D\u540E\u8BF7\u8FC7\u76EE\u4E00\u904D\uFF0C\u770B\u5B8C\u786E\u8BA4\u5373\u53EF";
    } else if (recorded) {
      reason = "\u5DF2\u6709\u4EA7\u7269\u8BB0\u5F55\uFF0C\u4F46\u548C\u7EA6\u5B9A\u7684\u6807\u51C6\u8FD8\u6CA1\u5BF9\u4E0A";
      next = "\u5148\u770B\u770B\u5DF2\u751F\u6210\u7684\u6587\u4EF6\u5BF9\u4E0D\u5BF9\uFF08\u4F4D\u7F6E\u3001\u7248\u672C\u3001\u5185\u5BB9\uFF09\uFF0C\u522B\u6025\u7740\u91CD\u65B0\u751F\u6210";
    } else if (m.evidence?.code === "ENOENT") {
      reason = "\u5728\u7EA6\u5B9A\u7684\u4F4D\u7F6E\u6CA1\u627E\u5230\u6587\u4EF6\u2014\u2014\u4E5F\u53EF\u80FD\u662F\u5B58\u5230\u522B\u5904\u4E86";
      next = `\u770B\u4E00\u4E0B ${text(acceptance.path, 140)} \u548C\u5B9E\u9645\u4FDD\u5B58\u7684\u4F4D\u7F6E\u662F\u4E0D\u662F\u540C\u4E00\u4E2A\uFF0C\u786E\u5B9E\u6CA1\u6709\u518D\u8865\u505A`;
    } else {
      reason = "\u8FD9\u4E00\u9879\u8FD8\u6CA1\u786E\u8BA4\u5B8C\u6210\uFF1B\u4E0D\u80FD\u636E\u6B64\u65AD\u8A00\u6587\u4EF6\u4E0D\u5B58\u5728\u6216\u5DE5\u4F5C\u672A\u505A";
      next = `\u5148\u770B\u770B${text(acceptance.path || acceptance.doi || "\u73B0\u6709\u7ED3\u679C", 140)}\uFF0C\u786E\u5B9E\u7F3A\u4E86\u518D\u8865`;
    }
    lines.push(`\u2022 ${text(m.title)}
  \u539F\u56E0\uFF1A${reason}
  \u4E0B\u4E00\u6B65\uFF1A${next}\u3002`);
  }
  if ((task.operations || []).some((o) => ["started", "unknown"].includes(o.state)))
    lines.push("\u6709\u64CD\u4F5C\u4E0A\u6B21\u6CA1\u7B49\u5230\u7ED3\u679C\uFF1A\u5148\u6838\u5BF9\u5B83\u5B9E\u9645\u505A\u6CA1\u505A\u6210\uFF0C\u522B\u76F4\u63A5\u91CD\u6765\u4E00\u904D\u3002");
  for (const a of (task.actions || []).filter(
    (a2) => a2.state === "pending" && !remaining.some((m) => m.id === a2.milestoneId)
  ))
    lines.push(`\u9700\u8981\u4F60\uFF1A${text(a.title)}\uFF1B${text(a.reason)}\u3002`);
  for (const u of (task.unboundIdentities || []).filter((u2) => remaining.some((m) => m.acceptance.kind === u2.kind)).slice(-4))
    lines.push(
      `\u5DF2\u8BB0\u5F55\u4F46\u672A\u5BF9\u5E94\u5230\u4EFB\u4F55\u4EA4\u4ED8\u9879\uFF1A${text(u.doi || u.kind, 140)}\u3002\u82E5\u8BA1\u5212\u91CC\u5199\u7684\u6587\u732E\u6709\u8BEF\uFF0C\u7528 task_wait kind=rebind\uFF08milestoneId + doi + reason\uFF09\u8BF7\u7528\u6237\u786E\u8BA4\u66F4\u6362\u3002`
    );
  if (milestones.length && !remaining.length) {
    lines.push("\u7EA6\u5B9A\u7684\u4EA4\u4ED8\u90FD\u5DF2\u786E\u8BA4\u5B8C\u6210\u3002\u8FD8\u60F3\u505A\u522B\u7684\uFF0C\u76F4\u63A5\u8BF4\u5C31\u884C\u3002");
    const returned = (task.operations || []).filter((o) => o.state === "returned").length;
    const failed = (task.operations || []).filter((o) => o.state === "failed").length;
    if (returned)
      lines.push(`\u5176\u4E2D ${returned} \u6B65\u547D\u4EE4/\u5916\u90E8\u64CD\u4F5C\u53EA\u6709\u8FD4\u56DE\u8BB0\u5F55\u3001\u6CA1\u6709\u72EC\u7ACB\u6838\u5BF9\uFF1B\u4EA4\u4ED8\u4EE5\u9A8C\u6536\u8FC7\u7684\u6587\u4EF6\u4E3A\u51C6\u3002`);
    if (failed) lines.push(`\u8FC7\u7A0B\u4E2D\u6709 ${failed} \u6B65\u64CD\u4F5C\u51FA\u8FC7\u9519\uFF1B\u4EA4\u4ED8\u4EE5\u6700\u7EC8\u9A8C\u6536\u8FC7\u7684\u6587\u4EF6\u4E3A\u51C6\u3002`);
  }
  return lines.join("\n").slice(0, 1e4);
}
export {
  remainingExplanation
};
