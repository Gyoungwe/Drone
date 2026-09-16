# Native knowledge answer publication gate

## Implemented scope

Application mode is selected by `DRONE_KNOWLEDGE_DIR`. When a Vault is bound, the parent assistant final text is published only after its host-owned current-turn navigation/search/read records are validated. CLI legacy behavior remains unchanged. Unconfigured application responses are marked `unconfigured`, not certified as knowledge-grounded.

The application publication module uses the pinned SDK message_end replacement contract. A replacement occurs before SessionManager persistence. PiBackend applies a fail-closed projection before trace/desktop/LAN fanout; it suppresses incremental assistant message payloads and sanitizes start/final/turn/agent snapshots. Live history polling uses the same publication state and cannot expose an in-flight draft while asynchronous validation is pending. JSONL/HTML exports use finalized persistence. No UI-only hiding is treated as the security boundary.

## Conditions

- Current native navigation ticket, correct project/workspace and unchanged Vault binding.
- An actual complete non-Wiki-only search in this question. Failed newer searches invalidate older success.
- Non-empty current linked/discovered Wiki reads when that stage is required.
- At least one Vault-relative `[[path]]` citation after search hits, up to 12 distinct paths; each cited path must have an actual current-turn read receipt and unchanged content hash.
- No pending index changes or known indexing problems; current index revision must match the search receipt. This deliberately conservative check may request a new search after an unrelated indexed change.
- Successful zero hits are explicitly labeled as not matching Vault evidence, not proof of global absence or scientific correctness.

Source search relevance, whether the stated claim follows from the cited section, external URLs, exact Obsidian heading/alias semantics, and the research-loop archive/claim-binding gate are not independently adjudicated here. The scientific workflow remains necessary. A fresh host receipt cannot prove semantic understanding.

## Failures and limits

Blocked drafts are replaced by short host-generated Chinese notices with a reason; draft content is not echoed. The gate has a five-second validation budget, a 128 KiB parent final-text limit, and no automatic retry/model-repair loop. An interrupted/overlong/pending model answer is not released as a finished answer. A provider/model request failure (`stopReason=error`) is not a knowledge-check failure: the host keeps an empty unpublished body and preserves a sanitized `errorMessage` for the existing LLM error card. User follow-up/steering messages drained inside one SDK run reset receipts; they do not reuse the prior question's publication permission.

Unsigned or tampered in-process final metadata fails closed. Persisted records are trusted as local user-owned history, not an adversarial signed database. Previously recorded legacy answers are not retrospectively certified or removed.

## Model protocol and child outputs

Tool calls must execute before a final response can be checked. Tool-turn assistant prose is therefore withheld from public/persisted transcripts. Exact original tool-cycle blocks (including signed thinking protocol) are retained in bounded live memory and restored only for the model's subsequent context. The buffer is capped at 4 MiB / 64 messages and cleared for a new user turn. There is no promise of exact cross-process recovery of an interrupted signed tool cycle; original rejected prose is not stored as public history.

Primary compatibility reference: [Anthropic extended thinking / tool-use blocks](https://platform.claude.com/docs/en/docs/build-with-claude/extended-thinking). The real backend tests simulate signed blocks with an offline provider; they do not verify every live provider implementation.

Read-only or no-Vault-permission subagents return `evidence-only` material with an explicit unreviewed label. That is not a parent answer or a transferred validation receipt. The parent completes its own knowledge access. Tool execution arguments/results and trusted command responses remain operational data, not an alternative certified answer channel. Arbitrary unsandboxed filesystem/shell/custom-extension behavior is not constrained by this native prose gate.

## Performance and validation

The gate rereads metadata/current small navigation and cited sources only; it never asks for a whole-Vault reconciliation per answer. Benchmark publication timings measure a stable index with one cited source and exclude initial watcher settling, model generation, network and graphical rendering. A pending filesystem update must fail closed rather than be hidden to improve the benchmark.

Tests: `knowledge-publication.test.mjs` (native conditions), `knowledge-publication-delivery.test.mjs` (real PiBackend + SDK + offline model; streaming/history/live polling/export/follow-up/protocol), and `knowledge-publication-hooks.test.mjs` (timeout, error, bounded and child behavior). These use temporary Vaults and provider fixtures only.

No real user notes were migrated, no installed application replaced, no automatic semantic Wiki consolidation scheduled, and no Git commit or push is part of this change.
