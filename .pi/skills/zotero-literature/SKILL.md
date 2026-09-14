---
name: zotero-literature
description: Zotero literature manager. Use for Zotero 文献库 setup、zotero-cli search/read/annotations, and depositing interpreted Library/Papers notes into the Obsidian Vault. Bound command /zotero-setup. Zotero is not the knowledge base; MCP tool schemas are optional.
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
- `zotero-cli get <itemKey> --json`
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

## Boundaries

- PDFs stay in Zotero. Do not dump full-text PDFs or binary fetch payloads into Vault notes.
- Do not treat annotations as scientifically verified claims.
- Write operations in Zotero (add-by-DOI, tags) need an explicit user request and hybrid/web API credentials; default local API is read-oriented.
- Subagents do not receive this setup/write path. The parent deposits paper notes.
