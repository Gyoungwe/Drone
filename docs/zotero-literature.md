# Zotero literature and Obsidian knowledge

Zotero is the literature manager. Obsidian remains the knowledge base. They are not substitutes.

## Ownership

| Store | Owns | Does not own |
|---|---|---|
| **Zotero** | Bibliographic identity (item key, DOI, citekey), PDFs/EPUBs, collections, tags, native annotations | Wiki, claims, project evidence chains, topic memory, publication |
| **Obsidian Vault** | Interpreted `Library/Papers` notes, evidence, claims, Wiki, Inbox, topic memory | Binary attachments, a dump of the Zotero library, unpublished MCP/CLI payloads |

The knowledge-service index still excludes attachments, hidden files, symlinks and notes over 1 MiB. A PDF in Zotero is not a Vault evidence receipt.

## What “original text” means here

The original *document* stays in Zotero. The original *knowledge object* that Drone can cite is a bounded Markdown literature note:

- Path: `Library/Papers/<slug>.md` (`research_deposit_knowledge` `type=paper`)
- Frontmatter identity: `type: paper` plus optional `zotero_key` / `zotero_citekey`
- Body: question, claims, methods, limits, and short excerpts from annotations or selected fulltext
- Sources: DOI, official URL, `zotero:<itemKey>`, and/or a Vault `[[Library/Papers/...]]` note

A download, Zotero search hit, MCP tool result, or unread PDF is a source record, not comprehension and not a published answer.

## Agent access

[zotero-mcp](https://github.com/54yyyu/zotero-mcp) exposes two routes that share one install (`zotero-mcp-server`) and one config:

1. **Preferred: `zotero-cli` + first-party skill `zotero-literature`.** Shell-capable Drone sessions load a small skill instead of 30+ MCP tool schemas on every request.
2. **Optional: MCP server `zotero`.** `/zotero-setup` can register it in the user `mcp.json` **disabled by default**. Enable it in Settings → MCP only when the CLI path is insufficient. Lazy External Apps still gates MCP tools.

`/zotero-setup` can install `zotero-mcp-server` from zero after a native confirm (uv, pipx, or `python -m pip`; otherwise the official uv script). It does not install Zotero desktop, does not write Claude Desktop config, and does not copy the library into the Vault.

## Writing to Zotero

`research_zotero_save` is the only route that adds an item to Zotero, and it is host-controlled end to end:

| Step | Behaviour |
|---|---|
| Channel | Zotero desktop connector (`127.0.0.1:23119/connector/saveItems`) when Zotero is running and the local API is enabled; otherwise the Zotero Web API v3 with a **write-scoped** `ZOTERO_API_KEY` plus `ZOTERO_LIBRARY_ID` / `ZOTERO_USER_ID` (and `ZOTERO_LIBRARY_TYPE=groups` for a group) from the host environment. Credentials never come from chat or tool arguments. |
| Dedup | Exact-DOI lookup first (local API or Web API). One existing item ⇒ `reused`, no write. Several ⇒ `ambiguous`, no write. Incomplete lookup ⇒ `blocked`. |
| Consent | If the authorized, unchanged task plan lists the DOI as a `zotero_item` milestone, that consent covers the write. Otherwise a native ask card (same AskGate as `ask_user` and task authorization) shows title, authors, DOI, type, target library/collection, attachment mode and dedup result; only “同意写入 Zotero” writes. Headless sessions without task consent are refused. There is no standing “always allow” setting. |
| Write | Exactly one write. Metadata is whitelisted per item type (unknown fields are dropped, the DOI goes to `extra` for types without a DOI field). Attachments are URL-only: the connector lets Zotero download `attachment_url` itself; the Web API records it as a `linked_url` attachment. Local files are never uploaded. |
| Read-back | The item is looked up again by DOI (up to four short attempts for the asynchronous desktop save) and its PDF children are counted. `saved` needs a single exact match; otherwise the receipt is `unverified` (`written-but-not-read-back`, `read-back-key-differs`) or `failed`. Nothing retries, deletes, merges or moves items. |
| Journal | With `run_dir`, the receipt is appended to `<run>/literature-operations.json` under `writes` (`literature-operations.mjs recordZoteroWrite`). |

The desktop context panel shows the result: the 产物 tab lists one literature receipt per DOI (Zotero status + key, Vault note path, fulltext status, open in Zotero via `zotero://select/library/items/<key>`, open note, DOI page); the 任务 tab shows the read-back evidence under each `zotero_item` milestone. Task milestones are reconciled by the desktop local API first and the Web API second (`createCompositeZoteroReconciler`). Subagents (`PI_SUBAGENT_CHILD=1`) do not receive the tool.

## Publication boundary

Unchanged: parent prose is published only after current-turn native Vault navigation/search/reads. Zotero CLI/MCP output never mints a read or evidence receipt. After reading a paper in Zotero, deposit (or update) the literature note and `research_read_knowledge` that note before citing it in a knowledge-checked answer.

Wiki proposals still require actual Vault source paths. A `zotero:` link in a paper note is provenance, not a substitute for a current Vault read.

## Setup

- Drone `/zotero-setup` (skill `zotero-literature`): confirm → install `zotero-mcp-server` if missing → register optional MCP (disabled).
- User still installs/starts Zotero 7+ and enables the local-API checkbox. The host cannot click that setting.
- Knowledge UI explains the split and launches the same command. `/obsidian-setup` still owns the Vault.
