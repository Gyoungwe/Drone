---
name: research-workflow
description: Bounded personal research workflow for Percho: local knowledge first, Web fallback, evidence verification, and parent-session-only knowledge writes.
---

# Research Workflow

Use this skill for substantive research requests, literature discovery, source comparison, and evidence-backed technical investigation.

1. Create a persistent run with `research_loop(action=start)` and preserve the exact research question.
2. Query the project Research Wiki only as navigation memory, then search the paired local Vault and Zotero. Record the exact local query with `research_loop(action=record_local)`.
3. Use Web search only when local evidence is absent, stale, incomplete, or conflicting. Record the query or explicit skip reason with `record_external`.
4. Inspect original sources. A Wiki page, search snippet, failed MCP call, or `browser_required` result is not verified evidence and not a successful retrieval.
5. Archive selected papers/manuals/software with traceable DOI, PMID, URL, version, commit, license, file hash, or equivalent provenance; verify the archive through `research_loop(action=verify_archive)`.
6. Bind explicit claim references, distinguishing Observed, Supported interpretation, Hypothesis, Unknown, Conflict, and Unverified; then finalize the evidence gate before summarization.
7. Subagents may gather bounded evidence and write only inside the active run directory. The parent session alone owns Obsidian/Vault writes and final knowledge deposition.
8. After a completed run, reusable workflow successes or failures may be compiled into WikiSkill. WikiSkill patterns are operational experience, never scientific authority.

Do not weaken evidence standards to make an answer, Wiki page, or Skill look successful. Never invent citations, downloads, tool calls, archive state, or validation scores.
