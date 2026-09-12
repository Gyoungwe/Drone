# Knowledge-service specialists — 2026-09-12

## Scope

Four protected built-in profiles run through an isolated, capability-only model loop rather than the generic subagent runner. This is a foreground part of the requested knowledge task, not a timer, post-session reflection daemon, or recurring job. No parent transcript or ambient AGENTS.md, user profile, general skills catalog or extension is loaded in a child. The real loaded `show-me` skill body is supplied only to the explainer. Model credentials stay in the shared runtime; they are not model-visible content.

| Profile | Automatic trigger | Capabilities | Output owner |
|---|---|---|---|
| knowledge-navigator | First provider context for an eligible knowledge request | read permitted navigation/Wiki/notes, bounded search, structured submit | Compact unverified handoff |
| knowledge-evidence-curator | Comparison/conflict request with multiple sources found by navigator | assigned note reads, structured submit | Compact limitations/conflicts handoff |
| knowledge-wiki-editor | Successful evidence-gated parent summary, eligible candidate | assigned sources and target Wiki, structured draft submit | Host stages/merges; human approves |
| knowledge-explainer | Paper/software delivery after summary, no prior explainer archive, real skill loaded | assigned sources, supplied show-me skill, structured HTML submit | Host creates artifact and archives presentation pointer |

No specialist gets shell, arbitrary file reads/writes, network fetch, raw MCP, environment access, recursive subagents, setup, settings mutation, live Wiki write or approval. The allowed source paths are checked by the broker, not by model instructions alone. Reserved built-in names override ambient user/project definitions, and the generic runner refuses them. `research_delegate_knowledge` is the explicit bounded delegation route; it does not provide an approval option.

## Context and evidence

Each child receives the current task, bounded navigation, assigned notes and optional current research summary. It has a fresh private conversation. Only `knowledge_submit` matching the role schema is accepted. Prose-only completion, extra authority fields, invalid paths and oversized output fail. Tool-call narratives and reasoning remain in local in-memory context only; there is no child transcript copied to the parent or saved as a second general conversation.

Parent orientation includes at most two compact reports, each with a short summary, cautions and up to four source pointers/excerpts. Full generated Wiki/HTML content is passed directly to controlled host sinks; the parent gets links/status, not the full markup. A child's navigation/read/search ticket is distinct and revoked at completion. **Child reads never mint parent publication receipts.** The parent still reads its cited sources and completes its own native evidence search before final publication.

The knowledge service currently supplies Markdown source notes, not direct PDF/manual parsing. Source records can be only bibliographic or archival metadata. Specialists are explicitly instructed not to claim original-paper/full-manual understanding from such records. Scientific entailment, source completeness and local benchmark execution remain separate research tasks. No role has software execution permission or may invent local performance measurements.

## Automatic dispatch, controls and budgets

Application knowledge settings provide `automatic`, `manual` and `off`. Absence of a settings file defaults to automatic, as authorized for this workflow; no settings file is silently created merely by reading. The existing `subagentPolicy=none` and untrusted-project states remain hard ceilings. Changing mode cannot grant Vault access. Read-local is the ceiling even when the UI says automatic.

Model settings expose all four profiles. A role inherits the parent model unless explicitly configured. An unavailable configured model fails instead of silently switching providers. Calls can incur real model fees; the UI says so and reports input/output usage when available.

Limits: four specialist calls per user turn, at most one call per role, two concurrent knowledge workers across the app, eight queued knowledge workers, 120-second wall-clock deadline including waiting, with the per-role budget reset only by a new user turn. Long parent research tasks do not exhaust a separate timer before the delivery specialists get a chance to run. Per-role loops cap provider turns (6/4/3/3), output tokens (1800/2400/6500/12000), four tool calls per batch and ten overall. Inputs and private transcripts are byte-bounded. Provider errors and budget exhaustion do not auto-retry.

The generic native runner and knowledge bridge additionally share a three-child application ceiling, with `maxConcurrentSubagents` values 1–3 in each project's configuration honored. Project/user definitions cannot increase the role permissions. New user turns, cancellation and session shutdown abort active children; binding, policy and trust are rechecked before each capability and after provider results.

## Writes and user interaction

A child returns a draft, not a write command. The host checks binding, parent source receipts and output shape before staging a Wiki candidate or creating a fresh explainer under an existing run directory. Pending candidates stay outside the Vault. Human approval and version-based conflict detection are unchanged. Run-only disallows these extra persistence actions. Explainers are static self-contained HTML in this profile: inline CSS and native disclosure elements are allowed; scripts, frames, forms and remote resources are rejected. They remain presentation-only.

The settings panel shows roles, capabilities, costs, mode and a model-settings link. The chat card shows queued/running/completed/failed/cancelled states, selected model, observable tool activity, usage, short handoff and source count. Only whitelisted status fields reach this UI. The human settings IPC uses main-frame checks and optimistic settings/binding revisions. UI reads do not earn model evidence receipts.

## Validation and limits

`knowledge-specialists.test.mjs` covers capability refusal, isolation, input/output limits, cancellation, model routing, per-turn and global scheduling, human controls, source version changes, project boundaries, reserved identity protection, and static artifact checks. `knowledge-specialists-sdk.test.mjs` uses the real SDK/runtime and a scripted provider to execute the four-stage workflow, verify absent parent secrets in child contexts, generate a fixture explainer and Wiki proposal, and publish the final answer only after independent parent reads/search.

The SDK fixture waits for real file-watch debounce before its final search because a scripted provider has essentially zero latency. The production incomplete/stale-index checks are not weakened. A case-mismatched target still requires its exact canonical-path read; this work does not implement the previously discussed semantic topic alias resolver.

The GUI smoke script builds into a new temporary directory and exercises the real settings IPC and components against a temporary Vault. It does not click Wiki approval or contact a model. These controls constrain the new native specialist lane, not arbitrary third-party plugins or unsandboxed generic agents. They do not prove scientific correctness, eliminate prompt injection semantically, or sandbox the entire operating system.

## Final review follow-up

Reservations are made before asynchronous skill loading, so parallel tool calls cannot start the same specialist twice. A run captures the parent turn before settings reads, and old orientation completions are discarded when a new user turn replaces it. Regression tests cover concurrent explainer dispatch, cancellation during orientation and cancellation during initial settings IO.

Two timing-dependent test fixtures were tightened without weakening production publication checks: the channel watcher test waits for the actual debounced event and always stops its watcher; source-invalidation tests establish a successfully complete baseline query before modifying the source. Earlier failed runs are retained in validation records rather than described as all-green.

Final verification: backend 677 and desktop 359 tests pass (1,036 total); 45 new specialist backend cases and 2 new desktop IPC cases. Workspace type checks, isolated desktop build, real Electron resource smoke and temporary-Vault GUI smoke pass. No live provider call, user-Vault mutation, app restart, new commit or push occurred in this iteration.
