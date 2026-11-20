# P5 host seams for the blocked first wave

Design only, against `77642593de23bacbffe6fd842fa2ba7d8105e284`. The [runtime wiring plan](p5-runtime-wiring.md) remains authoritative; none of the proposed ports below exists merely because its interface is sketched here. This document does not register handlers or certify runtime acceptance.

D12=C, D13=A, D14, D15=A and D16=A are binding: staged-output declaration and host-selected directory with exact S review at open/write; extend the existing prompt with one title, a complete scrolling summary and Approve/Deny; workspace background-model Settings toggle initially off, backend FIFO scheduling and budget enforcement; explicit per-lane manifest opt-ins; existing adopted writer S authorizes F5 without new consent. Only the host issues authority. Managed plugins receive no `--allow-worker`.

All sketches are host-private additions unless identified as existing exports. `Scope` includes workspace, session and both source hashes (`packages/plugin-api/src/p5-receipts.ts:128`). A live attachment additionally carries object identity and a revocation signal: serialized scope cannot replace it (`packages/backend/src/plugins/session-caller.ts:42`). Backend owns compute and durable host records; MAIN supplies window consent and selected filesystem grants. Renderer uses shared/preload contracts only. No Pi runtime import, global bridge, cross-plugin import or new package dependency is needed (R1–R7; `docs/architecture-v2.md:202`).

## (a) Preflight / plan resolver

**Owner.** A focused module under backend `services`, composed with `ComputeService`: it already gates submission with `assertComputePreflight` before persistence or execution (`packages/backend/src/services/compute.ts:482`). Keep resolution out of MAIN, renderer and `@drone/compute`: host records, paths, approval and live caller identity are host concerns under R7. The pure validator accepts a concrete spec; it does not resolve references or grant consent (`packages/backend/src/services/compute-preflight.ts:114`).

```ts
interface P5ComputePlan {
  readonly preflightRef: string;
  readonly sha256: string;
  readonly scope: Scope;
  readonly profile: string;
  readonly image: string;
  readonly spec: ComputePreflightJobSpec;
  readonly collectionRoot: string;
  readonly expected: readonly FileReadback[];
  readonly budget: Budget;
}
declare function resolvePlan(ref: string, scope: Scope): Promise<P5ComputePlan | undefined>;
```

**Reads and durable gap.** `ComputeItem` contains only a reference (`packages/plugin-api/src/p5-discovery.ts:192`); `ResolvedP5Plan` contains profile/image/ref/hash, not the spec, collection root or expected files (`packages/backend/src/plugins/p5-batch-review.ts:8`). No pre-submit plan registry exists. Require a host-issued immutable record containing the sketch, schema version, resolved host/workflow identity and root identity; its hash covers spec, profile/image, root, ordered path/bytes/SHA-256 tuples, budget and scope. The host records the reviewed plan, never an arbitrary plugin-supplied spec or a later runner manifest presented as the earlier expectation.

No existing JsonStore holds this pre-submit binding. Add a registered host-private plan JsonStore owned by the compute composition, using the strict CAS/readback pattern of `packages/backend/src/plugins/p5-receipt-store.ts:195`; do not put spec bodies into its closed receipt schema. Existing per-job storage (`packages/backend/src/services/compute.ts:375`) owns the submitted job and its plan reference/hash once submission occurs. Plan references are never reassigned. A changed plan requires a new reference and fresh review.

**Authority chain.** The host issues the plan reference as a lookup key, then resolves it under the current live scope before constructing the review. T1 freezes the reference/hash plus item budgets (`packages/backend/src/plugins/p5-batch-review.ts:55`); its fresh C receipt must match the entire frozen batch (`packages/backend/src/plugins/p5-batch-review.ts:69`). Q1 needs the same resolved content before its prompt: today `approvalDetail` returns only `preflightRef`, and resolution happens in `observe`, after broker authorization (`packages/backend/src/plugins/p5-rerun-submit.ts:130`, `packages/backend/src/plugins/p5-rerun-submit.ts:163`, `packages/backend/src/plugins/runtime-capabilities.ts:243`). Add an awaited host preparation step after input/caller checks and before authorization; keep its immutable snapshot in invocation-owned state and use that exact value in execution. The synchronous detail callback cannot perform this lookup.

At submission recheck attachment, current C, immutable plan hash, source/profile/image identity, budget and root grant, then run the existing preflight gate. Session switch/revoke, source hash change, changed bytes/spec/root or budget invalidate admission. Historical C never issues a live reviewed object. Exact output sizes/hashes cannot be inferred for novel computations: unresolved expectations remain a blocker (decision U4). Review copy and declaration schema need U1/U2. There is no user decision about the technical resolver interface itself.

## (b) Q1 source resolver and submission association

**Owner.** Another compute composition module, adjacent to `services/inquiry-compute.ts`, consumes public receipt and compute ports. The existing Inquiry bridge guesses the original job from attempt parameters or `artifact.runId`, then calls the UI adapter's `resubmitJob` (`packages/backend/src/services/inquiry-compute.ts:55`). That is not a P5 receipt/profile binding. Q1 already specifies a host `resolve` and lookup-only `findSubmission` (`packages/backend/src/plugins/p5-rerun-submit.ts:29`); implement those without borrowing the UI path.

```ts
interface P5ComputeSourceBinding {
  readonly scope: Scope;
  readonly sourceRunReceiptRef: string;
  readonly runId: string;
  readonly jobId: string;
  readonly profile: string;
  readonly artifact: FileReadback & { readonly id: string };
  readonly collectionRoot: string;
  readonly planSha256: string;
}
declare function resolveSource(input: ComputeRerunInput, scope: Scope): Promise<P5RerunSource | undefined>;
declare function findSubmission(input: ComputeRerunInput, scope: Scope): Promise<{ jobId: string; inputSha256: string } | undefined>;
```

**Reads and durable gap.** A receipt has scope, input hash, parent and relative readback, but no job/profile/root association (`packages/plugin-api/src/p5-receipts.ts:139`). Require two host records: (1) the source binding above, issued only after successful receipt persistence and actual confined artifact readback; (2) submission intent keyed by full scope + request ID, containing Q1 input SHA, source reference, plan hash, host-allocated job ID and submission phase. The intent must be durable before invoking compute; persist the same job ID/idempotency identity in the compute job before contacting its executor (`packages/backend/src/services/compute.ts:512`).

The existing job JsonStore at `packages/backend/src/services/compute.ts:375` should own the job-side association and verified collection metadata. There is no existing reverse source/intent index: add the registered host-path JsonStore required by T164, following R1 receipt storage, with strict parsing/CAS/readback; store metadata only. Do not reconstruct authority by scanning receipt prose or arbitrary job fields. Missing old associations remain unavailable; no automatic adoption/backfill.

**Authority chain.** The host producer issues source associations, and the resolver checks an approved successful host receipt, exact scope, associated job/profile and current authorized root; it rereads the actual source file and compares bytes/hash. Q1 `prepare` checks source identity and expected SHA (`packages/backend/src/plugins/p5-rerun-submit.ts:85`). Fresh C must review source run, artifact, target plan and budget under D13. Before submit, recheck live authority and source bytes; never send caller-selected commands or inferred profiles. On lost replies, `findSubmission` reads the saved intent and `getJob` for that job ID, verifies the stored input SHA, and never submits. Existing idempotency checks spec equality, not P5 ownership (`packages/backend/src/services/compute.ts:492`). An intent without a discoverable job is uncertain, not permission to resubmit. Session/source change, revoke, replaced root or changed artifact hash makes effect authority stale. U1/U2 cover review/declaration; otherwise no user decision, no new category, credential store or SDK call.

## (c) Cleanup-confirmed cancel and drain

**Owner.** `ComputeService` owns job outcomes and in-flight operations; its executor owns transport/process evidence. Today submit/collect accept no signal, cancel returns a job status, terminal cancel returns early, reconciliation skips terminal jobs, and dispose only stops polling/listeners (`packages/backend/src/services/compute.ts:74`, `packages/backend/src/services/compute.ts:601`, `packages/backend/src/services/compute.ts:678`, `packages/backend/src/services/compute.ts:763`). A P5 adapter alone cannot repair these semantics.

```ts
type CleanupResult =
  | { readonly state: "confirmed"; readonly jobId: string }
  | { readonly state: "unknown" | "failed"; readonly jobId: string };
interface P5ComputeLifetime {
  submit(spec: ComputePreflightJobSpec, signal: AbortSignal): Promise<JobRecord>;
  collect(jobId: string, options: ComputeCollectOptions, signal: AbortSignal): Promise<ComputeCollectResult>;
  cancelAndDrain(jobId: string): Promise<CleanupResult>;
  drain(): Promise<void>;
}
```

**Reads and durable gap.** Persist cancellation intent and cleanup evidence separately from execution status in the existing per-job JsonStore (`packages/backend/src/services/compute.ts:375`): logical/remote job identity, executor kind, process creation/group or scheduler identity, observed cleanup result and observation time. Record unknown/failed cleanup durably; old terminal jobs have no cleanup proof. Reconciliation must be able to query cleanup on terminal execution without downgrading a genuine succeeded/failed outcome. Never synthesize confirmation from a status label or a missing transport response.

| Executor | What current runner actually observes | What remains unconfirmed / implementation work |
| --- | --- | --- |
| Local direct | Stores detached worker and child PIDs/creation markers (`packages/backend/resources/compute-runner/runner.py:535`, `packages/backend/resources/compute-runner/runner.py:643`); cancel attempts child then worker termination (`packages/backend/resources/compute-runner/runner.py:902`). | POSIX sends TERM, waits, then KILL without a final disappearance check; Windows tree termination can return without proof (`packages/backend/resources/compute-runner/runner.py:663`). Terminal cancel skips checks (`packages/backend/resources/compute-runner/runner.py:892`). Need explicit identity-bound group/tree quiescence and post-kill readback, including terminal jobs and start/cancel races. Escaped descendants or external daemons are not currently proven stopped. |
| SSH direct | Same runner records on the selected remote host; worker is detached from the request channel (`packages/backend/resources/compute-runner/runner.py:4`). | Closing SSH or aborting a local request does not kill remote work. Reconnect must query the same remote run and verify process identities; connection loss is unknown. Drain must also settle downloads/local writes and remove only owned transfer temporaries. Current executor copies outputs after runner collection (`packages/backend/src/compute/default-executor.ts:1364`). No remote directory/data deletion is implied. |
| Slurm | `scancel` exit success, then immediate local `cancelled` write (`packages/backend/resources/compute-runner/runner.py:894`); status can query `squeue`/`sacct` (`packages/backend/resources/compute-runner/runner.py:700`). | `scancel` is request acceptance, not stopped allocations/steps. Need retained scheduler job identity, queue/step/accounting reconciliation and an explicit cleanup result. Missing/delayed accounting, controller loss or ambiguous identity stays unknown. Current queries do not prove every process/remote side effect is gone. No Slurm PASS from a command stub. |

The executor additionally reads `value.status` from cancel although the runner returns `state`, defaulting to cancelled (`packages/backend/src/compute/default-executor.ts:1309`). Preserve explicit runner cleanup fields through the protocol and executor; remove this status-as-proof path. Runner protocol/deployment changes are real work: negotiate supported cleanup evidence; an existing runner without it is unsupported for confirmed P5 cleanup. No silent version fallback or assumed remote upgrade.

**Authority chain.** Host admission binds one job and its lifetime to the reviewed launch. An abort must stop admission immediately, cancel owned work and await its operation/cleanup promises before ports or leases release. The cleanup path retains only the exact accepted job identity, never a general execution grant. Do not let an already-aborted request signal prevent the required cleanup query. Explicit cancel policy and launch-bound teardown authority are U3; D13's prompt choice stays fixed. Preserve terminal execution outcomes even when later cleanup is unknown/failed. T3 needs an all-runs abort/drain hook (`packages/backend/src/plugins/p5-batch-lifecycle.ts:111`); T2 must not convert a swallowed cleanup error into successful cancellation (`packages/backend/src/plugins/p5-batch-execution.ts:152`). Q2 already requires confirmed cleanup in its port contract (`packages/backend/src/plugins/p5-rerun-lifecycle.ts:22`). Runtime aborts before waiting pending calls and releasing resources (`packages/backend/src/plugins/runtime.ts:528`); register cleanup on abort, not just the later disposer. U1 applies only to explicit review copy. No new category, credentials, Pi SDK call or third-party dependency.

## (d) Committed fact notification, owner cursor and live attachment

**Owners.** F1 owns commit notification: `append` already awaits checked write/readback, but the factory returns only append/read (`packages/backend/src/plugins/p5-facts.ts:117`, `packages/backend/src/plugins/p5-facts.ts:153`). Keep this local to the fact journal; JsonStore has no watcher today (`packages/backend/src/json-store.ts:240`). The actual adopted projection owner owns its committed cursor. Backend coordinator owns live attachment identity: the existing native attach/dispose site is `packages/backend/src/plugins/coordinator.ts:620`, not renderer events or a JSON service provider.

```ts
interface P5FactCommitPort {
  subscribe(scope: Pick<Scope, "workspaceId" | "sessionId">, changed: () => void): () => void;
}
interface P5CommittedProjection extends HostFactDeliveryOwner {
  cursor(): Promise<string | null>;
}
declare function attachFactOwner(owner: P5CommittedProjection, scope: Scope, signal: AbortSignal):
  { unsubscribe(): void; drain(): Promise<void> };
```

**Commit semantics.** Notify only after F1 atomic commit and successful strict readback; failed CAS/write/readback and idempotent duplicate append emit no new-commit signal. Callback payload conveys no authority or fact body: delivery rereads scoped F1. Own subscribers on the profile's single fact-store instance; no filesystem watcher/global bus. Subscribe before the initial cursor read/catch-up, as F5 already does (`packages/backend/src/plugins/p5-host-delivery.ts:43`), to avoid a subscribe/read gap. Observer failure must not relabel a committed append as failed; report delivery failure through its drain. The fact journal remains its existing `agent-p5-facts` JsonStore.

**Cursor gap.** F5 caches its cursor only in memory (`packages/backend/src/plugins/p5-host-delivery.ts:35`). The public owner contract acknowledges only after projection and cursor commit (`packages/plugin-api/src/p5-inquiry.ts:324`); it supplies neither a cursor reader nor a concrete owner (`packages/plugin-api/src/p5-inquiry.ts:331`). Add, in the canonical owner's existing projection transaction, a durable record keyed by workspace/session, fact-journal identity and projection schema: last consumed fact ID/sequence and its hash. Persist projection and cursor atomically, acknowledge only that committed prefix, and read this marker on reattachment; a lost acknowledgement must replay without applying the committed prefix twice. Never cross gaps; sequence numbers are workspace-wide while reads are session-filtered (`packages/backend/src/plugins/p5-facts.ts:112`, `packages/backend/src/plugins/p5-facts.ts:129`), so numeric adjacency alone cannot define a missing fact.

No host JsonStore should own a second cursor ledger. If the adopted projection is SQLite, its sole existing owner must add the marker to that same transaction; the legacy host SQLite connection (`packages/backend/src/services/inquiry.ts:250`) must not be reopened as an F5 writer. No live canonical P5 projection implementation is present at this base. Its package-side implementation/path needs a separately verified owner ticket before T166 can be unblocked; this design does not invent that package's internals. `recordAdoptions` adopts session checkpoints, not filesystem writer authority (`packages/backend/src/session-engine/session-records.ts:155`).

**Attachment and authority chain.** Expose an optional host-private cursor/deliver facade on the real managed attachment; today's facade has only publication projection (`packages/backend/src/plugins/runtime.ts:33`). Add actual attachment-bound transport on both parent and restricted worker, following the existing native attachment/courier ownership (`packages/backend/src/plugins/process-runtime.ts:712`); do not serialize a forged `HostFactDeliveryHandle` or route it through a public capability/native-provider call. Host issues the live attachment/handle, F5 checks exact current object, both source hashes and signal, and (e) checks S before each delivery. Owner commits, then acknowledges; host validates the returned cursor belongs to the delivered batch (`packages/backend/src/plugins/p5-host-delivery.ts:92`). Before each fact commit the owner must recheck the host-bound revocation/write fence, including within a batch. Session switch, disable, hash change, root/lease revoke or owner replacement stops further writes. Unsubscribe first, drain, then release the owner. U2 governs opt-in only; otherwise no user decision. D16 supplies S; no new consent, credential storage, SDK call or dependency.

## (e) Per-delivery adopted-writer authorization query

**Owners.** MAIN owns activation-local selected grants (`packages/desktop/src/main/ui-plugins/desktop-resource-capabilities.ts:174`); backend `PluginFileCapabilities` owns root identity and actual writer reservations (`packages/backend/src/plugins/file-capabilities.ts:94`, `packages/backend/src/plugins/file-capabilities.ts:298`). Add a host-only query there and project a narrow closure through resource composition. Do not expose paths, grant mutation or a new worker capability. Neither a manifest flag nor `roots.describe` is proof of an adopted writer lease.

```ts
interface P5AdoptedWriter {
  readonly attachment: object;
  readonly scope: Scope;
  readonly rootHandle: string;
  readonly relativeDirectory: string;
  readonly signal: AbortSignal;
}
declare function authorizeDelivery(writer: P5AdoptedWriter): Promise<boolean>;
```

**Reads and persistence.** Query current selected S write grant, its StorageRegistry root, canonical root/device/inode, the exact adopted owner's existing `state-writers` reservation and live scope/source identity. Reuse root checks and lease assertions, including overlapping parents (`packages/backend/src/plugins/file-capabilities.ts:161`, `packages/backend/src/plugins/file-capabilities.ts:367`). The query neither acquires a lease nor creates a grant. Adoption links owner object to its already-approved root/lease in host-owned activation state; no new durable grant record or JsonStore, and no restored record can reauthorize it. The current modules expose no such combined callable query.

**Authority chain.** Host directory selection issues S; the host's accepted adoption binds that grant/reservation to the actual owner; F5 calls the query immediately before `owner.deliver` (`packages/backend/src/plugins/p5-host-delivery.ts:92`). Carry its revocation fence into each owner commit so a successful query cannot authorize the remainder of a subsequently revoked batch. Require the same root identity and lease at write commit. Root replacement/removal, registry mismatch, lease release, session/source change or abort denies; failed cleanup retains reservations (`packages/backend/src/plugins/file-capabilities.ts:316`). D16=A already decides consent reuse: no user decision, no new prompt/category/issuer, credential store, Pi call or dependency. U2 only gates manifest eligibility.

## (f) Public freeze exports for exact W/T content

**Owner.** Backend's plugin public barrel, `packages/backend/src/plugins/public-exports.ts:27`; root already re-exports it (`packages/backend/src/index.ts:127`). Export the existing values/types, preserving reference identity; MAIN imports only the backend public entry. Do not copy freeze logic into desktop or make plugin-api depend on backend.

```ts
export { freezeP5Bundle, type FrozenP5Bundle } from "./p5-bundle-review";
export { freezeP5Batch, type FrozenP5Batch } from "./p5-batch-review";
```

**Data and authority.** W freezes files, destination/audience and scope (`packages/backend/src/plugins/p5-bundle-review.ts:30`); T freezes items/resolutions/budgets/scope (`packages/backend/src/plugins/p5-batch-review.ts:40`). Exporting them confers no review authority: only host reviewer instances issue live reviewed objects. No durable record or new JsonStore. W's canonical output root is not inside `FrozenP5Bundle`; the host must supply it separately and bind it with the bundle hash in live C. T's spec/output detail comes from (a)'s hashed plan, not fields invented by the formatter. No user decision for these four exports; U1 covers later copy only. Existing public export tests enforce an exact list and must be updated (`packages/backend/src/plugins/p5-public-exports.test.ts:33`).

## Remaining decisions: forward verbatim, choose none

The fixed D12–D16 choices above are not alternatives in this list. All six seams reuse S/C/M; C is a receipt/effect boundary, not a new manifest approval category. None proposes storing credentials, changing a Pi SDK call, changing who issues authorizations, or adding a third-party dependency.

- **USER DECISION U1 — exact bilingual copy.** D12's staged-directory grant and D13's existing prompt require new labels/explanations; current root/prompt copy is at `packages/desktop/src/main/ui-plugins/runtime-host.ts:69` and `packages/desktop/src/main/ui-plugins/runtime-host.ts:226`, and current file summaries truncate at `packages/desktop/src/main/ui-plugins/desktop-resource-capabilities.ts:110`. Options: A approve a subsequent complete minimal zh/en copy table after reviewing it; B request edits to that table; C hold the affected lane pending copy approval. No wording is selected here; one title, full scrolling summary and Approve/Deny remain fixed. Both host i18n dictionaries must be updated by the copy ticket. D14's Settings copy belongs to its separate model-scheduler work.
- **USER DECISION U2 — exact per-lane declaration schema.** D12 requires the staged-output declaration and D15 requires explicit per-lane P5 fields; current decoder has only coarse filesystem/model/container gates (`packages/desktop/src/main/ui-plugins/installed-package-sources.ts:345`). Options: A one boolean field per lane; B one version-valued field per lane; C one closed versioned declaration object per lane. Exact keys/accepted values require approval before API/decoder changes. None of these declarations grants authority; D15 opt-in itself is not reopened.
- **USER DECISION U3 — cancellation coverage.** T3's explicit cancel currently has no forced C policy (`packages/backend/src/plugins/p5-batch-lifecycle.ts:79`), Q2 forces approval (`packages/backend/src/plugins/p5-rerun-lifecycle.ts:172`), and runtime aborts before drain (`packages/backend/src/plugins/runtime.ts:528`). Options: A retain T3 task-grant-or-prompt and Q2 fresh C for explicit cancel, with reviewed launch covering exact owned-job teardown on abort; B require fresh C for both explicit cancels, with the same launch-bound teardown coverage; C hold compute execution until explicit-cancel and teardown coverage are approved. No option authorizes new jobs or arbitrary deletion during cleanup; D13's prompt format is unchanged.
- **USER DECISION U4 — computations without known output bytes/hashes.** T2 requires expected readback before executing (`packages/backend/src/plugins/p5-batch-execution.ts:82`), while current collection obtains checksums after execution (`packages/backend/resources/compute-runner/runner.py:837`). Options: A limit this lane to plans with host-verified exact expected path/bytes/SHA-256 tuples; B approve a separate post-run exact C review before collection writes, requiring a revised lifecycle contract; C keep such computations unavailable. Never fill unknown expectations from the output being checked or silently change exact review to path-only review.

## Ordered implementation cuts

All estimates count additions **and deletions**, including tests, with a hard 350-line ticket cap. New filenames below are proposed outputs, not base evidence. Prefixes: `P` = `packages/backend/src/plugins`, `S` = `packages/backend/src/services`, `E` = `packages/backend/src/compute`, `M` = `packages/desktop/src/main/ui-plugins`. `B(test)` means the exact command `npm run test -w @drone/backend -- <test>`; `D(test)` means `npm run test -w @drone/desktop -- <test>`. Tests named here must be added by their owning cut; they are not claimed to run on this base.

**Structure first within each affected owner cut.** Baseline oversized owners are compute (903), default executor (1455), file capabilities (941), runtime (734), coordinator (893) and process runtime (995), with decoder (488) reserved for the declaration follow-up (`scripts/fixtures/structure-baseline.json:13`, `scripts/fixtures/structure-baseline.json:18`, `scripts/fixtures/structure-baseline.json:73`). Extract only the affected responsibility into the named small module before adding behavior; manager keeps the pure move and behavior in separate commits. Count both patches within the ticket cap. Old owners must shrink; every new module stays at most 400 lines/functions at most 60. The Python runner (973 lines) also needs its termination logic split first, although the JS structure checker does not scan Python (`scripts/check-structure.mjs:28`). No baseline changes in T168; manager must explicitly authorize lowering-only baseline maintenance for those later structural cuts. If measured edits exceed a cap, stop and have the manager recut ownership, never compress code or increase a baseline.

| Order / cap | Exclusive files and result | Focused command | Unblocks |
| --- | --- | --- | --- |
| H1 / 100 | `P/public-exports.ts`, existing `P/p5-public-exports.test.ts`: only the four freeze exports. | `B(src/plugins/p5-public-exports.test.ts)` | T163 W/T imports |
| H2 / 320 | New `S/p5-compute-plans.ts`, `.test.ts`: registered immutable plan store/resolver, scope/hash/budget/root tests; no approval issuance. | `B(src/services/p5-compute-plans.test.ts)` | T164, T165 plan prerequisite |
| H3 / 320; after H2 | New `S/p5-compute-sources.ts`, `.test.ts`: source binding issuer/resolver and current byte readback. | `B(src/services/p5-compute-sources.test.ts)` | T164 source prerequisite |
| H4 / 350; after H2/H3 | `P/runtime-capabilities.ts`, new `P/p5-review-preparation.ts`, `.test.ts`: awaited host preparation with the exact invocation snapshot used by prompt/effect; stale/changed-plan tests. | `B(src/plugins/p5-review-preparation.test.ts)` | T163 resolved Q review |
| H5 / 350; U3 resolved | Runner resource `runner.py` (kept as one deployable file; no sibling `cleanup.py`), new `scripts/test-compute-cleanup.py`: identity-bound direct/Slurm cleanup evidence, unsupported-runner behavior, and a durable `cancel-requested.json` marker written before cleanup so a job ended by its own cancel records `cancelled` (D17=A). | `python3 scripts/test-compute-cleanup.py` | T165 cleanup prerequisite |
| H6 / 350; after H5 | `E/default-executor.ts`, new `E/compute-operation-lifetime.ts`, `.test.ts`: split cancellation tracking first; propagate signals/evidence, settle transfer writes, verify deployment of the runner. | `B(src/compute/compute-operation-lifetime.test.ts)` | T164/T165 safe compute prerequisite |
| H7 / 350; after H6 | `S/compute.ts`, new `S/compute-cleanup.ts`, `.test.ts`: split cancel/dispose first, then durable job association/cleanup, signal-aware submit/collect, terminal cleanup query and in-flight drain. | `B(src/services/compute-cleanup.test.ts)` | T164/T165 service prerequisite; later Q2 |
| H8 / 300; after H7 | `P/p5-batch-execution.ts`, `P/p5-batch-lifecycle.ts`, new `P/p5-batch-drain.test.ts`: all-runs abort/drain; unknown/failed cleanup cannot become cancelled success. | `B(src/plugins/p5-batch-drain.test.ts)` | T165 lifecycle prerequisite |
| H9 / 240 | `P/p5-facts.ts`, new `P/p5-fact-commits.test.ts`: committed notification, no failed/duplicate signals, initial catch-up race. | `B(src/plugins/p5-fact-commits.test.ts)` | T166 subscription prerequisite |
| H10 / 350 | `P/file-capabilities.ts`, new `P/plugin-writer-authority.ts`, `.test.ts`: split root/lease checks first, then a read-only owner-bound authorization query. | `B(src/plugins/plugin-writer-authority.test.ts)` | T166 S query prerequisite |
| H11 / 300; after H10 | `M/desktop-resource-capabilities.ts`, new `M/p5-writer-query.ts`, `.test.ts`: project query closure from real grant/lease, test revoke/root replacement; keep the 343-line owner within 400. | `D(src/main/ui-plugins/p5-writer-query.test.ts)` | T166 grant composition prerequisite |
| H12 / 350 | `P/runtime.ts`, new `P/p5-owner-facade.ts`, `.test.ts`: split attachment facade first; typed host-only committed cursor/delivery facade and invalidation. | `B(src/plugins/p5-owner-facade.test.ts)` | T166 live owner prerequisite |
| H13 / 350; after H12 | `P/process-runtime.ts`, new `P/process-fact-delivery.ts`, `.test.ts`: split native transport handling first; parent-side scoped courier and drain. | `B(src/plugins/process-fact-delivery.test.ts)` | T166 transport prerequisite |
| H14 / 320; after H13 | `P/process-runtime-worker.ts`, new `P/worker-fact-delivery.ts`, `.test.ts`: attachment-only worker route, origin/revocation checks; no worker privilege change. | `B(src/plugins/worker-fact-delivery.test.ts)` | T166 transport prerequisite |
| H15 / 350; after H9/H11/H14 and real canonical owner | `P/coordinator.ts`, new `P/p5-owner-attachments.ts`, `.test.ts`: split attachment orchestration first; adopt current callback/scope/hashes/signal, unsubscribe/drain before release. | `B(src/plugins/p5-owner-attachments.test.ts)` | T166 attachment prerequisite |

File sets in H1–H15 are disjoint; no row may silently edit another row's owner. MAIN imports for new host ports can use a separate focused public barrel in a later composition cut, rather than widening H1's four-export contract. New module index entries are a manager-owned documentation follow-up, not concurrent ownership of `docs/INDEX.md` by every worker.

After these prerequisites, re-dispatch T164 and T165 in their original disjoint new port/test files (each still capped at 350 changed lines). T164 additionally needs its durable submission-intent store; T165 needs its durable reviewed-batch index, with historical entries reconciliation-only and the live reviewer WeakSet still required. Their original tests must use real ComputeService fixtures, lookup-only lost-response recovery and real byte readback. Exact commands: `npm run test -w @drone/backend -- src/services/p5-rerun-submit-ports.test.ts src/plugins/p5-rerun-submit.test.ts` and `npm run test -w @drone/backend -- src/services/p5-batch-ports.test.ts`.

T163 can resume W/T content after H1, but exact Q content additionally needs H2–H4 and bound source/target data; its command remains `npm run test -w @drone/desktop -- src/main/ui-plugins/p5-review-content.test.ts`. U1 copy stays reviewable and unapproved. T166 cannot resume until H9–H15 **and** a verified canonical owner's projection+cursor transaction/callback land; its host-only port/test files remain exclusive, with command `npm run test -w @drone/backend -- src/plugins/p5-delivery-ports.test.ts src/plugins/p5-host-delivery.test.ts`. The external owner's source is not available in this base: exact package file ownership and its focused test command are an open manager prerequisite, not an invented implementation ticket.

Final runtime composition remains a later, separately cut Z1d/Z2 task after U1/U2 and all relevant ports exist. `runtime-host.ts` must drain P5 before resource dependencies (`packages/desktop/src/main/ui-plugins/runtime-host.ts:189`); never call the legacy local-bypass compute prompt for P5 (`packages/desktop/src/main/index.ts:66`). D12/D14/D15 declaration, staged roots and model scheduler work are not fabricated prerequisites in these six adapters; model items remain rejected (`packages/backend/src/plugins/p5-batch-execution.ts:141`). Before changing decoder/source/IPC/UI contracts, dispatch disjoint owner cuts with their structural splits and approved U1/U2 schema/copy. No placeholders or advertised unavailable handlers. Focused tests validate behavior; only later real sessions/installed packages can supply runtime PASS.
