---
name: zotero-literature
description: Zotero literature manager. Use for Zotero 文献库 setup、zotero-cli search/read/annotations, and depositing interpreted Library/Papers notes into the Obsidian Vault. Bound command /zotero-setup. Zotero is not the knowledge base; MCP tool schemas are optional.
alwaysWith: research
---

# Zotero literature · not the Vault

Zotero stores papers, PDFs, metadata and annotations. Obsidian stores interpreted knowledge. `/obsidian-setup` / `research-vault` still own the Vault. This skill only connects literature identity to `Library/Papers` notes.

## Setup

**Bound entry:** `/zotero-setup` is from-zero setup. `/skill:zotero-literature setup` is the same skill. Do not re-run the launcher.

The host installs `zotero-mcp-server` after a native confirm (uv preferred, then pipx / `python -m pip`; if none exist it may first install uv via the official Astral script). It then registers the optional MCP server `zotero` in the user `mcp.json` (**disabled** by default). Do **not** bash `pip`/`uv` yourself and do not write Claude Desktop config. If the JSON reports `cancelled`, do not re-run the installer unless the user asks.

Human-only remaining steps (the host cannot click Zotero):

1. Install Zotero 7+ from https://www.zotero.org/download if the desktop app is missing, then start it.
2. **Settings → Advanced → Allow other applications on this computer to communicate with Zotero**.
3. Enable MCP later in Settings → MCP only if CLI is insufficient. Session reload is required after enabling.

Do not copy the Zotero library into the Vault. Do not promise semantic-search extras (`[semantic]` / `[pdf]`) unless the user asks.

## Preferred access: zotero-cli

If `research_zotero_status` reports `zoteroCli`, drive the installed CLI. Run `zotero-cli --help` once if flags are unknown. Typical shape (confirm against help):

- `zotero-cli search "<query>" --json`
- `zotero-cli --json get metadata <itemKey>` (confirm installed subcommand help)
- annotations / collections via the same CLI (`--json`)

Local mode needs Zotero desktop running. A failed local API is “Zotero is not reachable”, not “the paper does not exist”.

MCP `zotero_*` tools are optional and expensive (dozens of schemas). Use them only when the user enabled that server and CLI is unavailable.

## What to put in the knowledge base

The citable “原文” is a **literature note**, not the PDF:

1. Search Zotero; open the item; read metadata, annotations, and only the bounded fulltext needed.
2. `research_deposit_knowledge` with `type=paper`, `zotero_key` (8-character item key), optional `zotero_citekey`, DOI/`zotero:<key>` in `source_links`, and Markdown covering question, claims, methods, limits, short quoted excerpts.
3. Path is `Library/Papers/<slug>.md`. Update the managed block of an existing note instead of duplicating the same item.
4. `research_read_knowledge` that note before citing it. Publication still requires native Vault reads; Zotero CLI/MCP output is not a receipt.

Evidence and Wiki continue to use Vault paths. A Zotero hit cannot unlock `research_search_knowledge` or parent publication by itself.

## Claim evidence and dual-library acceptance

- Search results can contain fallback/unrelated records: normalize DOI (case, doi.org prefix) and compare the actual item DOI exactly. Zero exact matches is not absence if retrieval failed or was incomplete. Reuse one existing item; do not merge/delete pre-existing duplicates without permission.
- Before writing, inspect current library/collection and bound Vault. Check for an existing note by DOI and Zotero key, not only title. Preserve human sections. Re-read after an uncertain write before retrying.
- For every main claim, retain the original paper DOI, organism, actual section/figure/page read, method, result and limitation. State metadata-only/abstract-only explicitly. Wiki is orientation, not original-paper evidence.
- Authorized dual deposition has two separate steps: Zotero metadata plus legally open fulltext when available; then an interpreted `Library/Papers` note with DOI and `zotero:<key>` links. `research_archive_source` alone does not import into Zotero.
- The only Zotero write route is `research_zotero_save` (one item per call, exact DOI + verified metadata; optional `attachment_url` for a legally open PDF that Zotero downloads itself; `run_dir` to journal the receipt). The host dedups by DOI first (an existing item is reused, never duplicated), asks the user on a native card unless the authorized task plan already lists this DOI as a `zotero_item` milestone, writes once through Zotero desktop (connector, preferred) or the Web API (write-scoped `ZOTERO_API_KEY` from the environment), then reads back by DOI. Statuses `saved` / `reused` carry a `zoteroKey`; `unverified`, `failed`, `ambiguous`, `blocked`, `cancelled` do not — report them as-is and never call the tool again for the same DOI without new user direction.
- After `saved`/`reused`, continue with `research_deposit_knowledge type=paper zotero_key=<key>` and `research_verify_literature`; the desktop 产物 tab shows the merged DOI / Zotero key / Vault note / fulltext receipt, and `zotero_item` milestones show the read-back evidence in the 任务 tab.
- Call `research_verify_literature` after deposition/reuse and report each destination separately. Its read-only local-personal-library check cannot verify groups, cloud sync, PDF bytes, or scientific support; if those are required use the configured authenticated API and report the limitation.
- Cite the paper note next to its supported claim after `research_read_knowledge`. Give a compact claim → paper → location → support/limitation table, and a separate Zotero key / Obsidian path / fulltext / failure receipt table. Never disguise a partial destination as success.

## Boundaries

- PDFs stay in Zotero. Do not dump full-text PDFs or binary fetch payloads into Vault notes.
- Do not treat annotations as scientifically verified claims.
- Zotero writes require explicit user authorization and go through `research_zotero_save` only. The host verifies the selected personal library/collection is editable (connector) or that the environment key has write scope (Web API), sends only whitelisted metadata plus legal open attachment URLs, and reads back the exact DOI and key. Never write the Zotero database directly, never paste or invent credentials, never upload local files. If no authorized write route is available, report a blocked Zotero destination instead of claiming success.
- Subagents do not receive this setup/write path. The parent deposits paper notes.
