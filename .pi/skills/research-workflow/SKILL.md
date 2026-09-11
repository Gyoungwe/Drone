---
name: research-workflow
description: "Bounded personal research workflow for Percho: local knowledge first, Web fallback, evidence verification, and parent-session-only knowledge writes."
---

# Research Workflow

Use this skill for substantive research requests, literature discovery, source comparison, and evidence-backed technical investigation. This is not a second knowledge-base setup: initialization, read ordering and Wiki maintenance belong to `research-vault` and `/obsidian-setup`. Check that `research_loop` and the archive/verification tools are loaded before starting this project workflow; do not pretend unavailable tools exist.

1. Create a persistent run with `research_loop(action=start)` and preserve the exact research question.
2. In desktop application mode, first use the current bounded global navigation and project context, read the relevant Wiki with `research_read_knowledge`, then search evidence with `research_search_knowledge` and Zotero. Respect partial index coverage and pending Wiki reviews. In legacy project mode use the project Wiki and read-only Vault MCP. Record the exact local query with `research_loop(action=record_local)`; a self-reported query alone is not proof of a successful tool call.
3. Use Web search only when local evidence is absent, stale, incomplete, or conflicting. Record the query or explicit skip reason with `record_external`.
4. Inspect original sources. A Wiki page, search snippet, failed MCP call, or `browser_required` result is not verified evidence and not a successful retrieval.
5. Archive selected papers/manuals/software with traceable DOI, PMID, URL, version, commit, license, file hash, or equivalent provenance; verify the archive through `research_loop(action=verify_archive)`.
6. Bind explicit claim references, distinguishing Observed, Supported interpretation, Hypothesis, Unknown, Conflict, and Unverified; then finalize the evidence gate before summarization.
7. Subagents may gather bounded evidence, may query the paired Obsidian knowledge base read-only when `subagentMcpPolicy=read-local`, and may write only inside the active run directory. The parent session alone owns persistent Obsidian/Vault deposition through controlled write tools.
8. After a completed run, reusable workflow successes or failures may be compiled into WikiSkill. WikiSkill patterns are operational experience, never scientific authority.

Do not weaken evidence standards to make an answer, Wiki page, or Skill look successful. Never invent citations, downloads, tool calls, archive state, or validation scores.

For application-mode Wiki maintenance, first read current source notes and the target Wiki, then stage `research_propose_wiki_update`. The user reviews the exact change with `/obsidian-review`. A staged or user-approved synthesis is not independently verified scientific evidence. Never bypass this through the old Wiki builder, raw MCP, shell, or `research_deposit_knowledge(type=wiki)`. Source checks and final-answer validation remain separate from Wiki write approval.
