# Application knowledge service — first version

This is a local implementation snapshot, not a claim that the complete research/answer gate is shipped.

## Ownership and setup

Desktop startup sets `PERCHO_KNOWLEDGE_DIR` to its isolated application user-data `knowledge/` directory. `binding.json` is authoritative for the active Vault and policies. Project files retain results settings and a stable `knowledgeProjectId`, never a competing Vault override. Legacy project Vaults are reported but not silently adopted or migrated. CLI usage without this environment variable retains the older project configuration.

`/obsidian-setup` remains bound to `research-vault`. The write confirmation explicitly says the Vault serves the application and navigation will be supplied to the selected model. Existing human notes are not moved. Setup creates missing shared Wiki/Inbox navigation and optional project context. Application mode uses native indexed reads, not an automatically reconfigured raw MCP connection.

## Read path

The extension supplies a bounded source-data packet before model invocation: Home, Wiki index, current project Context and Index. Old copies are replaced in the context hook; a changed binding invalidates the packet. Opaque server-owned receipts bind reads/searches to the current Vault, project and navigation version. Related Wiki must be read before evidence search when navigation supplies Wiki links. Wiki-only discovery remains possible after navigation. All note content is untrusted source data, not executable instructions.

`research_read_knowledge` returns bounded line ranges, versions, truncation and Human review. `research_search_knowledge` searches shared and current-project indexed notes. It distinguishes ready/partial indexing, zero hits, failures and missing/oversized files. Search findings are not proof of factual correctness.

## Index and maintenance

A worker runs SQLite FTS5 with English tokens and explicit Chinese character/bigram tokens. Navigation/content are Markdown; SQLite is a rebuildable application-side index. Selective FTS matching is forced before per-note scope checks to avoid a scope-first join that probes FTS for every note. Watcher events coalesce by path; initial/periodic metadata reconciliation repairs missed events, while unchanged bodies are not reread. Watch failures and exclusions remain visible.

Controlled writes enqueue or update the changed note rather than rescanning the Library. Evidence can be searchable before Wiki synthesis. Navigation updates, evidence review and Wiki review are different jobs. Explicit bounded navigation maintenance preserves non-managed text, processes only the appropriate Wiki/Library/project entries, and does not invoke an LLM. New evidence and unprocessed reviews are disclosed. Semantic Wiki consolidation is not automatically performed by this implementation.

## Boundaries

- Native read/search and parent assistant prose publication are now guarded in application mode; see `knowledge-publication-gate.md`. Tool payloads, arbitrary custom extension output, OS access and full scientific claim entailment are not covered by this gate.
- Raw legacy MCP configurations remain unchanged. Other raw transports and old research tools are not fully unified behind this service.
- The default scope is shared knowledge plus the current project; arbitrary cross-project search is not exposed by these tools.
- Notes over 1 MiB, attachments, hidden/private files and symlinks are excluded or reported. This is not OCR/PDF/vector indexing.
- Human edits get optimistic version checks, not an operating-system editing lock. General external editor conflict resolution needs further hardening.
- Wiki dependencies currently track explicit internal links, not every possible Obsidian alias or a complete semantic dependency graph.
- Pending Wiki reviews are queued, not independently adjudicated; scientific source checks remain necessary.
- Same-version application sessions share a worker. Old pinned bindings can briefly retain idle workers, with a bounded pool. Reads/writes must not silently move into another Vault after a switch.
- SQLite is marked experimental by the pinned Node 22 runtime; test the actual packaged Electron runtime as well.

## Verification

`npm test` includes application ownership, incremental read counters, version/scope guards, maintenance preservation and real-SDK pre-model navigation tests. `node scripts/benchmark-knowledge.mjs 1000 10000` creates and removes synthetic fixture Vaults; it measures local navigation validation/index search, not model generation or network latency. `scripts/check-knowledge-package.mjs` verifies the exact electron-builder resource layout and can run under Electron with `ELECTRON_RUN_AS_NODE=1` without opening a GUI.

## Follow-up: peer-informed review (2026-09-11)

The native Wiki gate now checks non-empty reads of linked/discovered candidates against their current content versions. Search hits alone do not earn reads, and unrelated or stale Wiki reads cannot unlock evidence search. Navigation prompt packets exclude rapidly changing performance counters; diagnostics remain available through status tools.

Application Wiki updates now stage through `research_propose_wiki_update`. Source/target read receipts, binding revision, before/after content and source hashes are retained outside the Vault. Staging opens the desktop review dialog immediately; `/obsidian-review` is a user command that reopens that dialog and does not block the composer or the current model turn. The agent cannot approve. Both application direct Wiki deposition and the legacy Wiki writer are blocked. Successful user approval does not imply scientific validation. Proposals expire after 24 hours; pending count and content sizes are bounded. Archived review records retain the preimage but no one-click rollback is implemented.

The later native publication implementation is documented in `knowledge-publication-gate.md`; neither layer is an OS sandbox or a universal guard over arbitrary tool payloads. Optimistic checks do not eliminate an external editor write racing the final rename. Legacy raw transports and arbitrary host filesystem tools are not made safe by the proposal API. No unattended model consolidation loop is enabled. See `knowledge-agent-reference.md` for primary-source design comparisons and deliberately unadopted patterns.
