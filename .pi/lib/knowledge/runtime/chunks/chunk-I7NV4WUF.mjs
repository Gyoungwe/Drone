import {
  publicationKnowledgeFlow,
  updateKnowledgeFlow
} from "./chunk-GC2J7ECB.mjs";
import {
  advisoryLine,
  knowledgeFailure,
  publicationNotices
} from "./chunk-3H4YGOMN.mjs";
import {
  advisoryCodes,
  readReviewMode
} from "./chunk-6LT3KQRY.mjs";
import {
  diagnosticText,
  runtimeSlot
} from "./chunk-4VUDROQV.mjs";

// packages/knowledge/src/publication.ts
import { createHash, randomUUID } from "node:crypto";
var state = runtimeSlot(
  "knowledge",
  "publication",
  /** @returns {any} */
  () => ({
    proofs: /* @__PURE__ */ new WeakSet(),
    projectEvent: projectKnowledgeEvent,
    projectSnapshot: projectKnowledgeSnapshot
  })
);
var FIELD = "knowledgePublication";
var hash = (content) => createHash("sha256").update(JSON.stringify(content ?? [])).digest("hex");
function sanitizeError(text) {
  return diagnosticText(text, 4096).trim();
}
function isUserAbortError(message) {
  return /was aborted|request aborted/i.test(String(message?.errorMessage || ""));
}
function base(message, content) {
  const errorMessage = message.stopReason === "error" && typeof message.errorMessage === "string" ? sanitizeError(message.errorMessage) : "";
  return {
    role: "assistant",
    content,
    api: message.api,
    provider: message.provider,
    model: message.model,
    usage: message.usage,
    timestamp: message.timestamp,
    stopReason: message.stopReason,
    ...message.responseId ? { responseId: message.responseId } : {},
    ...errorMessage ? { errorMessage } : {}
  };
}
function seal(message, content, detail) {
  const proof = { version: 1, id: randomUUID(), ...detail, contentHash: hash(content) };
  state.proofs.add(proof);
  return { ...base(message, content), [FIELD]: proof };
}
function blocked(message, code = "check-failed", turnId = null, operational = null, paths = []) {
  return seal(
    message,
    [
      {
        type: "text",
        text: operational || (code === "interrupted" ? publicationNotices.interrupted : `\u3010\u77E5\u8BC6\u5E93\u68C0\u67E5\u672A\u901A\u8FC7\u3011${publicationNotices[code] || publicationNotices["check-failed"]}`)
      }
    ],
    {
      status: "blocked",
      reason: code,
      turnId,
      ...paths.length ? { paths } : {},
      scientificallyVerified: false
    }
  );
}
function verifiedEvidence(error) {
  const verified = error?.verified;
  if (!verified || typeof verified !== "object") return {};
  const { sources, deliveries, ...rest } = verified;
  return {
    ...rest,
    sources: Array.isArray(sources) ? sources : [],
    deliveries: Array.isArray(deliveries) ? deliveries : []
  };
}
function isSealed(message, restore = false) {
  const proof = message?.[FIELD];
  return proof?.version === 1 && (state.proofs.has(proof) || restore) && [
    "released",
    "no-hits",
    "blocked",
    "tool-only",
    "unconfigured",
    "evidence-only",
    "setup-complete",
    "operational"
  ].includes(proof.status) && proof.contentHash === hash(message.content);
}
function inplace(target, source) {
  for (const name of Object.keys(target)) delete target[name];
  Object.assign(target, source);
  return target;
}
function projectUnsealed(message) {
  if (message.stopReason === "error" && !isUserAbortError(message))
    return seal(message, [], { status: "blocked", reason: "model-error", scientificallyVerified: false });
  if (["aborted", "length", "pending"].includes(message.stopReason) || isUserAbortError(message))
    return blocked(message, "interrupted");
  return blocked(message);
}
function projectKnowledgeEvent(event) {
  if (!process.env.DRONE_KNOWLEDGE_DIR) return event;
  if (event.type === "message_update") return null;
  if (event.type === "message_start" && event.message?.role === "assistant")
    return { ...event, message: base(event.message, []) };
  if (event.type === "message_end" && event.message?.role === "assistant") {
    if (!isSealed(event.message)) inplace(event.message, projectUnsealed(event.message));
    return event;
  }
  if (event.type === "turn_end" && event.message?.role === "assistant")
    return { ...event, message: isSealed(event.message) ? event.message : projectUnsealed(event.message) };
  if (event.type === "agent_end")
    return {
      ...event,
      messages: event.messages.map((m) => m.role === "assistant" && !isSealed(m) ? projectUnsealed(m) : m)
    };
  return event;
}
function projectKnowledgeSnapshot(messages, persisted = []) {
  if (!process.env.DRONE_KNOWLEDGE_DIR) return messages;
  const known = new Set(
    persisted.filter((m) => m.role === "assistant").map((m) => `${m.timestamp}:${hash(m.content)}`)
  );
  return messages.map((m) => {
    if (m.role !== "assistant" || isSealed(m)) return m;
    const saved = known.has(`${m.timestamp}:${hash(m.content)}`);
    if (saved && (!m[FIELD] || isSealed(m, true))) return m;
    return projectUnsealed(m);
  });
}
function registerAnswerPublication(pi, {
  runtime = null,
  getCurrent,
  evidenceOnly = false,
  getDeliveryFooter = null,
  getTaskFeedback = null,
  getTaskRuntime = null,
  maxToolRounds = 24
}) {
  const attachRuntime = (next) => {
    if (!next || typeof next !== "object" || !next.scheduler || !next.knowledge) return false;
    const slot = next.knowledge.publication || {};
    slot.proofs ??= /* @__PURE__ */ new WeakSet();
    slot.projectEvent = (event) => projectKnowledgeEvent(event);
    slot.projectSnapshot = (messages, persisted) => projectKnowledgeSnapshot(messages, persisted);
    next.knowledge.publication = slot;
    return true;
  };
  if (runtime) attachRuntime(runtime);
  let turnId = null, required = true, started = false, protocolBytes = 0, toolRounds = 0, setupReceipt = null;
  const protocol = /* @__PURE__ */ new Map(), deliveries = /* @__PURE__ */ new Map();
  const advisoryFooter = (ctx) => {
    const footer = typeof getDeliveryFooter === "function" ? getDeliveryFooter(ctx) : null;
    return footer ? [{ type: "text", text: `

${String(footer).slice(0, 2e3)}` }] : [];
  };
  const failure = (message, error) => {
    const info = knowledgeFailure(error);
    const task = getTaskRuntime?.();
    if (task?.snapshot()) task.pause(info.code);
    const report = task?.snapshot() ? `${task.render()}

\u7814\u7A76\u8BF4\u660E\u5C1A\u672A\u53D1\u5E03\uFF1A${info.message}` : getTaskFeedback?.()?.report(info.code, info.message, info.paths);
    return blocked(message, info.code, turnId, report, info.paths);
  };
  pi.on("context", async (event) => ({
    messages: event.messages.map((message) => {
      const original = protocol.get(message[FIELD]?.id);
      return original ? { ...message, content: original } : message;
    })
  }));
  const handleMessageEnd = async (event, ctx) => {
    const message = event.message;
    if (message.role !== "assistant") return;
    const report = (message2) => {
      if (message2[FIELD]?.status !== "tool-only" && message2[FIELD]?.reason !== "model-error")
        publicationKnowledgeFlow(ctx, message2[FIELD]);
      return { message: message2 };
    };
    const blocks = Array.isArray(message.content) ? message.content : [];
    const tools = blocks.filter((b) => b.type === "toolCall");
    if (tools.length) {
      toolRounds += 1;
      if (toolRounds > maxToolRounds && getTaskRuntime?.()?.advanceStage?.()) toolRounds = 1;
      const bytes = Buffer.byteLength(JSON.stringify(blocks), "utf8");
      if (toolRounds > maxToolRounds || protocolBytes + bytes > 4 * 1024 * 1024 || protocol.size >= 64) {
        const limit = toolRounds > maxToolRounds ? "tool-round-limit" : protocolBytes + bytes > 4 * 1024 * 1024 ? "protocol-byte-limit" : "protocol-entry-limit";
        const task = getTaskRuntime?.();
        task?.pause(limit);
        const reportText = [publicationNotices["tool-loop-stopped"], task?.snapshot() ? task.render() : null].filter(Boolean).join("\n\n");
        const denied = blocked(message, "tool-loop-stopped", turnId, reportText);
        denied[FIELD].limit = {
          kind: limit,
          toolRounds,
          maxToolRounds,
          protocolBytes,
          entries: protocol.size
        };
        denied.stopReason = "stop";
        return report(denied);
      }
      const safe = seal(message, tools, { status: "tool-only", turnId, scientificallyVerified: false });
      protocol.set(safe[FIELD].id, structuredClone(blocks));
      protocolBytes += bytes;
      return report(safe);
    }
    if (message.stopReason === "error" && !isUserAbortError(message))
      return report(
        seal(message, [], {
          status: "blocked",
          reason: "model-error",
          turnId,
          scientificallyVerified: false
        })
      );
    if (["aborted", "length", "pending"].includes(message.stopReason) || ctx.signal?.aborted || isUserAbortError(message))
      return report(failure(message, { code: "interrupted" }));
    const content = blocks.filter((b) => b.type === "text");
    if (!evidenceOnly) getTaskRuntime?.()?.takeReport();
    if (setupReceipt) {
      const done = setupReceipt;
      setupReceipt = null;
      try {
        await done.checkCurrent?.();
      } catch {
        return report(blocked(message, "binding-changed", turnId));
      }
      return report(
        seal(
          message,
          [
            {
              type: "text",
              text: [
                "\u77E5\u8BC6\u5E93\u521D\u59CB\u5316\u5DF2\u5B8C\u6210\u3002",
                `\u5F53\u524D\u77E5\u8BC6\u5E93\uFF1A${done.vault}`,
                `\u4F5C\u7528\u8303\u56F4\uFF1A\u6574\u4E2A Drone\uFF1B\u5F53\u524D\u9879\u76EE\uFF1A${done.project || "\u5C1A\u672A\u521B\u5EFA\u9879\u76EE\u5206\u533A"}\u3002`,
                `\u7ED3\u6784\uFF1A${done.profile}\uFF1B\u6C89\u6DC0\u7B56\u7565\uFF1A${done.depositMode}\uFF1B\u5B50\u667A\u80FD\u4F53\u8BBF\u95EE\uFF1A${done.subagentMcpPolicy}\u3002`,
                "\u5DF2\u4FDD\u5B58\u7ED1\u5B9A\u5E76\u521B\u5EFA\u7F3A\u5931\u7684\u5BFC\u822A\u548C\u6A21\u677F\uFF0C\u672A\u642C\u8FC1\u6216\u5220\u9664\u5DF2\u6709\u7B14\u8BB0\u3002",
                "\u8FD9\u53EA\u662F\u521D\u59CB\u5316\u5B8C\u6210\uFF0C\u4E0D\u4EE3\u8868\u8BBA\u6587\u5DF2\u7ECF\u4E0B\u8F7D\u3001\u77E5\u8BC6\u5DF2\u7ECF\u6574\u7406\u6216\u539F\u59CB MCP \u5DF2\u8FDE\u63A5\u3002",
                "\u63A5\u4E0B\u6765\u53EF\u4EE5\u8981\u6C42\u68C0\u7D22\u6216\u4E0B\u8F7D\u8D44\u6599\uFF1B\u8BBA\u6587\u5E94\u4EA4\u4ED8\u4E3B\u8981\u89C2\u70B9\u4E0E\u65B9\u6CD5\uFF0C\u8F6F\u4EF6\u5E94\u4EA4\u4ED8\u7248\u672C\u5BF9\u5E94\u7684\u547D\u4EE4\u3001\u53C2\u6570\u4E0E\u793A\u4F8B\u3002"
              ].join("\n\n")
            }
          ],
          {
            status: "setup-complete",
            turnId,
            vaultId: done.vaultId,
            bindingRevision: done.bindingRevision,
            scientificallyVerified: false
          }
        )
      );
    }
    if (!content.some((block) => block.text?.trim()))
      return report(failure(message, { code: "empty-answer" }));
    if (evidenceOnly)
      return {
        message: seal(
          message,
          [{ type: "text", text: "\u3010\u5B50\u667A\u80FD\u4F53\u5F85\u6838\u9A8C\u6750\u6599\u3011\u4EE5\u4E0B\u4E0D\u662F\u4E3B\u4F1A\u8BDD\u5DF2\u6838\u9A8C\u7684\u6700\u7EC8\u7ED3\u8BBA\u3002\n\n" }, ...content],
          { status: "evidence-only", turnId, scientificallyVerified: false }
        )
      };
    if (!started) return report(blocked(message, "not-prepared", turnId));
    if (!required)
      return report(
        seal(message, content, { status: "unconfigured", turnId, scientificallyVerified: false })
      );
    const text = content.map((b) => b.text).join("\n");
    if (Buffer.byteLength(text, "utf8") > 128 * 1024)
      return report(blocked(message, "answer-too-large", turnId));
    updateKnowledgeFlow(ctx, { phase: "checking" });
    try {
      const c = getCurrent(ctx);
      if (!c) throw Object.assign(new Error("not prepared"), { code: "not-prepared" });
      let publishText = text;
      let publishContent = content;
      const attachMaterializedCitations = async (refresh = false) => {
        if (typeof c.service.materializeCitations !== "function") return;
        const paths = await c.service.materializeCitations(c.ticket, ctx.cwd, c.query, { refresh });
        if (!paths.length || /\[\[[^\]]+\]\]/.test(publishText)) return;
        const suffix = `

\u4F9D\u636E\uFF1A${paths.map((path) => `[[${path.replace(/\.md$/i, "")}]]`).join(" ")}`;
        publishText = `${publishText}${suffix}`;
        publishContent = publishContent.map(
          (block, index) => block.type === "text" && index === publishContent.length - 1 ? { ...block, text: `${block.text}${suffix}` } : block
        );
      };
      const validateWithTimeout = async () => {
        let timer;
        try {
          return await Promise.race([
            c.service.validateAnswer(c.ticket, ctx.cwd, publishText, {
              deliveries: [...deliveries.values()]
            }),
            new Promise((_, reject) => {
              timer = setTimeout(
                () => reject(Object.assign(new Error("check timeout"), { code: "check-timeout" })),
                5e3
              );
            })
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      };
      const automatic = await readReviewMode() === "automatic";
      if (!automatic) await attachMaterializedCitations();
      let proof;
      try {
        proof = await validateWithTimeout();
      } catch (error) {
        if (automatic || !["coverage-incomplete", "search-stale"].includes(error?.code)) throw error;
        await attachMaterializedCitations(true);
        proof = await validateWithTimeout();
      }
      if (ctx.signal?.aborted) return report(failure(message, { code: "interrupted" }));
      const published = proof.status === "no-hits" ? [
        {
          type: "text",
          text: "\u3010\u77E5\u8BC6\u5E93\u68C0\u7D22\u65E0\u547D\u4E2D\u3011\u672C\u8F6E\u67E5\u8BE2\u672A\u627E\u5230\u5339\u914D\u6761\u76EE\uFF1B\u4E0B\u6587\u4E0D\u662F\u57FA\u4E8E\u672C\u5E93\u8BC1\u636E\u7684\u7ED3\u8BBA\uFF0C\u4E5F\u4E0D\u8868\u793A\u5168\u5E93\u4E0D\u5B58\u5728\u76F8\u5173\u77E5\u8BC6\u3002\n\n"
        },
        ...publishContent
      ] : publishContent;
      const footer = typeof getDeliveryFooter === "function" ? getDeliveryFooter(ctx) : null;
      const visible = footer ? [...published, { type: "text", text: `

${String(footer).slice(0, 2e3)}` }] : published;
      return report(
        seal(message, visible, {
          ...proof,
          status: proof.status === "ready" ? "released" : "no-hits",
          turnId
        })
      );
    } catch (error) {
      const info = knowledgeFailure(error);
      if (await readReviewMode() === "automatic" && advisoryCodes.has(info.code) && !ctx.signal?.aborted) {
        try {
          const current = getCurrent(ctx);
          await current.service.check(current.ticket, ctx.cwd);
        } catch (authorityError) {
          return report(failure(message, authorityError));
        }
        return report(
          seal(
            message,
            [
              ...content,
              {
                type: "text",
                text: `

\u3010\u6709\u63D0\u9192\u3011${advisoryLine(info.code, error)}`
              },
              ...advisoryFooter(ctx)
            ],
            {
              status: "released",
              reviewMode: "automatic",
              ...verifiedEvidence(error),
              warnings: [info],
              turnId,
              scientificallyVerified: false
            }
          )
        );
      }
      return report(failure(message, error));
    }
  };
  pi.on("message_end", (event, ctx) => handleMessageEnd(event, ctx));
  return {
    attachRuntime,
    async recordDelivery(ctx, path) {
      const c = getCurrent(ctx);
      if (!c) return;
      const receipt = await c.service.deliveryReceipt(c.ticket, ctx.cwd, path);
      deliveries.set(receipt.path, receipt);
      while (deliveries.size > 12) deliveries.delete(deliveries.keys().next().value);
    },
    async preflight(ctx, text) {
      let timer;
      try {
        if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > 128 * 1024)
          throw { code: "answer-too-large" };
        const c = getCurrent(ctx), proof = await Promise.race([
          c.service.validateAnswer(c.ticket, ctx.cwd, text, { deliveries: [...deliveries.values()] }),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject({ code: "check-timeout" }), 5e3);
          })
        ]);
        return { ok: true, proof };
      } catch (error) {
        const info = knowledgeFailure(error);
        if (await readReviewMode() === "automatic" && advisoryCodes.has(info.code)) {
          try {
            const current = getCurrent(ctx);
            await current.service.check(current.ticket, ctx.cwd);
          } catch {
            return {
              ok: false,
              code: "binding-changed",
              message: "Refresh the current knowledge binding before continuing."
            };
          }
          return {
            ok: true,
            status: "warning",
            ...verifiedEvidence(error),
            warnings: [info],
            scientificallyVerified: false,
            next: "Deliver the answer with its limitations. Do not repeat read/search/check solely to clear this advisory."
          };
        }
        return {
          ok: false,
          ...info,
          next: "For operational progress, call task_status and deliver its host receipt without unrelated citations. For scientific claims, read the listed evidence or repair the reported stage, then check again. Never retry a write merely because output was lost.",
          task: getTaskFeedback?.()?.facts()
        };
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    recordSetup(result, checkCurrent) {
      if (result?.state === "ready" && result.scope === "application")
        setupReceipt = {
          vault: result.vault,
          project: result.project,
          profile: result.profile,
          depositMode: result.depositMode,
          subagentMcpPolicy: result.subagentMcpPolicy,
          vaultId: result.vaultId,
          bindingRevision: result.bindingRevision,
          checkCurrent
        };
    },
    begin(isRequired = true, newTurn = true) {
      started = true;
      required = isRequired;
      if (newTurn) {
        turnId = randomUUID();
        protocol.clear();
        deliveries.clear();
        protocolBytes = 0;
        toolRounds = 0;
        setupReceipt = null;
      }
    },
    invalidate() {
      started = false;
      required = true;
      turnId = null;
      protocol.clear();
      deliveries.clear();
      protocolBytes = 0;
      toolRounds = 0;
      setupReceipt = null;
    },
    get guidance() {
      return readReviewMode() === "automatic" ? "Answer the user's question directly. For a planning request, first provide a concise provisional framework with explicit assumptions, then deepen only the evidence needed. Cite scientific claims inline using exact [[path]] citations from research_read_knowledge results read this turn; a saved report link is a deliverable, not an evidence citation. Reuse successful read receipts instead of reading the same source through both generic read and research_read_knowledge. Do not invent citations or cite a source merely to clear a warning. Label suggested sample sizes as design heuristics, not universal statistical thresholds. Acknowledge uncertainty and save useful knowledge. Evidence quality reminders are nonblocking: do not run repeated read/search/check just to clear them. Never claim scientific verification. Host permission, binding, abort and spending limits still apply; human Wiki edits require confirmation." : "For execution progress in ANY task (analysis, code, environment, experiments, writing), use task_status; its host-generated report needs no research citations. Never add irrelevant sources to an operational report. Scientific host-checked answers need a current-turn search, reads of cited [[path]] sources, then research_check_answer. Public text must answer the user's question; do not lecture about Vault policy or evidence-gate stages. Use short set_status about the task, not product design. Show Me/run links are deliverables, not evidence.";
    }
  };
}

export {
  projectKnowledgeEvent,
  projectKnowledgeSnapshot,
  registerAnswerPublication
};
