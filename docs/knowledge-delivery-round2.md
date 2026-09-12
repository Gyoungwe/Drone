# Knowledge delivery and visibility fixes — 2026-09-12

Baseline commit: `ac1c144` (shared knowledge, publication guard, desktop UI and skill catalog). Downloaded research files and per-project user state were excluded. This iteration is not committed yet.

## Reproduced causes

The user-facing transcript reducer consumed deltas but not authoritative assistant `message_end` / `turn_end` content. The publication boundary deliberately withholds deltas. A completed, released answer could therefore exist in session JSONL while the live transcript stayed empty. Tests now take real backend/SDK events and feed the actual shared renderer reducer, not merely assert backend persistence.

An initialization-only final reply was treated like a research assertion requiring citations. The controlled setup writer now provides a single-use operational receipt. The publication hook renders a fixed configuration completion message from that receipt; arbitrary model prose is not whitelisted. Ordinary later turns still require their own research receipts. Empty terminal text becomes a host notice instead of silent completion.

Run summarization captured the process/extension working directory. It now uses the actual tool context cwd, retains lexical and realpath containment checks, and distinguishes a saved local summary from a failed Vault/index update.

## UI and content delivery

- The flow card shows bounded matched titles/excerpts, paths/versions and a bounded list of download/note/summary/proposal outcomes. These come only from whitelisted tool results. They are not hidden reasoning, proof of comprehension or scientific validation. UI source browsing still grants no model read receipt.
- The large management label is removed from the flow card. An icon-only Obsidian entry sits immediately below Settings in the project/sidebar navigation.
- Directory/template preview works without entering a new path: use the bound Vault when available, and always return the real built-in profile layout and note template contents. Preview has no initialization writes.
- Vault `[[...]]` links render as clickable note links in chat and note previews. Code examples remain unchanged. Link display does not modify stored assistant text. Source deposition normalizes valid DOI/HTTP/Vault/local-results references, while unresolved identifiers remain explicit non-links. Source records display online provenance outside their JSON metadata.
- Archived HTML manuals carry a bounded heuristic coverage note and same-site chapter candidates. A landing/TOC page is never certified as a full manual. No recursive network crawl is enabled.
- Matching tasks receive a source-grounded delivery contract: version-specific CLI commands/options/examples for manuals, principle and properly separated benchmark evidence for software, claims/methods/evidence/limits for papers. The loaded show-me skill is requested within the current task, with honest Markdown fallback if unavailable. This is orchestration guidance, not proof that a live model created an explainer or ran performance tests.

## Inspection of the user's existing test

The inspected run contains three paper PDFs and two software documentation HTML pages. The latter are a MUSCLE manual entry/TOC and a MAFFT overview with links to reference chapters, not a complete version-matched CLI handbook. Source records and a method note exist in Library; there was no synthesized topic Wiki. The method note's source list used bare workspace-relative file paths. This is not an inability to store commands in Markdown. No new paper interpretation, manual chapter download, or performance measurement was invented to fill these gaps.

Existing downloaded files and note prose are left unchanged by this code iteration. Future controlled writes use normalized links; rendering improvements make existing Vault links usable. For legacy bare results paths in a note owned by the current project, the human reader resolves existing files and adds display-only hyperlinks, with an explicit workspace label. The on-disk Markdown is unchanged; another project does not guess the old workspace. Persisted link repair still requires a scoped update, not a silent whole-Vault migration.

## Validation scope

Unit/backend tests exercise final-only display, setup receipts, workspace containment, summary partial failure, template-only preview, source link validation, manual coverage, delivery routing and bounded findings. The isolated Electron smoke uses real components and knowledge APIs; it never approves a real Vault edit or contacts a model provider. A live cloud-model manual/explainer task and actual software benchmarking remain separate acceptance tests.

Final validation: 982 workspace tests passed (backend 625; desktop 357). Type checks and isolated desktop build passed. Real Electron component/IPC checks passed, including title/excerpt display, template-only preview, actual Wiki-link navigation and narrow/dark layout. Final Electron package-resource smoke passed. No running user application was restarted.
