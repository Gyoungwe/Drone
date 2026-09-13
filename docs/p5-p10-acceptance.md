# P5–P10 acceptance and evidence ledger

Status: P5–P10 implementation and local 0.7.0 release-candidate validation complete. Public tag/Release publication remains separate. This document distinguishes implementation, local validation and a public release. None implies the others.

## Invariants

Semantic hits, topic memory, UI previews and child-agent reads are navigation data. Only current, parent-owned source reads and existing publication checks permit an evidence-backed answer. Human-authored Wiki content is not silently replaced. Provider/model/Thinking choices and least-privilege roles are unchanged.

## Repeatable gates

- `npm run test:upgrade`: deterministic orchestration stress, actual hybrid/SQLite fixture benchmark and packaged-resource audit. No paid models or real Vaults.
- `npm run validate:upgrade`: lint, typecheck, all workspace tests (including shared transcript tests), the above fixtures, production build and isolated Electron UI checks.
- `node scripts/check-knowledge-package.mjs --resources /path/Percho.app/Contents/Resources/research-workbench`: audit the actual shipped resource tree and exercise it against a disposable Vault.
- `node scripts/check-packaged-desktop.mjs /path/Percho.app`: real packaged first launch with isolated HOME, profile, agent directory and knowledge directory. No inherited credentials.
- `node scripts/benchmark-semantic.mjs --live-local`: opt-in real local embedding fixture; requires explicit local endpoint and model environment variables. It is not run by default in CI.

Logs and machine-readable receipts stay under ignored `.local/release-validation/` or explicitly printed temporary fixture paths. They do not ship with installers. Test fixtures contain no private research materials.

## Acceptance matrix

| Phase | Required evidence | Integration status |
| --- | --- | --- |
| P5 | HTTP adapters, incremental fingerprinted index, actual FTS + semantic fusion, scoped current-source hydration, timeout fallback, default off, no minted read receipts | Locally validated |
| P6 | 20/50-turn replay, duplicate accounting, cancellation/queue recovery, clear failures, same-session usage refresh | Locally validated |
| P7 | Repeated runs idempotent, existing proposal flow reused, additions/conflict-candidates/stale sources visible, human text unchanged | Locally validated |
| P8 | Persist/reopen, exact/unique scoped resume, Chinese ambiguity, bounded topic context, stale binding/source rejection | Locally validated |
| P9 | Immutable permissions, deterministic decisions, hard-capped per-turn/session budgets, reservation and cancellation safety, reported usage only | Locally validated |
| P10 | Full local gate, legacy persistence/schema guard, actual macOS package and first launch, CI integration | Local Apple Silicon release-candidate validation passed |

## 0.7.0 local validation receipt

On 2026-09-13, the consolidated gate passed: repository lint; all-workspace typecheck; backend 779 tests, desktop 373 tests, shared 13 tests (1,165 total); deterministic orchestration stress; production-pipeline semantic fixture; packaged-resource fixture; production Electron build; and isolated Electron UI smoke.

A real local `embeddinggemma` check was also run only against the disposable benchmark Vault and the production persistent-vector path. It confirmed cross-language/synonym retrieval on that tiny labelled fixture and motivated the conservative default cosine floor of 0.45; this is not a general retrieval-accuracy claim.

An arm64 `Percho.app` was then built ad-hoc and launched with isolated HOME, userData, agentDir and knowledgeDir. The packaged renderer/CJS preload mounted, application knowledge was enabled but unbound, semantic/topic IPC was present, bundled research/Obsidian commands were available in an unrelated empty project, and fresh auth/model stores were empty. The actual packaged `research-workbench` resource tree also passed the private-file/package audit. macOS notarization, Intel macOS, Windows and public GitHub Release publication were not performed here.

## Limits on claims

Synthetic replay is a regression/invariant test, not a 50-turn live-model quality measurement. A small labelled embedding fixture is not representative of a large real research Vault. Missing cost/cache telemetry is unknown, never free or a guessed cache-hit rate. A successful local Apple Silicon package is not proof of Windows/Intel/macOS notarization or a published GitHub release. No credentials, bound Vault configuration, downloaded literature, sessions or embedding model weights belong in a release.
