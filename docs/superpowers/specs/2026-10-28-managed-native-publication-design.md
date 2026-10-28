# Managed native publication: owner-local authority and generic delivery boundary

Status: design for root review; implementation is not accepted by this document. Scope is the full approved P2 workflow, followed by the combined real installer gates. Source findings were checked against Drone `bb34ac65`, plugin source `238a346` and the existing publication tests. Published UI 1.x behavior stays intact. External account acceptances and deferred MinerU/GROBID/B8/B8-2 are unchanged.

## Current executable chain

1. Plugin `src/extension/knowledge-extension.ts:createNativeSession` creates one publication instance and `createKnowledgeSessionServices` ticket view per native attachment, over the application's shared service pool. It currently returns `publication`/`services`, without wiring the public `PluginNativeSession.projection` field.
2. `internal-knowledge-extension.ts:createKnowledgeInterface` registers the full preparation/read/check/recovery tools. `publication.ts:registerAnswerPublication` owns the actual `handleMessageEnd` algorithm, tool-round accounting, source/ticket checks, signed provider replay and a WeakSet of freshly sealed proof objects.
3. `process-runtime-worker.ts` explicitly disposes/rejects an adapter with `projection`. Ordinary native handlers otherwise cross JSON separately. A later handler currently receives a serialized copy of an earlier handler's message/proof.
4. Pinned Pi 1.1.0 `AgentSession._handleAgentEvent` awaits extension hooks, then synchronously emits publicly, then calls `SessionManager.appendMessage`. `ExtensionRunner.emitMessageEnd` catches a hook failure and continues. Its `emitContext` starts from `structuredClone(messages)`. AgentSession then replaces the final assistant object in place.
5. Host `SessionEventService` applies `projectKnowledgeEvent` before trace/fanout; `SessionMessageService` applies `projectKnowledgeSnapshot` for polling/history. The current host fallback is keyed by `DRONE_KNOWLEDGE_DIR` and `runtime.knowledge.publication`. HTML/JSONL exports use SDK history. This ambient domain guard can suppress normal chat even when the optional package is absent.
6. Signed tool-cycle replay is currently a **plugin publication closure Map**, not an independent host replay map. Public/persisted tool phases contain actual toolCalls and SDK envelope metadata, while private signed thinking/tool preface is restored only for the provider. This existing distinction must survive migration.

## Options

| Option | Authority and tradeoff | Decision |
|---|---|---|
| B: owner-local objects, transport references, final delivery boundary | Child retains actual proof-bearing objects. Parent binds only real SDK/RPC objects to private references; final async evaluation finishes before SDK public emit/persistence. Reuses existing domain algorithms. Requires a real identity courier and generic session delivery state. | Recommended |
| A: move the entire SDK session into the plugin process | Preserves local identity naturally, but also moves model/provider, tools, session persistence and all existing host control into remote session RPC. | Excessive scope for this migration |
| C: return sealed JSON with no retained object association | Simple and safe only if every unfamiliar copy is blocked. Adjacent handlers/SDK clones cannot retain live WeakSet authority; accepting copied IDs/hashes would be unsafe. | Cannot satisfy the complete workflow |

## Installed source and policy lifetime

Use one package-level installed-source index shared by native loading and optional UI discovery. Add the proposed manifest declaration `drone.deliveryProjection: "required"`; native Pi ignores this optional Drone metadata. Derive the source descriptor from the verified installed package/root/content generation, alongside native entrypoint and permission declarations. S2 owns extraction of this index; this change must not create another UI-specific index.

The source epoch and real package enable/disable state select policy; an environment variable or optional package name does not. A required source is recorded before importing its adapter. Pending/loading/failed required projections suppress unresolved assistant delivery. A genuine absent/explicitly disabled package contributes no domain policy, and the host remains an ordinary Pi client. Disabling aborts/drains the affected current run and clears the old attachment's live authority before future prompts run without that policy. Unexpected disappearance, changed contents or failed replacement must not silently turn an already-required live policy into absence. An actual source rescan/reapproval/reload supplies a new epoch.

No new permission is granted by the declaration. The existing source approval and per-call state/file/model permissions still apply. A closed original approval window cannot be replaced by a guessed window: writes need an actual current authorized caller/window; otherwise they deny explicitly. Read-only projection and basic reading must not depend on an unrelated window's grant.

## Public and internal interfaces

Keep the existing optional `projection.event(event)` and `projection.snapshot(messages,persisted)` methods. Propose an **add-only** `projection.finalize?(event, context: PluginRuntimeContext)` with an optional declared effect (default write). `finalize` performs the same real domain validation once; `event`/`snapshot` remain read-only projection. PluginRuntimeContext supplies only authenticated scope, signal and borrowed capability access, never SDK internals or a caller assertion copied from input.

Internally give `registerAnswerPublication` a real final-message registration dependency. The native CLI adapter registers the existing callback with official Pi `message_end`. The managed adapter retains that callback for `projection.finalize`, instead of registering and then rerunning it. Tool-round counts, current tickets, policy, source validation and `seal` stay in that single existing algorithm. Merely rerunning the old hook at the end would double-count tool rounds; merely reusing its earlier proof would miss later hooks' changes.

A host-only session projection coordinator holds required source expectations, actual native attachments and final projection callbacks. It uses the actual SessionRegistry entry/attachment generation. These callbacks are framework mechanisms; no knowledge-specific prompt, proof status interpretation or source algorithm moves into the host. The coordinator integrates with the same real native bootstrap used by the installed package.

## Object identity courier

- The worker retains the actual proof-bearing message object within its own native attachment; its proof remains in that attachment's actual WeakSet. References are internal transport records with an attachment-local namespace and lifetime.
- Parent WeakMaps associate only the **actual SDK object and actual returned RPC object** with a reference received for that pending invocation from that exact source/attachment. An ID in model/UI/message JSON never creates or selects this association. Reference envelopes are separate from message JSON and never enter history, exports or renderer output.
- For adjacent handlers the host supplies only associations it actually holds. The child recovers the original object using that private envelope before invoking the next real handler/projection. It does not reconstruct membership from proof.id, timestamp, toolCallId, content hash or serialized proof properties.
- An integrity snapshot may reject an object whose bytes have changed since its association. It can only remove authority; equality/hash is never enough to grant an association. Modified content is treated as fresh/unsealed input and needs actual final validation. A proof-bearing object is not updated from untrusted JSON in a way that preserves a formerly valid proof for new content.
- SDK `context` clones have no live association. Their private provider replay may use the existing per-session protocol key, but this never grants publication authority. A copied proof in a new message or clone remains a copy. Genuine persisted branch history follows the existing explicit restore rules and is never inserted into the live WeakSet.
- Every request checks source epoch, attachment state, real SDK session/cwd, caller identity and cancellation before/after awaits. No API accepts a renderer-selected projection/session/attachment. Detach, source revoke, reload and close drain work and destroy live references. Two native sessions sharing one app owner still have separate proof/ticket identities; two app owners have separate transports/resources.

## Finalization, failure and every delivery path

Append a generic finalizer after all actual loaded SDK extension factories/handlers. On pinned 1.1.0 this runs before `_emit` and appendMessage. It awaits all applicable owner-local finalizations/projections in actual registration order, caches the returned safe view against the real current SDK object and replaces that object in place. SDK metadata, exact toolCalls/IDs, usage and signatures retain their existing meanings.

SDK hook exceptions cannot be the publication gate: the SDK catches them. If a required projection denies, throws, cancels or disappears, the finalizer must replace the actual assistant object with a neutral fail-closed view **before** returning/reporting the error. Its diagnostic names the actual source and failure category without raw draft, thinking or provider stack. Unknown tool-phase delivery preserves toolCalls and pinned SDK metadata while hiding draft/thinking; an unvalidated final answer is sealed rather than released.

The synchronous session event path consumes only an actual verified view or applies the same neutral fail-closed rule. It suppresses draft `message_update` for required-policy sessions. The cache is a delivery receipt, not a new domain proof. Polling during pending validation cannot expose raw agent.state. Existing model-wait/status accounting may observe only the data it needs; trace and fanout always come after delivery projection.

`getSessionMessages` can await the owning projection. Its persisted argument comes from the actual SDK branch, never the live array. Offline peek/reload passes actual persisted records as history provenance, without claiming new live validation. Already-public stored history remains historical content when the package is intentionally removed; removal does not certify it for a new run. HTML/JSONL export must wait for the current finalization barrier and use the same safe persisted branch; direct export during an unvalidated in-flight answer must not expose that answer. Subagent traces, returned results and peek/export follow the same generic delivery port; remove the ambient knowledge fallback only after these consumers migrate.

Provider replay is private protocol data, separate from delivery authority. Preserve the current algorithm and fixed limits; extract a single generic Node helper into the public API foundation if parent-side replay is needed for worker-loss/basic-read recovery. The CLI and host then consume that one helper rather than copy its algorithm. Domain tool-loop policy stays in the plugin. Neither helper state nor opaque references are persisted, traced or displayed. Worker failure cannot make the host report missing private signature bytes as successfully restored.

## Full knowledge workflow dependencies

Projection transport alone is not full P2. The canonical Desktop owner must instantiate the actual existing interface/service/session/publication factories. Extract the remaining Node-only state/Vault IO in UI metrics, topic memory, specialist source reads and delivery into the granted broker ports; use the same factories for local native and broker adapters. Do not create a second simplified research implementation or return fake unconfigured values for missing required dependencies.

Actual full consumers also need official same-session event semantics, recovery appendEntry/getBranch, source-derived project context and existing permission/dialog behavior. Function-rich task/acceptance messages cannot be JSON-cloned. S2 will execute acceptance providers in their true owner and return host-controlled live receipts under the current scope; this change will consume that provider contract instead of installing another registry or serializing functions. Knowledge can run as a standalone package, while combined task workflows must be tested again with that real provider path.

Published UI 1.x methods remain real until callers migrate or a genuine same-scope forwarding path exists. This implementation must not turn them into throw/no-op placeholders to remove host files. Existing compatibility wrapper versions/removal conditions remain explicit.

## Required implementation and acceptance sequence

1. Real pinned-SDK object-flow regression: handler replacements/in-place changes, adjacent handlers, context clones, public emit and append ordering, polling/export while held validation, and raw signed metadata/usage. Establish RED cases for copied/tampered/cross-session/stale references and swallowed hook failure.
2. Implement the source-derived required policy, private reference courier, real finalizer and generic event/poll/history/export boundary. Test revoked source, canceled invocation, crash/timeout and both shutdown orders; failed required projection keeps final delivery closed while basic tools remain usable.
3. Bind the existing full native knowledge interface and owner-local proof algorithm to the broker owner, replacing its direct IO adapters. Keep full tool/command registration, no Node/SDK duplication, and consume the real provider port for cross-plugin acceptance.
4. Rebuild one clean package tarball and install it without workspace symlinks. Run actual prepare → search/read → check → final publication → replay/history/restore/export in real Pi sessions and the production coordinator/worker. Verify two sessions and two owners, copied proof/real reference IDs, changed sources/binding, cancellation while validating, private protocol recovery and declared package disable/restore/upgrade/rollback. Assertions must observe the real validator and owner, not just a successful loader.
5. Run final combined dual-repository gates and repeat the workflow in the formal macOS installer, including genuine zero-domain-plugin chat. Source/SDK tests and fixture GUI previews do not substitute for that final acceptance.
