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

### MCP config dialects (pi-mcp-adapter 5.1.0)

The bundled runtime reads two file formats, and the enabled-state field differs:

| File | Format | Turn a server off | Hide tools |
|---|---|---|---|
| `~/.pi/agent/mcp.json`, project `.pi/mcp.json` | Pi's own `mcp.json` (translated by the adapter) | `"enabled": false` (remove it to enable). `disabled` is **ignored** — the server still starts | `"toolExposure": { "<tool>": "hidden" }` |
| project `.mcp.json`, `~/.config/mcp/mcp.json`, `mcp-adapter.json` | adapter format | `"disabled": true` | `"excludeTools": [...]` |

Pi-format files accept only `command`, `args`, `env`, `cwd`, `url`, `headers`, `description`, `enabled`, `timeout` (seconds), `exposure`, `toolExposure`, `oauth`, `auth`; anything else (`lifecycle`, `excludeTools`, `disabled`, …) is dropped with a startup notice. Settings → MCP and `/zotero-setup` write the right field for each file; on startup Drone rewrites legacy `disabled: true` in `~/.pi/agent/mcp.json` (written by builds up to v0.22.0) as `enabled: false`. A project `.pi/mcp.json` entry replaces the user entry of the same name as a whole, so never leave a `{ "disabled": … }`-only stub there.

`/zotero-setup` registers this user-level entry (off until enabled in Settings → MCP; `command` is the resolved absolute path, e.g. `C:\Users\<you>\.local\bin\zotero-mcp.exe` after `uv tool install zotero-mcp-server`):

```json
{
  "mcpServers": {
    "zotero": {
      "command": "C:\\Users\\<you>\\.local\\bin\\zotero-mcp.exe",
      "args": ["serve"],
      "env": { "ZOTERO_LOCAL": "true", "ZOTERO_LIBRARY_TYPE": "user", "ZOTERO_MCP_TOOLSETS": "none" },
      "description": "Zotero library: search/read items and full text, add items by DOI/URL/file, file into collections, attach PDFs",
      "timeout": 120,
      "toolExposure": {
        "zotero_delete_item": "hidden",
        "zotero_delete_collection": "hidden",
        "zotero_delete_annotation": "hidden"
      },
      "enabled": false
    }
  }
}
```

Credentials are not written into `mcp.json`: the MCP child inherits `ZOTERO_API_KEY` / `ZOTERO_LIBRARY_ID` (Settings → Zotero → Web API) or `ZOTERO_LOCAL_API_KEY` / `ZOTERO_LOCAL_SERVER_ID` (Zotero 10 local writes) from the host environment. `ZOTERO_LIBRARY_TYPE` is injected and written in pyzotero's singular spelling (`user` / `group`); pyzotero appends the "s" itself, so the plural value older builds injected produced `https://api.zotero.org/userss/<id>` (404) in zotero-mcp / zotero-cli. Drone's own Zotero channels accept both spellings. `.mcp.example.json` shows the adapter-format (`.mcp.json`) equivalent.

## Writing to Zotero

`research_zotero_save` is the only route that adds an item to Zotero, and it is host-controlled end to end:

| Step | Behaviour |
|---|---|
| Channel | Zotero desktop connector (`127.0.0.1:23119/connector/saveItems`) when Zotero is running and the local API is enabled; otherwise the Zotero Web API v3 with a **write-scoped** `ZOTERO_API_KEY` plus `ZOTERO_LIBRARY_ID` / `ZOTERO_USER_ID` (and `ZOTERO_LIBRARY_TYPE=group` for a group; `groups` is accepted too) from the host environment, or the key saved in Drone Settings → Zotero → Web API (stored in `agentDir/zotero-web.json`, injected into the same variables; a user-set environment variable wins). Credentials never come from chat or tool arguments. |
| Dedup | Exact-DOI lookup first (local API or Web API). One existing item ⇒ `reused`, no write. Several ⇒ `ambiguous`, no write. Incomplete lookup ⇒ `blocked`. |
| Consent | If the authorized, unchanged task plan lists the DOI as a `zotero_item` milestone, that consent covers the write. Otherwise a native ask card (same AskGate as `ask_user` and task authorization) shows title, authors, DOI, type, target library/collection, attachment mode and dedup result; only “同意写入 Zotero” writes. Headless sessions without task consent are refused. There is no standing “always allow” setting. |
| Write | Exactly one write. Metadata is whitelisted per item type (unknown fields are dropped, the DOI goes to `extra` for types without a DOI field). Attachments are URL-only here: the connector lets Zotero download `attachment_url` itself; the Web API records it as a `linked_url` attachment. Uploading a local PDF to an item is `research_zotero_update local_file`. |
| Read-back | The item is looked up again by DOI (up to four short attempts for the asynchronous desktop save) and its PDF children are counted. `saved` needs a single exact match; otherwise the receipt is `unverified` (`written-but-not-read-back`, `read-back-key-differs`) or `failed`. Nothing retries, deletes, merges or moves items. |
| Journal | With `run_dir`, the receipt is appended to `<run>/literature-operations.json` under `writes` (`literature-operations.mjs recordZoteroWrite`). |

## Changing an existing item

`research_zotero_save` never modifies an item that already exists (`reused`). Filing an existing item into a collection or attaching a PDF goes through `research_zotero_update`. The connector only creates items, and Zotero 7–9's local API on `127.0.0.1:23119/api` is read-only (`PATCH` → 501). Zotero 10 adds local write endpoints: a write must carry `Zotero-Server-ID` (the database id every local API response reports; missing ⇒ 428) and a local key (`Zotero-API-Key`; missing or revoked ⇒ 401). The local key has nothing to do with zotero.org keys: Zotero grants it through its own dialog in answer to `POST /api/local/authorize`.

| Step | Behaviour |
|---|---|
| Identify | `zotero_key`, or an exact DOI that matches exactly one item. Child attachments/notes are refused. |
| Channel | `local` when the user has authorized local writes and the saved key belongs to the running Zotero database (its server id matches); otherwise `web` with a write-scoped Web API key. A Web API key configured for a group library takes precedence, because the local channel writes the personal library. |
| Local authorization | Settings → Zotero → Local writes → *Authorize in Zotero*. Only an **Always Allow** grant (`remember: true`) is saved, to `agentDir/zotero-local.json` (0600) together with its server id, and injected as `ZOTERO_LOCAL_API_KEY` / `ZOTERO_LOCAL_SERVER_ID` (the names zotero-mcp uses). A one-time *Allow* key is not saved, because it expires after one write. A user-set `ZOTERO_LOCAL_API_KEY` wins. *Remove authorization* forgets Drone's copy; Zotero's own record is cleared under Zotero Settings → Advanced → Clear Write Authorizations. |
| Changes | `collection_key` or exact `collection_name` (added to the existing collections, never replacing them); `attachment_url` (linked URL child); `local_file` (a PDF inside the project, ≤ 100 MB, checked for the `%PDF-` header, uploaded through the file-upload protocol: over `local` it goes to Zotero's loopback receiver and stays on this computer; over `web` it is stored in the user's Zotero storage). Already-present collections, URLs and identical PDFs (same MD5) are skipped; nothing to do ⇒ `unchanged`. |
| Consent | A task plan naming the DOI as a `zotero_item` milestone covers it; otherwise the native ask card lists every change and only “同意修改该条目” writes. Headless sessions without task consent are refused. |
| Write | One `PATCH` with `If-Unmodified-Since-Version` (a concurrent edit returns 412 and nothing is overwritten), one child item per attachment. No deletes, no removal from collections, no retries. |
| Read-back | The item and its children are read again: `updated` (all verified), `partial`, `unverified` or `failed`, per change. |
| Not configured | `blocked` with the reason; the agent tells the user to authorize local writes (Zotero 10+) or add a write-enabled key in Settings → Zotero, and never asks for a key in chat. A saved local key whose server id no longer matches (the Zotero data directory changed) is not used, and the reason says to authorize again. |

The desktop context panel shows the result: the 产物 tab lists one literature receipt per DOI (Zotero status + key, Vault note path, fulltext status, open in Zotero via `zotero://select/library/items/<key>`, open note, DOI page); the 任务 tab shows the read-back evidence under each `zotero_item` milestone. Task milestones are reconciled by the desktop local API first and the Web API second (`createCompositeZoteroReconciler`). Subagents (`PI_SUBAGENT_CHILD=1`) do not receive the tool.

## Publication boundary

Unchanged: parent prose is published only after current-turn native Vault navigation/search/reads. Zotero CLI/MCP output never mints a read or evidence receipt. After reading a paper in Zotero, deposit (or update) the literature note and `research_read_knowledge` that note before citing it in a knowledge-checked answer.

Wiki proposals still require actual Vault source paths. A `zotero:` link in a paper note is provenance, not a substitute for a current Vault read.

## Setup

- Drone `/zotero-setup` (skill `zotero-literature`): confirm → install `zotero-mcp-server` if missing → register optional MCP (disabled).
- User still installs/starts Zotero 7+ and enables the local-API checkbox. The host cannot click that setting.
- Knowledge UI explains the split and launches the same command. `/obsidian-setup` still owns the Vault.
