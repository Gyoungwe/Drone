# Agent capability and observability upgrade

This upgrade borrows mature agent-product patterns without replacing Drone's evidence-aware research architecture. Markdown/original sources remain the source of truth; reviewed Wiki, evidence receipts, protected human text, publication checks and Show Me retain their existing semantics.

## P0 — Lazy Tools and Skills

Status: implemented.

- Seven capability packs: Knowledge, Research, Coding, Web, Files, Visualization and External Apps.
- All tools remain registered; only the active subset is exposed to the model.
- `ask_user`, `set_status`, `todo` and `capability_load` are always available.
- Skills remain discoverable to slash-command/settings surfaces while model-facing metadata is capability-filtered. Full `SKILL.md` bodies continue to use the SDK's native lazy expansion.
- `capability_load` can add packs during a running turn without removing already active packs.
- SDK input hooks cover Desktop, LAN, direct `AgentSession.prompt()`, queued follow-up and explicit `/skill:*` invocation.
- Reloads after package/MCP changes reapply the selected subset.
- Tool invocation count, last-use time, capabilities and schema footprint are observable in Settings → Tools & Skills.

### Reproducible footprint fixture

Run:

```sh
npx vitest run packages/backend/test/capability-footprint.test.mjs
```

The fixture creates a real `PiBackend` session with the packaged research-workbench manifest and a faux provider; it does not call a paid/live model. On 2026-09-13 the current registry measured:

| state | active tools | all tools | active schema | all schema | reduction |
|---|---:|---:|---:|---:|---:|
| Core only | 4 | 45 | 4,944 B | 27,854 B | 82.25% |
| Knowledge + Research | 37 | 45 | 21,494 B | 27,854 B | 22.83% |

The same fixture reports 64 registered skills; core-only exposes zero skill metadata and Knowledge + Research exposes 24. These are registry/schema bytes, not tokenizer estimates.

## P1 — Explicit specialist model and Thinking controls

Status: implemented.

- Every subagent can follow the parent model or explicitly select provider/model.
- Every subagent can follow the parent Thinking level or explicitly choose a supported level.
- Protected knowledge roles use the same preferences but retain immutable least-privilege capabilities.
- Missing credentials, unavailable configured models and explicitly unsupported Thinking levels fail closed; providers are never silently substituted.
- Specialist receipts carry actual model, Thinking, input/output, cache read/write, reasoning, total tokens and reported cost.

## P2/P3 — Tools & Skills and specialist settings UX

Status: implemented.

- The former Skills page is now Tools & Skills and shows capability state, Active/Lazy/Always-on tools, schema footprint, source extension, invocation count and last use alongside the complete skill catalog.
- Specialist settings use role cards showing Model, Thinking, trigger policy, immutable permissions, max turns, output-token budget, timeout and the current session's latest run.
- Automatic / Manual / Off remains the application-level dispatch policy. Wiki reviewer stays user-triggered and is not a fifth automatic stage.

## P4 — Run Inspector

Status: implemented for Desktop and LAN.

- Extends the existing chronological public execution timeline instead of creating another execution model.
- Per turn: main models/responses, public stage summaries, tools, subagents, duration, SDK usage/cache, observed read paths, artifacts, Skill invocation, errors and publication-preflight status.
- Desktop and LAN derive from the same shared transcript function.
- Only observable public summaries/tools/receipts are displayed. Private chain-of-thought is never exposed.

## P5 — Hybrid semantic knowledge retrieval

Status: implemented; embedding remains opt-in and disabled by default.

- SQLite FTS and semantic vector retrieval run independently and are fused deterministically; the injectable candidate provider remains for compatibility/tests.
- Ollama and OpenAI-compatible adapters are bounded, abortable, opt-in, and validate endpoint/credential/vector safety.
- Vector chunks are stored incrementally by current source hash and provider/model/chunk fingerprint; changed/deleted sources are invalidated and incompatible fingerprints are never reused.
- Semantic candidates are rehydrated through current Vault/project ACL and a configurable similarity floor (default 0.45), then deduplicated/fused with lexical candidates. Provider failures fall back to FTS with structured retrieval diagnostics.
- A semantic hit never creates a read/evidence receipt. The parent must still read the current source before evidence publication; regression tests enforce this.

## P6 — Long-session reliability and observable recovery

Status: implemented.

- Deterministic 20/50-turn replay and concurrent/cancelled specialist stress tests.
- Separate no-evidence, provider failure, permission denial and exhausted budgets.
- Current read targets must not be inferred from links in retrieved text; replayed response/tool IDs are deduplicated.
- Session usage refreshes at completed-response/run boundaries, not per token delta.
- Synthetic replay results are not presented as live-model quality or cost measurements.

## P7 — Knowledge lifecycle

Status: implemented.

- Extend existing evidence-gated summary -> pending topic proposal/merge flow, never duplicate it.
- Idempotent repeated runs; additions, potential conflicts and changed-source/stale markers.
- Keep original sources, current read receipts, proposal and Show Me/run references traceable.
- No automatic overwrite of human-authored Wiki text; reviewed publication remains separate.

## P8 — Cross-session topic continuity

Status: implemented.

- Bounded versioned topic records scoped by Vault and project; no full transcript copying.
- Explicit topic ID/name or a unique match resumes context; ambiguity returns selectable candidates.
- Summaries/entities/open questions provide navigation context only, never evidence or instructions.
- Revalidate current source hashes, binding and project scope across restart and topic switches.

## P9 — Bounded adaptive specialist orchestration

Status: implemented.

- Auditable deterministic run/skip decisions based on task needs, evidence and remaining budgets.
- Preserve Automatic/Manual/Off policy, explicit models/Thinking and immutable role permissions.
- Reserve before asynchronous dispatch; cap queue/concurrency/run/token/tool budgets and release on cancellation.
- Parent-facing receipts explain why work stopped and what remains; missing usage is unknown, not zero cost.

## P10 — Release hardening / 0.7 candidate

Status: implemented and locally validated for the 0.7.0 release candidate.

- Additive persistence migrations and refusal to overwrite corrupt or unknown future schemas.
- Legacy sessions/settings/Vaults remain readable with semantic retrieval disabled by default.
- Run shared + backend + desktop tests, stress/benchmark fixtures, lint/typecheck/build, isolated Electron smoke and package audits.
- Validate the locally built macOS package without accessing the real Vault, credentials or session data.
- Report platform/signing/live-provider checks separately; a local build does not claim cross-platform or public release success.

## Acceptance criteria

- Publication/evidence checks are unchanged and semantic candidates cannot mint evidence.
- Protected specialists cannot gain shell, network, recursive delegation or direct Wiki approval through UI configuration.
- Live and historical transcript ordering use the same shared reducers/row builders.
- Desktop and LAN expose the same Run Inspector semantics.
- Capability selection can be disabled with `lazyCapabilities:false` for compatibility/testing.
- Typecheck, backend/desktop tests, production builds and isolated Electron UI smoke must pass before release.
