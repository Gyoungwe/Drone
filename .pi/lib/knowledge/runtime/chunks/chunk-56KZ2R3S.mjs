import {
  projectIdentity
} from "./chunk-CXEKIGAQ.mjs";

// packages/knowledge/src/extension-helpers.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
function result(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    details: data
  };
}
async function currentProject(cwd) {
  let value;
  try {
    const parsed = JSON.parse(await readFile(join(cwd, ".pi/research-workspace.json"), "utf8"));
    if (parsed && typeof parsed === "object" && "knowledgeProjectId" in parsed)
      value = parsed.knowledgeProjectId;
  } catch {
  }
  return projectIdentity(cwd, value);
}
function explainerTopicId(value, title = "research-topic") {
  const base = String(value || title).normalize("NFKC").toLowerCase().replace(/[-_]20\d{6,14}$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 96);
  return base || "research-topic";
}
function sessionIdentity(ctx) {
  return ctx?.sessionManager?.getSessionId?.() || ctx?.sessionId || null;
}
function continuationHint(value) {
  return /(?:previous|prior|last|earlier|continue|resume|what about|how about|why|then|it|that|those|之前|上个|继续|刚才|它|那个|那它|为什么|怎么|如何|还有|然后)/i.test(
    String(value || "")
  );
}
function continuesTopic(prompt, topic) {
  if (!topic) return false;
  const text = String(prompt || "").trim();
  if (!text) return true;
  if (/(?:switch|new topic|different topic|换个|另一个|新的主题|切换主题)/i.test(text)) return false;
  if (continuationHint(text)) return true;
  const lower = text.toLowerCase();
  return [topic.id, topic.title, ...topic.aliases || [], ...topic.entities || []].filter((value) => typeof value === "string" && value.trim().length >= 2).some((value) => lower.includes(value.toLowerCase()));
}

export {
  result,
  currentProject,
  explainerTopicId,
  sessionIdentity,
  continuationHint,
  continuesTopic
};
