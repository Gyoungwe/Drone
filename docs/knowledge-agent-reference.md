# Knowledge Agent reference review — 2026-09-11

Scope: primary public documentation, not an independent product benchmark or a closed-source implementation audit. No peer packages or source code were installed/copied.

## Sources

- [M1 — Tencent Marvis](https://marvis.qq.com/)
- [M2 — Marvis product positioning](https://marvis.qq.com/docs/产品认知与定位/4)
- [H — Hermes persistent memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory/)
- [L1 — Letta Agent SDK memory](https://docs.letta.com/agent-sdk/memory)
- [L2 — Letta shared repositories](https://docs.letta.com/agent-sdk/repositories)
- [O — OpenClaw memory-wiki](https://docs.openclaw.ai/plugins/memory-wiki)

## What is documented; what we choose

| Peer | Documented pattern | Drone decision |
|---|---|---|
| Marvis (马维斯) | Computer-hosted assistant with integrated local-file understanding/search and efficiency/local-privacy modes. | Keep one application knowledge service and disclose when selected snippets are supplied to a cloud model. Local storage/indexing is not a promise of zero cloud transfer. The reviewed public pages do not establish Marvis database internals, refresh algorithms or mandatory read-before-answer enforcement. |
| Hermes | Bounded core/profile memory, frozen session-start snapshot, on-demand history search; configurable staging/approval for writes. | Keep compact navigation, separate diagnostics and detailed retrieval. Stage Wiki changes before publication. Do not copy frozen stale evidence, unrestricted memory writes, multiple writers to one profile home, or automatic post-turn model reviews by default. |
| Letta | System memory versus on-demand shared repository files; temporary session and persistent agent attachments are distinct. | Separate shared storage ownership from content actually supplied to the current model. Preserve Drone application binding and project scoping. Do not introduce a cloud repository dependency. |
| OpenClaw memory-wiki | Active memory and synthesized Wiki are distinct; provenance/claims, configurable global/agent scope, compiled views and preservation of human blocks. | Keep evidence and synthesis distinct; retain source versions and human edits; review candidates rather than promoting conversations into scientific facts. Retain Drone navigation-first ordering rather than claiming every peer uses that order. |

## Changes actually made in this iteration

- Real non-empty linked/discovered Wiki read receipts replace the previous any-Wiki checkbox. Current content hashes are checked; out-of-range reads and stale pages cannot unlock evidence search.
- `research_propose_wiki_update` records source reads, source/target versions, the exact proposed generated-block update and binding revision outside the Vault. It does not publish knowledge.
- `research_wiki_review_status` provides a bounded preview/list. `/obsidian-review` is a user command with a fresh native UI choice, not an agent tool accepting `approved: true`.
- Native application direct Wiki deposits and the older Wiki builder reject review bypass. Non-Wiki deposition is unchanged.
- Changed sources/targets/bindings, expired proposals, invalid markers, wrong project scope, unavailable reads and over-budget candidates fail explicitly. Cancel/reject do not write the target; approved updates preserve outside-managed content and distinguish note/index/review-record outcomes.
- Navigation context keeps coverage information but excludes frequently changing performance counters. Full telemetry remains in status tools.

## Limits and deliberate non-goals

Candidates: 24,000 proposed characters, 1–12 read source notes, 100 pending items per Vault, 24-hour expiry. The pending cap does not limit archived review history. No automatic model invocation, periodic semantic consolidation or recurring reflection job was enabled.

User approval is not scientific verification. A linked/discovered current read is observable; semantic understanding and complete evidence coverage are not proven by the receipt. Existing target reads can be bounded, so preview/review remains necessary. Review preimages are retained but one-click rollback is not implemented.

This does not ship a universal final-answer delivery gate. Raw external transports and arbitrary unsandboxed host filesystem tools are not secured by native API checks. Optimistic content checks do not eliminate the external-editor race between final validation and rename. Cross-project proposal review stays limited to its originating project; approved shared Wiki pages are visible through normal shared search.

## Verification

The new suite `packages/backend/test/knowledge-peer-patterns.test.mjs` covers 24 cases. Full workspace tests passed: backend 555, desktop 332 (887 total); type checks and desktop build passed. Synthetic index benchmarks and Electron resource smoke were rerun separately. These fixtures do not exercise a real user Vault, live cloud model, or a graphical manual review session.
