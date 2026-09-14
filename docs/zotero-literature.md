# Zotero literature and Obsidian knowledge

Zotero is the literature manager. Obsidian remains the knowledge base. They are not substitutes.

## Ownership

| Store | Owns | Does not own |
|---|---|---|
| **Zotero** | Bibliographic identity (item key, DOI, citekey), PDFs/EPUBs, collections, tags, native annotations | Wiki, claims, project evidence chains, topic memory, publication |
| **Obsidian Vault** | Interpreted `Library/Papers` notes, evidence, claims, Wiki, Inbox, topic memory | Binary attachments, a dump of the Zotero library, unpublished MCP/CLI payloads |

The knowledge-service index still excludes attachments, hidden files, symlinks and notes over 1 MiB. A PDF in Zotero is not a Vault evidence receipt.

## What “original text” means here

The original *document* stays in Zotero. The original *knowledge object* that Percho can cite is a bounded Markdown literature note:

- Path: `Library/Papers/<slug>.md` (`research_deposit_knowledge` `type=paper`)
- Frontmatter identity: `type: paper` plus optional `zotero_key` / `zotero_citekey`
- Body: question, claims, methods, limits, and short excerpts from annotations or selected fulltext
- Sources: DOI, official URL, `zotero:<itemKey>`, and/or a Vault `[[Library/Papers/...]]` note

A download, Zotero search hit, MCP tool result, or unread PDF is a source record, not comprehension and not a published answer.

## Agent access

[zotero-mcp](https://github.com/54yyyu/zotero-mcp) exposes two routes that share one install (`zotero-mcp-server`) and one config:

1. **Preferred: `zotero-cli` + first-party skill `zotero-literature`.** Shell-capable Percho sessions load a small skill instead of 30+ MCP tool schemas on every request.
2. **Optional: MCP server `zotero`.** `/zotero-setup` can register it in the user `mcp.json` **disabled by default**. Enable it in Settings → MCP only when the CLI path is insufficient. Lazy External Apps still gates MCP tools.

`/zotero-setup` can install `zotero-mcp-server` from zero after a native confirm (uv, pipx, or `python -m pip`; otherwise the official uv script). It does not install Zotero desktop, does not write Claude Desktop config, and does not copy the library into the Vault.

## Publication boundary

Unchanged: parent prose is published only after current-turn native Vault navigation/search/reads. Zotero CLI/MCP output never mints a read or evidence receipt. After reading a paper in Zotero, deposit (or update) the literature note and `research_read_knowledge` that note before citing it in a knowledge-checked answer.

Wiki proposals still require actual Vault source paths. A `zotero:` link in a paper note is provenance, not a substitute for a current Vault read.

## Setup

- Percho `/zotero-setup` (skill `zotero-literature`): confirm → install `zotero-mcp-server` if missing → register optional MCP (disabled).
- User still installs/starts Zotero 7+ and enables the local-API checkbox. The host cannot click that setting.
- Knowledge UI explains the split and launches the same command. `/obsidian-setup` still owns the Vault.
