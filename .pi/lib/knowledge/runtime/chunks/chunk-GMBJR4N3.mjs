import {
  loadWorkspaceConfig,
  publishExplainer
} from "./chunk-4VUDROQV.mjs";
import {
  withKnowledgeBinding
} from "./chunk-CXEKIGAQ.mjs";

// packages/knowledge/src/specialist-delivery.ts
import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
var contained = (root, path) => {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
};
function validateSpecialistHtml(html) {
  if (typeof html !== "string" || html.length > 64e3 || !/<html\b/i.test(html) || !/<body\b/i.test(html))
    throw new Error("Explainer must be one bounded HTML document");
  if (/<(?:script|iframe|frame|object|embed|base|form|link)\b|\bon[a-z]+\s*=|<meta\b[^>]*http-equiv\s*=|javascript\s*:|@import|url\s*\(/i.test(
    html
  ))
    throw new Error("Explainer must be static and self-contained; active content was refused");
  if (/\bsrc\s*=\s*["']?(?!data:image\/)[^\s>]/i.test(html))
    throw new Error("Explainer external resources are not allowed");
  return html;
}
async function saveSpecialistExplainer(c, ctx, { runDir, topicId, answer }) {
  if (answer.status !== "completed") return answer;
  const html = validateSpecialistHtml(answer.data.html), config = await loadWorkspaceConfig(ctx.cwd);
  const root = await realpath(config.resultsRoot), run = await realpath(resolve(ctx.cwd, runDir || ""));
  if (!contained(root, run) || relative(root, run).split(sep).length !== 2 || !run.split(sep).at(-1).startsWith("run-") || !(await lstat(join(run, "metadata.json"))).isFile())
    throw new Error("Explainer destination must be an existing research run");
  return withKnowledgeBinding(c.binding, async () => {
    const artifactPath = join(run, `show-me-${randomUUID()}.html`);
    const sources = await c.service.evidenceReceipts(c.ticket, ctx.cwd, answer.data.source_paths);
    await mkdir(run, { recursive: true });
    await writeFile(artifactPath, html, { flag: "wx", mode: 384 });
    const archived = await publishExplainer({
      cwd: ctx.cwd,
      project: c.project,
      topicId,
      title: answer.data.title,
      artifactPath,
      summary: answer.data.summary,
      sources: sources.sources
    });
    return {
      ...archived,
      result_file: artifactPath,
      producer: "knowledge-explainer",
      skill: answer.skillName || "show-me"
    };
  });
}

export {
  validateSpecialistHtml,
  saveSpecialistExplainer
};
