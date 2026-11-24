---
name: research-workflow
description: "Bounded personal research workflow for Drone: local knowledge first, Web fallback, evidence verification, and parent-session-only knowledge writes."
alwaysWith: research
---

# Research Workflow

Use this skill for substantive research requests, literature discovery, source comparison, and evidence-backed technical investigation. This is not a second knowledge-base setup: initialization, read ordering and Wiki maintenance belong to `research-vault` and `/obsidian-setup`. Check that `research_loop` and the archive/verification tools are loaded before starting this project workflow; do not pretend unavailable tools exist.

## Always in force

**Step 3.** Use Web search only when local evidence is absent, stale, incomplete, or conflicting. The host records successful external lookup receipts. Read-only local reuse does not require a separate skip call; use `record_external` only when an explicit external-search decision needs recording.

**Step 4.** Inspect original sources. A Wiki page, search snippet, failed MCP call, or `browser_required` result is not verified evidence and not a successful retrieval.

**Step 7.** Subagents may gather bounded evidence, may query the paired Obsidian knowledge base read-only when `subagentMcpPolicy=read-local`, and may write only inside the active run directory. The parent session alone owns persistent Obsidian/Vault deposition through controlled write tools.

Do not weaken evidence standards to make an answer, Wiki page, or Skill look successful. Never invent citations, downloads, tool calls, archive state, or validation scores.

## Sub-cards

- [evidence-loop.md](references/evidence-loop.md) — read this when choosing the scope, retrieving local evidence, archiving sources and completing the run.
- [wiki-maintenance.md](references/wiki-maintenance.md) — read this when staging or reviewing a Wiki update.
- [answer-shape.md](references/answer-shape.md) — read this when writing the final answer the user acts on.
- [interruption-budget.md](references/interruption-budget.md) — read this when asking the user a question or deciding for them.
- [delivery-and-explainers.md](references/delivery-and-explainers.md) — read this when delivering a paper, manual or explainer.
- [knowledge-specialists.md](references/knowledge-specialists.md) — read this when knowledge specialists the host dispatches.
- [research-design.md](references/research-design.md) — read this when designing a study or checking reasoning boundaries.
- [claims-and-recovery.md](references/claims-and-recovery.md) — read this when completing a run with claims or recovering an interrupted operation.
