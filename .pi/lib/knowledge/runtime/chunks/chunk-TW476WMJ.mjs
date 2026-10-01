// packages/knowledge/src/task-feedback.ts
import { lstat, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
var replaceControl = (text) => [...String(text || "")].map((char) => char.charCodeAt(0) < 32 ? " " : char).join("");
var clean = (text, limit = 300) => replaceControl(text).replace(/(?:bearer\s+|api[_-]?key[=:]\s*)[^\s]+/gi, "[redacted]").trim().slice(0, limit);
function createTaskFeedback() {
  let failures = [];
  let files = /* @__PURE__ */ new Map();
  let seen = /* @__PURE__ */ new Set();
  let archiveCount = 0;
  let summarySaved = false;
  let explainerSaved = false;
  let candidates = /* @__PURE__ */ new Set();
  const begin = () => {
    failures = [];
    files = /* @__PURE__ */ new Map();
    seen = /* @__PURE__ */ new Set();
    archiveCount = 0;
    summarySaved = false;
    explainerSaved = false;
    candidates = /* @__PURE__ */ new Set();
  };
  const observe = async (event, ctx) => {
    if (seen.has(event.toolCallId)) return;
    seen.add(event.toolCallId);
    if (seen.size > 512) {
      const oldest = seen.values().next().value;
      seen.delete(oldest);
    }
    const details = event.details || {};
    const content = event.content || [];
    if (event.isError || details.status === "failed" || details.error && details.successful === 0) {
      failures.push({
        tool: clean(event.toolName, 60),
        reason: clean(
          details.reason || details.error || content.filter((block) => block.type === "text").map((block) => block.text).join(" ")
        )
      });
      failures = failures.slice(-6);
      return;
    }
    let path = null;
    if (event.toolName === "research_propose_wiki_update" && details.id) candidates.add(details.id);
    if (event.toolName === "research_archive_source" && details.status === "downloaded") archiveCount++;
    if (event.toolName === "research_summarize_run" && details.summary_saved) {
      summarySaved = true;
      path = details.run;
    }
    if (event.toolName === "research_archive_explainer" && details.knowledge_status === "written") {
      explainerSaved = true;
      path = details.note;
    }
    if (["write", "edit"].includes(String(event.toolName))) path = event.input?.path;
    if (typeof path !== "string") return;
    try {
      const full = await realpath(resolve(ctx.cwd, path));
      const rel = relative(await realpath(ctx.cwd), full);
      if (rel.startsWith(`results${sep}`) && (await lstat(full)).isFile()) {
        files.delete(full);
        files.set(full, { name: clean(rel.split(sep).at(-1), 100), path: full });
        while (files.size > 8) files.delete(files.keys().next().value);
      }
    } catch {
    }
  };
  const facts = () => ({
    archivedSources: archiveCount,
    summarySaved,
    explainerSaved,
    pendingWikiCandidates: candidates.size,
    files: [...files.values()],
    failures: [...failures]
  });
  const report = (reason, message, paths = []) => {
    const interrupted = reason === "interrupted";
    const current = facts();
    const lines = [
      interrupted ? "\u672C\u6B21\u8BF7\u6C42\u5DF2\u4E2D\u65AD\uFF0C\u672A\u5B8C\u6210\u7684\u56DE\u7B54\u6CA1\u6709\u53D1\u5E03\u3002" : `\u3010\u77E5\u8BC6\u5E93\u68C0\u67E5\u672A\u901A\u8FC7\u3011\u672C\u8F6E\u7684\u6700\u7EC8\u56DE\u7B54\u5C1A\u672A\u5B8C\u6210\u53D1\u5E03\uFF08${clean(reason, 60)}\uFF09\u3002`,
      ...interrupted ? [] : [clean(message, 450)]
    ];
    if (paths.length)
      lines.push(
        "\u9700\u8981\u5904\u7406\u7684\u6761\u76EE\uFF1A" + paths.slice(0, 6).map((path) => `\`${clean(path, 512).replaceAll("`", "")}\``).join("\u3001")
      );
    if (current.archivedSources || current.summarySaved || current.files.length)
      lines.push(
        `\u5DF2\u5B8C\u6210\u7684\u5DE5\u4F5C\u4ECD\u7136\u4FDD\u7559\uFF1A\u5F52\u6863\u6765\u6E90 ${current.archivedSources} \u9879\uFF1B\u7814\u7A76\u6458\u8981${current.summarySaved ? "\u5DF2\u4FDD\u5B58" : "\u5C1A\u672A\u786E\u8BA4\u4FDD\u5B58"}\uFF1BShow Me ${current.explainerSaved ? "\u5DF2\u5F52\u6863" : "\u5C1A\u672A\u786E\u8BA4\u5F52\u6863"}\uFF1B\u5F85\u5BA1\u6838 Wiki \u5019\u9009 ${current.pendingWikiCandidates} \u4E2A\u3002`
      );
    if (current.files.length)
      lines.push(
        "\u672C\u8F6E\u5B9E\u9645\u5199\u5165\u7684\u4EA7\u7269\uFF08\u5185\u5BB9\u4ECD\u9700\u6838\u9A8C\uFF09\uFF1A\n" + current.files.map((file) => `- [${file.name.replace(/[[\]]/g, "")}](${pathToFileURL(file.path).href})`).join("\n")
      );
    if (current.failures.length)
      lines.push(
        "\u8FC7\u7A0B\u4E2D\u8FD8\u53D1\u751F\u8FC7\u4EE5\u4E0B\u5DE5\u5177\u95EE\u9898\uFF1B\u90E8\u5206\u53EF\u80FD\u5DF2\u6539\u7528\u5176\u4ED6\u8DEF\u5F84\u7EE7\u7EED\uFF1A\n" + current.failures.slice(-3).map((entry) => `- ${entry.tool}\uFF1A${entry.reason}`).join("\n")
      );
    lines.push(
      interrupted ? "\u5DF2\u8BB0\u5F55\u7684\u5DE5\u5177\u7ED3\u679C\u4ECD\u53EF\u5728\u672C\u4F1A\u8BDD\u67E5\u770B\u3002\u53EF\u4EE5\u7EE7\u7EED\u5269\u4F59\u5DE5\u4F5C\uFF1B\u4E0D\u9700\u8981\u91CD\u65B0\u4E0B\u8F7D\u5DF2\u7ECF\u4FDD\u5B58\u7684\u8D44\u6599\u3002" : "\u63A5\u4E0B\u6765\u5E94\u6839\u636E\u5177\u4F53\u68C0\u67E5\u539F\u56E0\u8865\u8BFB\u6216\u4FEE\u6B63\u5F15\u7528\uFF0C\u518D\u9884\u68C0\u56DE\u7B54\uFF1B\u4E0D\u9700\u8981\u91CD\u65B0\u4E0B\u8F7D\u5DF2\u7ECF\u4FDD\u5B58\u7684\u8D44\u6599\u3002\u8FD9\u91CC\u62A5\u544A\u7684\u662F\u6267\u884C\u72B6\u6001\uFF0C\u4E0D\u662F\u5BF9\u672A\u53D1\u5E03\u7814\u7A76\u7ED3\u8BBA\u7684\u8BA4\u53EF\u3002"
    );
    return lines.join("\n\n");
  };
  return { begin, observe, facts, report };
}
function guardResearchToolResult(event) {
  if (!["fetch_content", "webfetch", "research_archive_source"].includes(String(event.toolName))) return;
  const text = (event.content || []).filter((block) => block.type === "text").map((block) => String(block.text || "")).join("\n");
  if (/(?:^|\n)%PDF-\d\.\d/.test(text.slice(0, 1800)) && (text.includes("\0") || /(?:\uFFFD|\d+\s+\d+\s+obj|\nstream)/.test(text.slice(0, 6e3))))
    return {
      content: [
        {
          type: "text",
          text: "\u8BFB\u53D6\u672A\u5B8C\u6210\uFF1A\u5DE5\u5177\u8FD4\u56DE\u4E86 PDF \u4E8C\u8FDB\u5236\uFF0C\u4E0D\u662F\u53EF\u8BFB\u6B63\u6587\u3002\u8BF7\u5F52\u6863\u539F PDF \u540E\u4F7F\u7528\u5DF2\u6709\u7684\u6587\u672C\u63D0\u53D6\u5DE5\u5177\u8BFB\u53D6\u9700\u8981\u7684\u9875\u6216\u6BB5\u843D\uFF1B\u4E0D\u8981\u628A\u8FD9\u4E9B\u5B57\u8282\u5F53\u4F5C\u8BC1\u636E\uFF0C\u4E5F\u4E0D\u8981\u91CD\u590D\u628A\u4E8C\u8FDB\u5236\u9001\u5165\u4E0A\u4E0B\u6587\u3002"
        }
      ],
      isError: true,
      details: { ...event.details || {}, error: "binary-pdf-returned", contentGuard: "binary-pdf" }
    };
  const details = event.details;
  if (!event.isError && (details?.status === "failed" || details?.error && details.successful === 0))
    return { isError: true };
}

export {
  createTaskFeedback,
  guardResearchToolResult
};
