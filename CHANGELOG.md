# Changelog

## 0.7.4 — 2026-09-16

- Zotero gets a dedicated UI panel with its own sidebar entry (next to Obsidian): live status, an enable/disable toggle for the Zotero MCP server, one-click connect/install, and open Zotero/docs — backed by a new read-only `getZoteroStatus` IPC.
- Obsidian and Zotero setup are untangled: the Obsidian setup button is Vault-only (the combined `includeLiterature` path is removed), with cross-reference guidance to the Zotero panel.
- Knowledge gate now circuit-breaks a runaway tool-loop far earlier (per-turn tool-round cap) and replaces the misleading "知识库检查未通过 … 请开启新一轮任务" with an accurate, actionable notice.

## 0.7.3 — 2026-09-15

- Internal architecture deepening (no user-facing behaviour change): shared `optimisticUpdate` helper for renderer store mutations; single `INVOKE_ROUTES` source of truth generating the preload invoke surface and sessions IPC registrar (mapping byte-identical to v0.7.2).
- Knowledge publication fail-closed projection is drift-safe (neutralizes by event shape, not an enumerated type list) and its bridge-absent fallback is now tested.
- Knowledge gate stage progress derived once in the backend flow and rendered verbatim; running-state `phase` seam type-locked and `agentActive` reads unified behind `useAgentActive`.

## 0.7.1 — 2026-09-13

- Default mode asks before edit/write (approval dock).
- UI plugin enable state persists; builtin one-click enable.
- Vault/AskDialog submit hang fixed; Knowledge tool-loop budget.
- Linux install docs, Scout docs, empty-model CTA, EPIPE log quieting.


## 0.7.0 — 2026-09-13

### Added

- Opt-in hybrid FTS + semantic knowledge retrieval with Ollama/OpenAI-compatible embedding adapters, bounded incremental SQLite vector indexing, configurable minimum similarity, and Desktop management UI.
- Versioned project-scoped topic memory with exact/unique resume, bounded continuation context, stale-source detection, lifecycle receipts, and explicit archive controls.
- Deterministic specialist orchestration receipts and bounded per-turn/session run, queue, tool, token, and reported-cost budgets.
- P5–P10 regression tooling: 20/50-turn synthetic replay, orchestration stress fixture, production-pipeline semantic benchmark, release gate, actual packaged-resource audit, and isolated packaged-app first-launch smoke.
- Run Inspector retrieval/fallback/stop diagnostics on Desktop and LAN without exposing private chain-of-thought.

### Changed

- Semantic hits remain navigation candidates only: current parent reads and the existing publication gate are still required before evidence-backed answers.
- Specialist usage accounting now preserves which fields the provider actually reported; missing cost/token fields remain unknown rather than being inferred as free or zero.
- Session usage refreshes at committed response boundaries, and replayed response/tool IDs are deduplicated in usage and Run Inspector projections.
- The research-workbench package manifest now audits topic-memory tools in packaged builds.

### Fixed

- Permission config loader cache key is now `mtimeMs + size`, so a same-millisecond rewrite of `permissions.json` invalidates stale ask rules and loads deny overlays correctly.

### Validation

See [`docs/releases/v0.7.0.md`](docs/releases/v0.7.0.md) and [`docs/p5-p10-acceptance.md`](docs/p5-p10-acceptance.md).

## 0.6.0 — 2026-09-12

### Added

- Application-wide Obsidian knowledge service with guided setup, indexed retrieval, maintenance UI, and project-aware scoping.
- Evidence-aware publication checks with explicit source/version receipts and user-visible blocker recovery.
- Human Wiki review plus isolated, user-triggered model-assisted review with optional exact-candidate auto-apply.
- Protected knowledge specialists for navigation, evidence comparison, Wiki drafting, Show Me explanation, and Wiki review.
- Multi-round topic candidate accumulation and presentation-only Show Me archiving in the knowledge library.
- Ordered public execution summaries around tool batches, without exposing raw private chain-of-thought.
- Per-turn/session SDK token and cache usage UI plus independent Wiki-review usage receipts.
- Versioned research-workbench manifest and first-party `research-show-me` fallback for packaged installs.

### Changed

- Research source/software/manual delivery now records stronger provenance and separates metadata, readable evidence, presentation artifacts, and scientific claims.
- Sidebar Obsidian entry now matches Settings/Help hit targets and includes a visible label.
- Public repository, update, release, issue, and security links now target `Gyoungwe/percho` while preserving original author attribution.
- Repository Biome checks were normalized so lint, typecheck, tests, and build can pass the release gate.

### Validation

See [`docs/releases/v0.6.0.md`](docs/releases/v0.6.0.md) for release-specific capability boundaries and validation notes.
