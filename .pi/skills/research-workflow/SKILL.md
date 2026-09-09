---
name: research-workflow
description: Bounded personal research workflow for Percho: local knowledge first, Web fallback, evidence verification, and parent-session-only knowledge writes.
---

# Research Workflow

Use this skill for substantive research requests, literature discovery, source comparison, and evidence-backed technical investigation.

1. Check the current workspace, bound Vault, MCP status, loaded skills, and loaded extensions.
2. Search the local Vault and Zotero first. Preserve the exact query and source identifiers.
3. Use `web_search`/`fetch_content` only when local evidence is absent, stale, incomplete, or conflicting.
4. Ask subagents for bounded evidence and reports. Their files belong under the active run directory only.
5. Inspect original sources and record DOI, PMID, URL, version, commit, or file hash where available.
6. Mark claims as Observed, Supported interpretation, Hypothesis, Unknown, Conflict, or Unverified.
7. The parent session reviews evidence before writing Obsidian or Zotero. Never let a child session write the main Vault.

Failed MCP calls, browser challenges, missing full text, and unresolved conflicts are explicit non-success states. Do not present them as verified findings.
