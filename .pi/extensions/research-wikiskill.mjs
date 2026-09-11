import { gateWikiSkillProposal, proposeWikiSkill, recordWikiSkillExperience, wikiSkillStatus } from "../lib/research-wikiskill.mjs";

export default function researchWikiSkill(pi) {
  if (process.env.PI_SUBAGENT_CHILD === "1") return;

  pi.registerTool({
    name: "research_wikiskill_record",
    label: "Compile research experience",
    description: "Compile one completed observable research run into the persistent WikiSkill raw/wiki layers. This stores auditable metadata and reusable process patterns, never hidden reasoning and never scientific claims as authority.",
    parameters: {
      type: "object",
      properties: {
        run_dir: { type: "string" }, project: { type: "string" }, outcome: { type: "string", enum: ["success", "failure", "mixed"] },
        patterns: { type: "array", minItems: 1, items: { type: "object", properties: {
          id: { type: "string" }, title: { type: "string" }, kind: { type: "string", enum: ["failure", "success", "workaround", "policy"] },
          problem: { type: "string" }, strategy: { type: "string" },
        }, required: ["id", "title", "problem", "strategy"] } },
      },
      required: ["run_dir", "outcome", "patterns"],
    },
    async execute(_id, params, _signal, _update, ctx) {
      const result = await recordWikiSkillExperience({ cwd: ctx.cwd, runDir: params.run_dir, project: params.project, outcome: params.outcome, patterns: params.patterns });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
    },
  });

  pi.registerTool({
    name: "research_wikiskill_propose",
    label: "Propose research Skill evolution",
    description: "Stage one atomic SKILL.md candidate motivated by persistent WikiSkill patterns. The candidate is not active until it passes isolated validation gating.",
    parameters: {
      type: "object",
      properties: {
        project: { type: "string" }, target_skill: { type: "string", enum: ["research-workflow", "research-vault"] },
        candidate_markdown: { type: "string" }, pattern_ids: { type: "array", minItems: 1, items: { type: "string" } }, rationale: { type: "string" },
      },
      required: ["target_skill", "candidate_markdown", "pattern_ids"],
    },
    async execute(_id, params, _signal, _update, ctx) {
      const result = await proposeWikiSkill({ cwd: ctx.cwd, project: params.project, targetSkill: params.target_skill, candidateMarkdown: params.candidate_markdown, patternIds: params.pattern_ids, rationale: params.rationale });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
    },
  });

  pi.registerTool({
    name: "research_wikiskill_gate",
    label: "Validate and gate research Skill",
    description: "Evaluate the active and candidate Skill in isolated no-tool Pi runs. Accept only a candidate that passes safety checks and scores strictly above both the active baseline and prior best; otherwise keep the active Skill while retaining Wiki history.",
    parameters: {
      type: "object",
      properties: { project: { type: "string" }, proposal_id: { type: "string" }, provider: { type: "string" }, model: { type: "string" } },
      required: ["proposal_id"],
    },
    async execute(_id, params, _signal, _update, ctx) {
      const result = await gateWikiSkillProposal({ cwd: ctx.cwd, project: params.project, proposalId: params.proposal_id, provider: params.provider, model: params.model });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
    },
  });

  pi.registerTool({
    name: "research_wikiskill_status",
    label: "Research WikiSkill status",
    description: "Show the persistent experience/raw/wiki/proposal counts and best accepted validation scores for a project.",
    parameters: { type: "object", properties: { project: { type: "string" } } },
    async execute(_id, params, _signal, _update, ctx) {
      const result = await wikiSkillStatus({ cwd: ctx.cwd, project: params.project });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
    },
  });

  pi.on("before_agent_start", async event => ({
    systemPrompt: `${event.systemPrompt}\n\nWikiSkill evolution policy: the scientific knowledge path and the Skill-evolution Wiki are separate. During normal research, use Zotero/Obsidian/Web plus the evidence gate for factual claims; never cite WikiSkill patterns as scientific evidence. After a completed parent research run, compile only reusable observable process experience with research_wikiskill_record. When a pattern recurs or reveals a concrete workflow defect, stage one atomic update to research-workflow or research-vault with research_wikiskill_propose, then run research_wikiskill_gate. Never activate a proposal manually. A rejected candidate is discarded from the active Skill but its Wiki pattern and impact history persist. Do not store hidden chain-of-thought.`,
  }));
}
