# Changelog

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

### Validation

See [`docs/releases/v0.7.0.md`](docs/releases/v0.7.0.md) and [`docs/p5-p10-acceptance.md`](docs/p5-p10-acceptance.md). This entry describes the local 0.7.0 release candidate; public tag/Release publication is a separate step.

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
