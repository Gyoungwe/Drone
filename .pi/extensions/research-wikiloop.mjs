import { buildResearchWikiPage, navigateResearchWiki, researchWikiStatus } from "../lib/research-wikiloop.mjs";

export default function researchWikiLoop(pi) {
  if (process.env.PI_SUBAGENT_CHILD === "1") return;

  pi.registerTool({
    name: "research_wiki_navigate",
    label: "Navigate research Wiki",
    description: "Search the project agent-native Wiki before broader retrieval. Returns ranked pages and excerpts for downstream research.",
    parameters: {
      type: "object",
      properties: { project: { type: "string" }, query: { type: "string" }, top_k: { type: "integer", minimum: 1, maximum: 12 } },
      required: ["project", "query"],
    },
    async execute(_id, params, _signal, _update, ctx) {
      const result = await navigateResearchWiki({ cwd: ctx.cwd, project: params.project, query: params.query, topK: params.top_k });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
    },
  });

  pi.registerTool({
    name: "research_wiki_build",
    label: "Build research Wiki",
    description: "Publish or revise one parent-reviewed Wiki page, then rerun the original query and report whether the page became retrievable. Requires traceable evidence references.",
    parameters: {
      type: "object",
      properties: {
        project: { type: "string" }, slug: { type: "string" }, title: { type: "string" }, content_markdown: { type: "string" },
        source_refs: { type: "array", items: { type: "string" }, minItems: 1 }, related_pages: { type: "array", items: { type: "string" } }, validation_query: { type: "string" },
      },
      required: ["project", "slug", "title", "content_markdown", "source_refs", "validation_query"],
    },
    async execute(_id, params, _signal, _update, ctx) {
      const result = await buildResearchWikiPage({ cwd: ctx.cwd, project: params.project, slug: params.slug, title: params.title, content: params.content_markdown, sourceRefs: params.source_refs, relatedPages: params.related_pages || [], validationQuery: params.validation_query });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
    },
  });

  pi.registerTool({
    name: "research_wiki_status",
    label: "Research Wiki status",
    description: "Show project Wiki page count and downstream navigation feedback count.",
    parameters: { type: "object", properties: { project: { type: "string" } }, required: ["project"] },
    async execute(_id, params, _signal, _update, ctx) {
      const result = await researchWikiStatus({ cwd: ctx.cwd, project: params.project });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
    },
  });

  pi.on("before_agent_start", async event => ({
    systemPrompt: `${event.systemPrompt}\n\nResearch Wiki loop: for substantive research, use research_wiki_navigate on the active project before broader local/Zotero/Web retrieval. Treat Wiki pages as navigation memory, never as final authority. After evidence is inspected and claims are supportable, the parent session may call research_wiki_build with traceable source_refs and the original research query. Inspect its retrieval feedback. If retrievable is false, improve the page title, links or concise evidence-bearing summary and retry at most twice. Never weaken evidence standards merely to improve Wiki retrieval. Child sessions never write the Wiki.`,
  }));
}
