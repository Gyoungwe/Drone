# Changelog

## 0.8.1 — 2026-09-16

- Research answers are written for the researcher: the recommendation and its key reasons come first, decisions the user must make come second with defaults, and run directories, hashes, wiki links and failed downloads are collapsed into a final `依据与记录` section. Evidence and publication rules are unchanged.
- Task workbench reason codes (for example `stage-budget`, `reconcile-before-retry`) are shown as plain-language explanations with the next step, in the host status card and the Desktop task card.
- When a stage budget is reached the model is told to answer from what it already has and point the user to the task panel instead of ending abruptly.

## 0.8.0 — 2026-09-16

- Added the structured task workbench (`.pi/lib/tasks/workbench.mjs`, `register.mjs`): model-proposed milestones with dependencies require explicit user approval; acceptance is only satisfied by host file readback, scoped human review, Wiki review records or read-only Zotero item identity. Human-review waits resolve only their own action, and the durable ledger is restored on restart without replaying unknown side effects. The v0.7.8 runtime remains available with `PERCHO_TASK_WORKBENCH=off`.
- Added cross-task selection: continuation phrases with several open tasks require an explicit choice; task switches cannot steal in-flight operations.
- Added task archiving: a closed or paused task with no unknown effects and no pending user actions can be archived from the task panel; archived tasks never resume and the oldest archived task is the only thing dropped when task history is full. Open tasks are never discarded.
- Added host-side evidence recovery, isolated PDF identity extraction (pdf.js in a bounded worker; title/DOI checked, never extension alone) and read-only Zotero reconciliation (item counts never become import completion).
- Added the Desktop `TaskWorkbenchCard`, a read-only LAN task card projected from the same `taskView`, and shared `task-workbench` / `evidence-labels` types.
- Fixed the PDF worker on Windows: pdf.js requires a trailing-slash file URL for `standardFontDataUrl`, and `destroy()` now falls back to the loading task for pdf.js v6.
- Fixed the knowledge UI smoke script shadowing the module-level `actions` array with a task-scoped one.

## 0.7.8 — 2026-09-16

- Task checkpoints and safe continuation for generic research tasks; see `docs/releases/v0.7.8.md`.

## 0.7.7 — 2026-09-16

- Fixed Windows test fixtures to use native temporary paths and platform-appropriate file mode assertions without weakening production path handling.
- Fixed knowledge worker shutdown to drain scans, requests, and dirty-file batches before closing SQLite; concurrent closes now wait for the same worker exit.
- Fixed reconciliation returning while a follow-up directory scan was still running.
- Added SQLite lifecycle regression tests and bounded Windows backend test concurrency.
- Enforced LF source checkouts with Git attributes and corrected formatting errors.
- Added Windows CI coverage and mandatory Windows/Linux validation before preparing a release.

## 0.7.6 — 2026-09-16

- Fixed session export saving the generated file path instead of its contents.
- Fixed cancelled requests being reported as failed knowledge checks.
- Fixed Windows path normalization for channel self-write suppression and permission patterns.
- Fixed incremental semantic indexing, matched-chunk hydration, and Windows SQLite cleanup.
- Updated knowledge UI smoke coverage for the combined knowledge and Zotero setup flow.

## 0.7.5 — 2026-09-16

- Fixed the About page update flow so an available release can be downloaded in-app instead of triggering another check.
- Added explicit download-update labels in the Chinese and English UI.

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
