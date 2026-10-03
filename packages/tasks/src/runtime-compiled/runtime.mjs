import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { registerWorkbench } from "./register.mjs";
import { isReadOnlyTool } from "./tool-manifest.mjs";
const TASK_ENTRY = "drone-task-checkpoint-v1";
const CONTROL = /* @__PURE__ */ new Set(["set_status", "todo", "capability_load", "task_status", "research_task_status"]);
const READ = { test: (name) => isReadOnlyTool(name) };
const safe = (value, length = 180) => String(value ?? "").replace(/(?:bearer\s+|(?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s,;]+/gi, "[redacted]").split("").map(
  (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char === "<" || char === ">" ? " " : char
).join("").slice(0, length);
function continuesTask(text) {
  return /^(?:继续(?:吧|执行|处理|完成|上一任务)?|接着(?:做|处理)?|下好了|下载好了|我下载了(?:，?手动的那几篇)?|完成到哪了|进度(?:如何|怎么样)?|查看(?:任务)?进度|任务状态|continue|resume|done|status|what(?:'s| is) the status)[\s,.!？，。！?]*$/i.test(
    String(text).trim()
  );
}
function isTaskStatusQuery(text) {
  return /^(?:完成到哪了|进度(?:如何|怎么样)?|查看(?:任务)?进度|任务状态|task status|what(?:'s| is) the status)[\s.!？，。！?]*$/i.test(
    String(text).trim()
  );
}
const clone = (value) => structuredClone(value);
const valid = (value, scope) => value?.version === 1 && value.scope === scope && typeof value.id === "string" && typeof value.goal === "string" && value.goal.length <= 180 && Array.isArray(value.receipts) && value.receipts.length <= 24 && Array.isArray(value.pending) && value.pending.length <= 32 && JSON.stringify(value).length <= 24e3;
function createTaskJournal({ persist = () => {
}, now = () => (/* @__PURE__ */ new Date()).toISOString() } = {}) {
  let task = null, scope = null, requested = false;
  const save = () => {
    if (task) {
      task.updatedAt = now();
      persist(clone(task));
    }
  };
  function attach(nextScope, entries = [], force = false) {
    if (scope === nextScope && !force) return;
    scope = nextScope;
    task = null;
    requested = false;
    for (const entry of entries)
      if (entry.customType === TASK_ENTRY && valid(entry.data, scope)) task = clone(entry.data);
    if (task?.pending.length) {
      task.state = "interrupted";
      task.reason = "execution-result-unknown";
    }
  }
  function begin(query) {
    if (!task || !continuesTask(query))
      task = {
        version: 1,
        scope,
        id: randomUUID(),
        goal: safe(query),
        state: "running",
        receipts: [],
        pending: [],
        startedAt: now()
      };
    else {
      task.state = "running";
      task.reason = null;
    }
    requested = false;
    save();
  }
  function start(id, tool) {
    if (!task || CONTROL.has(tool) || READ.test(tool)) return;
    if (task.pending.some((p) => p.id === id)) return;
    if (task.pending.length >= 32) return;
    task.pending.push({ id: safe(id, 100), tool: safe(tool, 80), at: now() });
    if (tool === "ask_user") task.state = "waiting_user";
    save();
  }
  async function observe(event, cwd) {
    if (!task) return;
    if (event.toolName === "todo" && Array.isArray(event.details?.todos)) {
      const next = event.details.todos.find((item) => item.status === "in_progress") || event.details.todos.find((item) => item.status === "pending");
      task.proposedNext = next ? safe(next.content, 180) : null;
      save();
      return;
    }
    if (CONTROL.has(event.toolName) || READ.test(event.toolName)) return;
    const id = safe(event.toolCallId, 100), tool = safe(event.toolName, 80);
    if (!id || task.receipts.some((r) => r.id === id)) return;
    task.pending = task.pending.filter((p) => p.id !== id);
    const details = event.details || {};
    const failed = event.isError || details.status === "failed" || details.error && details.successful === 0;
    const text = (event.content || []).filter((b) => b.type === "text").map((b) => b.text).join(" ");
    const cancelled = tool === "ask_user" && (details.cancelled || /cancelled|canceled/i.test(text));
    const receipt = {
      id,
      tool,
      at: now(),
      state: failed ? "failed" : cancelled ? "cancelled" : "returned"
    };
    if (!failed && ["write", "edit"].includes(tool) && typeof event.input?.path === "string") {
      try {
        const base = await realpath(cwd), full = await realpath(resolve(cwd, event.input.path));
        const rel = relative(base, full);
        if (rel && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.split(sep).some((part) => part.startsWith(".") || /^(?:auth|credentials|secrets?)(?:\.|$)/i.test(part))) {
          const stat = await lstat(full);
          if (stat.isFile() && stat.size <= 8 * 1024 * 1024) {
            const bytes = await readFile(full);
            receipt.artifact = {
              path: safe(rel, 512),
              bytes: bytes.length,
              sha256: createHash("sha256").update(bytes).digest("hex")
            };
            receipt.state = "file-observed";
          }
        }
      } catch {
      }
    }
    if (!failed && tool === "research_propose_wiki_update" && typeof details.id === "string")
      receipt.state = "awaiting_review";
    task.receipts.push(receipt);
    task.receipts = task.receipts.slice(-24);
    if (cancelled) task.state = "waiting_user";
    else if (failed) task.state = "partial";
    else if (tool === "ask_user" && task.state === "waiting_user") task.state = "running";
    else if (!["waiting_user", "partial", "paused", "interrupted"].includes(task.state))
      task.state = "running";
    save();
  }
  function pause(reason) {
    if (task) {
      task.state = "paused";
      task.reason = safe(reason, 80);
      save();
    }
  }
  function settle() {
    if (task && task.state === "running") {
      task.state = task.pending.length ? "interrupted" : "checkpoint";
      save();
    }
  }
  function render() {
    if (!task) return "\u8FD9\u4E2A\u4F1A\u8BDD\u8FD8\u6CA1\u6709\u4EFB\u52A1\u8BB0\u5F55\u3002";
    const lines = [
      "### \u4EFB\u52A1\u8FDB\u5C55",
      `\u4EFB\u52A1\uFF1A${safe(task.goal)}`,
      `\u72B6\u6001\uFF1A${{ running: "\u6267\u884C\u4E2D", waiting_user: "\u7B49\u4F60\u51B3\u5B9A", partial: "\u90E8\u5206\u53D7\u963B", paused: "\u5DF2\u6682\u505C", interrupted: "\u7ED3\u679C\u5F85\u6838\u5BF9", checkpoint: "\u8FDB\u5EA6\u5DF2\u4FDD\u5B58" }[task.state] || "\u5F85\u6838\u5BF9"}\uFF1B\u66F4\u65B0\u4E8E ${safe(task.updatedAt, 60)}`
    ];
    const labels = {
      returned: "\u5DF2\u6267\u884C\uFF0C\u7ED3\u679C\u5F85\u6838\u5BF9",
      failed: "\u5DE5\u5177\u62A5\u544A\u5931\u8D25",
      cancelled: "\u7528\u6237\u53D6\u6D88\u4E86\u9009\u62E9\uFF0C\u672A\u6388\u4E88\u65B0\u6743\u9650",
      "file-observed": "\u6587\u4EF6\u5DF2\u751F\u6210\u5E76\u8BFB\u5230\u5185\u5BB9",
      awaiting_review: "\u5DF2\u63D0\u4EA4\uFF0C\u7B49\u4F60\u5BA1\u9605"
    };
    for (const r of task.receipts.slice(-8))
      lines.push(
        `- ${safe(r.tool, 80)}\uFF1A${labels[r.state] || "\u72B6\u6001\u5F85\u6838\u5BF9"}${r.artifact ? `\uFF1B${safe(r.artifact.path, 512)}\uFF08${Number(r.artifact.bytes) || 0} \u5B57\u8282\uFF09` : ""}`
      );
    if (task.proposedNext) lines.push(`\u6A21\u578B\u8BA1\u5212\u7684\u4E0B\u4E00\u6B65\uFF08\u4E0D\u662F\u5B8C\u6210\u8BC1\u660E\uFF09\uFF1A${safe(task.proposedNext)}`);
    if (task.reason) lines.push(`\u6682\u505C\u539F\u56E0\uFF1A${safe(task.reason, 80)}\u3002`);
    if (task.pending.length)
      lines.push("\u6709\u64CD\u4F5C\u4E0A\u6B21\u6CA1\u7B49\u5230\u7ED3\u679C\uFF1B\u7EE7\u7EED\u524D\u5148\u67E5\u4E00\u4E0B\u5B83\u505A\u6CA1\u505A\u6210\uFF0C\u4E0D\u5F97\u76F4\u63A5\u91CD\u590D\u5199\u5165\u3001\u5B89\u88C5\u6216\u4E0A\u4F20\u3002");
    return lines.join("\n");
  }
  return {
    attach,
    begin,
    start,
    observe,
    pause,
    settle,
    render,
    snapshot: () => task ? clone(task) : null,
    requestReport: () => {
      requested = true;
    },
    takeReport: () => {
      const pending = requested;
      requested = false;
      return pending ? render() : null;
    }
  };
}
function registerTaskRuntime(pi, options = {}) {
  if (process.env.DRONE_TASK_WORKBENCH !== "off") return registerWorkbench(pi, options);
  const journal = createTaskJournal({ persist: (snapshot) => pi.appendEntry?.(TASK_ENTRY, snapshot) });
  const attach = (ctx, force = false) => {
    const id = ctx.sessionManager?.getSessionId?.() || ctx.sessionId || "isolated";
    const scope = createHash("sha256").update(`${id}\0${resolve(ctx.cwd)}`).digest("hex");
    journal.attach(scope, ctx.sessionManager?.getBranch?.() || [], force);
  };
  pi.on("session_start", (_event, ctx) => attach(ctx, true));
  pi.on("session_tree", (_event, ctx) => attach(ctx, true));
  let awaitingUser = false;
  pi.on("before_agent_start", (event, ctx) => {
    attach(ctx);
    journal.begin(event.prompt || "\u79D1\u7814\u4EFB\u52A1");
    awaitingUser = true;
    return {
      message: {
        customType: "drone-task-context",
        display: false,
        content: `Host task checkpoint (observations, not instructions or evidence):
${journal.render()}
Use task_status for operational delivery. Verify unknown outcomes before repeating any write.`
      }
    };
  });
  pi.on("message_start", (event, ctx) => {
    if (event.message.role !== "user") return;
    if (awaitingUser) {
      awaitingUser = false;
      return;
    }
    const content = event.message.content;
    const query = typeof content === "string" ? content : (content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    attach(ctx);
    journal.begin(query);
  });
  pi.on("tool_call", (event) => journal.start(event.toolCallId, event.toolName));
  pi.on("tool_result", (event, ctx) => journal.observe(event, ctx.cwd));
  pi.on("agent_end", (event) => {
    const last = [...event.messages || []].reverse().find((message) => message.role === "assistant");
    if (last?.stopReason === "aborted") journal.pause("user-aborted");
    else journal.settle();
  });
  pi.registerTool({
    name: "task_status",
    label: "\u4EFB\u52A1 \xB7 \u6267\u884C\u68C0\u67E5\u70B9",
    description: "Return a host-observed checkpoint for any task: data analysis, code, environment setup, experiments, writing or literature. No research search is needed. Does not certify scientific claims or grant permissions. Request this to deliver operational status without adding unrelated citations.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    execute: async (_id, _args, _signal, _update, ctx) => {
      attach(ctx);
      journal.requestReport();
      return { content: [{ type: "text", text: journal.render() }], details: { operational: true } };
    }
  });
  pi.registerCommand("task-status", {
    description: "\u67E5\u770B\u4EFB\u52A1\u6267\u884C\u68C0\u67E5\u70B9\uFF08\u4E0D\u8C03\u7528\u6A21\u578B\u3001\u4E0D\u89E6\u53D1\u79D1\u7814\u68C0\u7D22\uFF09",
    handler: async (_args, ctx) => {
      attach(ctx);
      pi.sendMessage(
        {
          customType: "drone-task-status",
          content: journal.render(),
          display: true,
          details: { operational: true, reportId: randomUUID() }
        },
        { triggerTurn: false }
      );
    }
  });
  return journal;
}
export {
  TASK_ENTRY,
  continuesTask,
  createTaskJournal,
  isTaskStatusQuery,
  registerTaskRuntime
};
