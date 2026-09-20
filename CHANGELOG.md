# Changelog

## Unreleased

- `research_archive_source` can now archive a paper from its DOI (or PMCID / PMID) alone: the host resolves a **legitimate open-access** PDF through Europe PMC (rendered PDF for OA / Europe PMC articles), the PMC Open Access subset, Unpaywall (`DRONE_CONTACT_EMAIL` / `UNPAYWALL_EMAIL`), OpenAlex, Semantic Scholar and Crossref, tries the candidates in trust order, keeps only real PDF bytes, and records every source queried (`.pi/lib/open-access.mjs`). A given `url` that fails (HTML landing page, 404, login wall) falls back to the same resolution when a DOI is known. When no lawful copy exists the tool answers `status=no_open_access` with the sources queried, the publisher hand-off if one asked for a login, and a manual-import path that respects the user's own access rights (browser download → `.pi/browser-downloads` → `local_file` + `human_verified=true`); it never touches Sci-Hub or other pirate mirrors, and the skill docs say so explicitly.
- Capability routing no longer resets in the middle of an approved task: any message while the current task is approved and unfinished restores the checkpoint and only adds newly detected capabilities, and short replies to host prompts (启动了 / 装好了 / 好的 / ok …) count as continuations even without a task. Previously a reply such as “启动了” cleared the tool set to the control tools and forced an extra `capability_load` round.
- `zotero_item` milestones no longer need the DOI at plan time: a successful `research_zotero_save` receipt (saved / reused, host read-back key) is bound by the host to the first DOI-less `zotero_item` milestone (`milestone.bound`, approved contract and its hash untouched) and verified by read-back at the next reconcile; DOI-less milestones show as pending instead of blocked. Verifiers may declare the new optional `identify(event, details)` hook (`docs/extension-hooks.md`, hook 2). When the planned or bound DOI turns out to be the wrong paper, `task_wait kind=rebind` (`milestoneId` + `doi` + `reason`) opens the same confirmation card with old → new DOI; only the user's approval rebinds it, and a rebind-approved DOI counts as plan-named for Zotero write consent. The evidence example task now asks for one `zotero_item` milestone per read paper with the DOI left empty.

## 0.11.0 — 2026-09-20

- Typing `@` at the start of a message now offers the session's subagents ahead of project files (drone avatars, source badge, untrusted project definitions greyed out). Picking one turns it into a chip; the text after it is the task and Enter dispatches it straight into the session — the same single-task dispatch as the Subagents panel form (`subagents:dispatch`, followUp on, session cwd, no required tools), never through the main model. `@` further into the text, inside a `/` command, on a draft or read-only session, or after a chip is already set keeps behaving exactly as before (files only); a chip suppresses the `/` menu. Esc, Backspace on empty text and the chip's × undo it back to `@name `; a rejected dispatch restores the whole draft with the reason in the send error bar. Project-level definitions still require the per-dispatch trust checkbox, so picking one jumps to the panel form with the agent preselected. See `docs/subagents-panel.md` (输入框 `@` 派发).
- Added a 子智能体 (Subagents) tab to the context panel: it lists the subagents the current session can use (built-in `scout`, user `~/.pi/agent/agents`, project `.pi/agents` — project definitions of an untrusted project are shown but cannot be dispatched), dispatches up to eight tasks straight into the session (required tools restricted to the agent's toolset, optional stage contract from the workflow catalog appended to the task, working directory, per-dispatch trust checkbox for project definitions, followUp on by default) and tracks every run in this session through 排队中 / 运行中 / 需要回复 / 等待审批 / 完成 (待 / 已进入上下文) / 失败 / 已中止 with cancel, abort, steer, reply, cite, replay and dispatch-again. Dispatch uses the same `runSubagent` path as the model's `subagent` tool (permission gate, mutex, `required_tools`, run slots), so queueing beyond `maxConcurrentSubagents` and approvals behave exactly as before; the approval dock now shows which subagent a request comes from and can jump to that run. Finished runs hand a summary to the main model as a followUp (queued while it is generating; the card flips to 已进入上下文 once consumed) or, with followUp off, stay as a result card you can cite into the composer. Subagents got a face: a drone avatar coloured by name hash with a source badge whose expression follows the run state (pure CSS, still under reduced motion). See `docs/subagents-panel.md`.
- Added a 权限 (Permissions) panel to Settings that edits the global `~/.pi/agent/permissions.json` visually: workspace boundary (reads / writes outside every workspace root, the system temp zone, in-project auto-approval), per-tool rules with the `bash` pattern table as an ordered list (move up / down, add, remove, evaluation order = list order, last match wins), a dry run that shows which pattern a command would hit against the unsaved draft, the last 20 audit entries, restore defaults and open file location. The four self-protection patterns (`*permissions.json*`, `*workspaces.json*`, `*auth.json*`, `*trust.json*`) are pinned to the end of the table and cannot be relaxed or removed; the backend re-validates on save (actions, no numeric keys, self-protection present and not overridden), refuses to overwrite a file modified outside the page unless asked to, writes atomically (`tmp` + rename, `.bak` kept) and never touches `enabled`. Saved rules apply from the next tool call. `parseConfig` now reads an explicit `autoApproveProjectEdits` boolean (derivation stays as fallback). See `docs/permissions-settings.md`.
- Added six built-in example tasks, one per workflow direction (planning → hypotheses, evidence → literature and evidence cards, analysis → data quality and tests, writing → one section plus review, presentation → figures and slides, engineering → resource inventory and handoff). They appear as cards in the empty 任务 tab and as an “Example: …” row at the end of each direction in the `/` menu; a small dialog collects the inputs (required fields, native file/folder pickers, read-only milestone preview and the confirmations to expect) and then sends one ordinary first message — `/skill:… ` plus goal, inputs, a `task_plan` request with numbered milestones and the stage boundary — through the same path as the composer. Examples never pre-create a task, write a file or run anything; `task_plan` and the authorization card stay the only entry. Data lives in `packages/shared/src/example-tasks.json` (`docs/example-tasks.md` explains how to add one).
- Release builds ship the Academic Research Skills pack under its own CC BY-NC 4.0 NonCommercial grant: the Release workflow acquires the three pinned packs before packaging and records `licenseAuthorization: noncommercial` for ARS, and the release preflight accepts that basis instead of demanding a separately held permission the project does not hold. Drone is distributed free of charge for noncommercial use; recipients are bound by the same ARS terms (README notice, `docs/research-skill-packs.md`).

## 0.10.5 — 2026-09-19

- Replaced the hardcoded tool / skill / acceptance tables in the core with five extension-declared hooks (`docs/extension-hooks.md`): a tool manifest declared once in `registerTool(pi, { …, drone })` (read-only, library mode, recovery-safe, capabilities, subagent exclusion, host activity text, receipt journal, flow cards, tool families), milestone acceptance verifiers registered by extensions (`file` / `human_review` stay in core; `zotero_item` and `wiki_review` moved to their extensions), a generic KnowledgeFlow `cards[]` shape rendered by one `FlowCards` component, UI slots and regions (`panel.artifacts.card`, `panel.task.milestone-evidence`, `panel.tab`, `rail.view`) plus `DroneUI.openExternal` / `useKnowledgeStore` / `i18n.registerMessages`, and a SKILL.md `alwaysWith` frontmatter that pins a skill to capabilities. A new domain now needs zero core changes.
- Fixed the `task_plan` acceptance schema so verifier fields registered after `task_plan` (for example `doi` / `libraryId` / `collection` from `zotero-literature`) are visible to the model and accepted by argument validation; restored the host activity text of `research_archive_topic` and `research_archive_explainer`.
- Added `research_zotero_save`, the first host-controlled Zotero write: exact-DOI dedup (existing items are reused, never duplicated), a native consent card unless the authorized task plan already lists the DOI as a `zotero_item` milestone, one write through Zotero desktop (connector) or the Web API with a write-scoped key from the environment, and a DOI read-back that decides `saved` / `unverified` / `failed`. Receipts are journaled per run and nothing retries, deletes, merges or moves items.
- The context panel now shows literature receipts in the 产物 tab (DOI, Zotero key with “Open in Zotero”, Vault note, fulltext status) and read-back evidence under `zotero_item` milestones in the 任务 tab; task milestones are reconciled against the desktop local API first, then the Web API.
- Reorganized the desktop shell into three columns: a 42px title bar, a 56px icon rail (chat / projects / research / knowledge), the chat column, and a 372px context panel with 任务 / 过程 / 变更 / 产物 tabs. The panel replaces the floating todo capsule, the task sidebar and the diff sidebar, and remembers its open state and last tab across restarts.
- Collapsed each turn's tool calls, progress notes and subagent runs into one ProcessBlock in the Desktop and LAN transcripts, and replaced the per-turn diff chip and usage settlement with a single TurnFooter line (duration · files changed · cost · steps) whose parts open the matching panel tab.
- Made research and knowledge full-screen views selected from the icon rail. The composer keeps one control per job — attach, model · thinking, permission, context ring, send/stop — and session usage moved to the 过程 tab.
- Added double-click rename for session tabs (persisted through `setSessionName`, rolled back with a toast if the backend rejects it), a time suffix for same-name tabs, and an all-sessions dropdown when tabs overflow.
- Put every overlay on one z-index scale (`--z-content` … `--z-toast`) and every font size on four tiers (14 / 13 / 12 / 11 px); nothing below 11 px remains in the desktop renderer.
- Removed the optional session rail preference (`ui.sessionRail`, ignored if present in an old ui-state.json), the orphaned TaskWorkbenchCard and LAN TaskCard components, their CSS, and about 70 unused i18n keys. The `chat.todo-panel` slot and `chat.diff-sidebar` region keep their names and now render inside the context panel.
- Tooling: `biome check` is clean (0 warnings); `noNonNullAssertion` is disabled only for test files, and desktop vitest no longer picks up the `node:test` files under `resources/`.

## 0.10.4 — 2026-09-19

- Reworked research answers to lead with the scientific conclusion, evidence level, default recommendation and explicit evidence boundaries.
- Preserved conflicting knowledge with source and condition metadata so newer evidence can update a conclusion without silently erasing the earlier record.
- Added context-grounded model recommendations to runtime questions while retaining user choice and custom text.
- Carried evidence receipts through advisory validation failures, including citation-budget failures, and improved literature operations, provenance and recovery.
- Improved task, model-wait, knowledge-flow and citation presentation across Desktop and LAN clients.

## 0.10.3 — 2026-09-18

- Create tasks only when the agent explicitly calls `task_plan`; ordinary chat and follow-up corrections no longer create extra tasks.
- Start a separate task when another plan is proposed after the active task already has an immutable plan, retaining the previous task as partial and resumable. Require a goal and validate the plan before changing task state; preserve task bindings, budgets and consent boundaries.
- Open task authorization in the native question dialog and keep task progress in the sidebar. Desktop and LAN transcripts no longer render task status cards.
- Ask how to proceed when an authorized task stops with unfinished deliverables, and make remaining work and next actions easier to understand.
- Stabilize the trace rotation test by waiting for recorded events to reach disk instead of assuming a fixed 10 ms write latency.

## 0.10.2 — 2026-09-17

- Fixed task status messages being inserted between a tool call and its result, which made OpenAI-compatible endpoints return 400. Previously recorded but misordered messages in old sessions are repaired before the context is sent, without fabricating results or replaying operations.
- Kept the task planning and authorization tools visible instead of letting capability filtering hide them.
- Merged concurrent requests from the same task button at the command entry point so a double click no longer cancels the original continuation; an explicit retry is still available after a cancel.
- Stopped treating a supplementary note in a file input as a formal submission, and stopped cancels, stale contexts and closed sessions from starting a continuation by mistake.
- Carried an existing valid task authorization through continuations confirmed from the original authorization entry.
- Changed the workbench progress bar to accepted deliverables over total deliverables rather than tool-call budget consumption; the call budget is shown separately.
- Added remaining deliverables, known reasons and next steps, distinguishing a missing acceptance record, a file absent from the agreed path, a blocked prerequisite and required manual handling instead of asserting that work is incomplete.
- Added native `ask_user` quick actions to the sidebar and the task card: continue within the original scope, read-only verification, submit a missing file, or confirm a completed manual review.

## 0.10.1 — 2026-09-17

- Restored the real `ask_user` authorization flow for task plans, additional authorization requests, stage budgets and outcome confirmations. Closing or cancelling a question never grants consent, and stale task revisions and changed bindings are rejected.
- Connected task failure feedback to the live SDK flow so failures report concrete impact and next steps without breaking tool-call/result pairing.
- Improved task sidebar progress, artifact links and contextual usage refresh. Task state stays distinct from scientific validation.
- Added bounded Markdown, code, scientific-text, gzip, image and PDF previews. Script previews do not execute code, and Markdown cross-file section links preserve encoded filename characters.
- Defaulted routine knowledge checks to nonblocking reminders, kept optional strict review and protected permission boundaries, and added safe AI Wiki history and undo.

## 0.10.0 — 2026-09-17

- Renamed the project from Percho to Drone: app id `io.github.gyoungwe.drone`, product name Drone, executable `drone`, packages `drone` and `@drone/{backend,shared,desktop}`, environment variables `DRONE_*`, user directory `~/.drone`, plugin API `window.DroneUI` / `DroneUiApi` / manifest `droneUi` / `drone-ui.d.ts` / skill `drone-ui-plugin`, and release artifacts `drone-*`. The repository moved to `Gyoungwe/Drone`.
- Changed the user data location: the new app id means a new userData directory, so previous sessions, settings and installed plugins are not carried over. On first launch `~/.percho/daily` is moved to `~/.drone/daily` when the target does not exist, falling back to a link to the old path on a cross-device or locked rename; failures are logged without blocking startup and the original data stays in `~/.percho`. `~/.percho/ui-plugins` is not migrated because it links into the old userData directory.
- Fixed a task dead-ending with `400: Messages with role 'tool' must be a response to a preceding message with 'tool_calls'`, which every Continue click reproduced. A stage checkpoint firing from the `tool_call` hook could insert a status card between an assistant message carrying `tool_calls` and its tool results, so the provider rejected the turn at the entry point and the stage counter never reset. Status cards are now held while any tool result is outstanding and flushed once the last one is paired or at `agent_end`, and the counter resets at the start and end of a turn so an aborted turn cannot strand a held card.

## 0.9.0 — 2026-09-17

- Added one task authorization: after bounded read-only discovery `task_plan` proposes the goal, a plain-language scope summary, existing write directories and immutable acceptance milestones at once, and the single 确认一次，执行到交付 action approves the acceptance criteria and the execution budget and starts the task without a second Continue click. Consent is bound to an immutable contract hash over the task id, goal, binding, scope summary, directory list and milestones, so it never transfers to another task, session or changed contract.
- Added scoped write consent: ordinary `write`/`edit` calls under the approved canonical directories and their children are allowed without a prompt. Only the default whole-tool `ask` is replaced; explicit deny rules, pattern-specific asks, command gates, credentials, permission/trust/model configuration, private keys and VCS internals keep their existing gates, and canonical path resolution rejects symlink escape and hard-linked write targets.
- Added automatic stage progress: stage checkpoints advance on observed progress only, with at most 3 host-triggered recovery turns inside the unchanged 192-call lifetime ceiling. Status spam, failed checks and fabricated result events do not count as progress, and a recoverable blocked publication continues through a nonce-checked host message rather than a forged user turn.
- Added 本次任务全部允许 / Allow all for this task (`allowRun`, shortcut `T`) to the approval dock: it approves every remaining confirmation in the current agent run, drains the queued requests and expires at `agent_end`. It is not persisted, is not remembered by pattern and never overrides a `deny` rule. Together with the authorization card the user sees at most one card plus at most one command prompt per task.
- Added the `研究工作流` interruption budget: all user decisions are front-loaded into one message, mid-task choices use documented defaults, and the defaults taken are reported under 我替你决定的.
- Added `docs/task-authorization.md` describing what one authorization does and does not cover, the automatic progress and recovery limits, and the code map for the permission path.

## 0.8.1 — 2026-09-16

- Research answers are written for the researcher: the recommendation and its key reasons come first, decisions the user must make come second with defaults, and run directories, hashes, wiki links and failed downloads are collapsed into a final `依据与记录` section. Evidence and publication rules are unchanged.
- Task workbench reason codes (for example `stage-budget`, `reconcile-before-retry`) are shown as plain-language explanations with the next step, in the host status card and the Desktop task card.
- When a stage budget is reached the model is told to answer from what it already has and point the user to the task panel instead of ending abruptly.

## 0.8.0 — 2026-09-16

- Added the structured task workbench (`.pi/lib/tasks/workbench.mjs`, `register.mjs`): model-proposed milestones with dependencies require explicit user approval; acceptance is only satisfied by host file readback, scoped human review, Wiki review records or read-only Zotero item identity. Human-review waits resolve only their own action, and the durable ledger is restored on restart without replaying unknown side effects. The v0.7.8 runtime remains available with `DRONE_TASK_WORKBENCH=off`.
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
- Public repository, update, release, issue, and security links now target `Gyoungwe/Drone` while preserving original author attribution.
- Repository Biome checks were normalized so lint, typecheck, tests, and build can pass the release gate.

### Validation

See [`docs/releases/v0.6.0.md`](docs/releases/v0.6.0.md) for release-specific capability boundaries and validation notes.
