# Knowledge UI — desktop integration

Implementation snapshot: 2026-09-12. This is source/build status, not an installed application update.

## Surfaces

- **Settings → Knowledge**: application Vault, independent project identity, profile/deposition/subagent policies, index coverage and counters, legacy project binding warning, open-folder action, native directory selection, read-only directory/template preview, and the existing `/obsidian-setup` / `research-vault` interview entry. Configuration does not introduce a second wizard or silently change the Vault.
- **Chat knowledge card**: host-produced navigation, Wiki read, search and publication stages; expandable file/line/version records; direct human note viewing; maintenance and explicit model-continuation actions after a block. User note reads do not grant model receipts. State is per-session and bounded to 64 live sessions. It is not retroactive certification of older history.
- **Wiki review panel**: paged candidate summaries, on-demand exact preview, bounded linear diff, before/after views, protected human content, source versions and reads, expiry/target/source conflict indicators, explicit acknowledgement, apply/reject/cancel. Preview tokens are single-use, project/binding-specific and expire after ten minutes. The underlying version checks still run at decision time.
- **Index & maintenance**: paged jobs, visible unreadable/oversized/excluded problems, explicit inventory reconciliation and separately confirmed managed navigation refresh. No semantic Wiki rewrite or model invocation is started by these controls.

## Wiring and performance

`packages/shared/src/knowledge.ts` defines the UI protocol; `packages/backend/src/knowledge/ui.ts` loads the shipped runtime; `.pi/lib/knowledge/ui-service.mjs` exposes bounded human-facing host operations. The production preload and desktop IPC routes use these APIs rather than asking a model to query state. Child frames and non-application windows are rejected by the IPC handlers. Approval is not exposed as a model tool.

Host stage events contain paths and versions, not hidden reasoning or unvalidated draft text. File-change invalidations are coalesced; mounted unfinished-index panels use low-frequency status reads, not full scans. Candidate bodies and note content load only when selected. The diff uses a linear contiguous-hunk algorithm rather than a quadratic full-document comparison; it is accurate but not guaranteed to be a minimal edit script.

`ctx.ui.notify` is now forwarded in main desktop sessions. `/obsidian-review` opens the dedicated desktop panel when the UI bridge is connected; the generic Ask fallback remains for other interactive hosts. The new native read/search/propose/maintenance tools also have activity labels in the shared transcript reducer.

## Verification

- Full suite: backend 599 tests, desktop 345 tests (944 total), all passed.
- All workspace type checks and desktop build passed.
- `node scripts/check-knowledge-ui.mjs` renders the real components in an isolated Electron process with the real knowledge host APIs and actual production preload/IPC code.
- Graphical smoke passed overview, directory/template preview, maintenance pagination/reconciliation, Wiki diff/protected content/source reads, disabled approval before acknowledgment, command-to-panel routing, Escape close, host read/search/publication phases, dark theme and 520-pixel layout without horizontal document overflow.
- Graphical smoke intentionally stops before clicking any write approval. Apply/reject and changed-source/target/binding paths are covered by isolated backend tests; final user confirmation is not clicked by the graphical script.
- The folder picker supplies a scripted selection in the fixture; setup/resume model invocation is intercepted. No real provider, credentials, user Vault or installed app is touched.

## Boundaries

The dedicated management/review surfaces are desktop UI, not a new LAN approval API. Live phase state is bounded and not a durable per-turn audit timeline. GUI testing is component/IPC integration in Electron, not a manual run through a real model-backed setup interview. Human confirmation is not scientific validation; optimistic filesystem checks are not an OS editing lock or a sandbox for arbitrary tools.
