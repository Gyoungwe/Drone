# Analysis lifecycle contract proposal

Status: proposed for manager review; no implementation or host switch. T73 follows item 4 of `docs/pluginization/inventory-analysis-services.md:262`. Scientific parity target: the vendored **pi-analysis 0.2.0**, not the backend development dependency's 0.1.2. All tickets and commands below are proposed work, not executed acceptance.

## Scope

The proposed boundary follows the public-contract/domain/host split in `docs/architecture-v2.md:157`. The plugin receives immutable records and returns replacement records; it gets no storage, session, execution or model authority from this contract.

| Moves to pi-analysis lifecycle policy | Current evidence |
| --- | --- |
| Seven stages, stage capability selection and capability request text | `packages/shared/src/analysis-orchestration.ts:5`, `packages/shared/src/analysis-orchestration.ts:156`, `packages/shared/src/analysis-orchestration.ts:386` |
| Create/design/readiness/execution/review/delivery/resume transitions and appended events | `packages/shared/src/analysis-orchestration.ts:246`, `packages/shared/src/analysis-orchestration.ts:269`, `packages/shared/src/analysis-orchestration.ts:297`, `packages/shared/src/analysis-orchestration.ts:303`, `packages/shared/src/analysis-orchestration.ts:312`, `packages/shared/src/analysis-orchestration.ts:328`, `packages/shared/src/analysis-orchestration.ts:359`, `packages/shared/src/analysis-orchestration.ts:378` |
| Compose adapter assessment with host-observed authorization/destructive-operation facts; publication pause remains at delivery | `packages/shared/src/analysis-orchestration.ts:199`, `packages/shared/src/analysis-orchestration.ts:226`, `packages/shared/src/analysis-orchestration.ts:365` |
| Review/event/provenance record shapes; binding replacement and provenance initialization; scientific-only fork policy | `packages/shared/src/analysis-orchestration.ts:65`, `packages/shared/src/analysis-orchestration.ts:100`, `packages/shared/src/analysis-orchestration.ts:115`, `packages/backend/src/services/analysis-orchestration.ts:72`, `packages/backend/src/services/analysis-orchestration.ts:108` |

| Stays host-owned | Current evidence and boundary |
| --- | --- |
| JsonStore persistence and storage registration | `packages/backend/src/create-backend.ts:587`, `packages/backend/src/services/analysis-orchestration.ts:180`; atomic rename and corruption refusal remain in `packages/backend/src/json-store.ts:8`, `packages/backend/src/json-store.ts:120`. Plugin output is a proposal until a host write succeeds. |
| Authorization, approval issuance and Compute preflight/submission | `packages/backend/src/services/analysis-orchestration.ts:42`, `packages/backend/src/services/analysis-task-controller.ts:108`, `packages/backend/src/services/analysis-task-controller.ts:319`. `approveExecution` names a lifecycle transition, not a grant. |
| Live writable-session checks and actual capability activation | `packages/backend/src/create-backend.ts:915`, `packages/backend/src/create-backend.ts:963`; the plugin may select capability IDs, never activate them itself through this contract. |
| Model selection/invocation and spending approval | Current invocation is `packages/backend/src/create-backend.ts:918`. Review parsing/content policy can move separately from this IO; malformed decisions currently fail closed at `packages/backend/src/services/analysis-review-decision.ts:11`. |
| Artifact collection, path confinement, checksum verification and report byte IO | `packages/backend/src/services/analysis-task-controller.ts:184`, `packages/backend/src/services/analysis-task-controller.ts:234`, `packages/backend/src/services/analysis-artifacts.ts:18`. The existing direct report write needs an authorized host port in inventory ticket 7; this proposal does not claim that port exists. |
| Causal ID issuance and cross-ledger projection | Issuance at `packages/backend/src/services/analysis-task-controller.ts:120`; projection at `packages/backend/src/services/causality-projection.ts:47` omits missing lineage via `packages/backend/src/services/causality-projection.ts:121`. No lifecycle timestamp becomes causal proof. |

Vendored `host.mjs` provides registry/adapters, not a lifecycle owner (`vendor/plugins/pi-analysis/dist/host.mjs:1116`); native tools only list adapters, assess science and prepare evidence (`vendor/plugins/pi-analysis/dist/index.mjs:1181`, `vendor/plugins/pi-analysis/dist/index.mjs:1197`, `vendor/plugins/pi-analysis/plugin.manifest.json:19`). The smaller adapter context lacks durable state (`vendor/plugins/pi-analysis/dist/analysis-contract.d.ts:34`). Keep 0.2.0 science intact: frozen DESeq2 planning and full-file/comparator hooks already exist (`vendor/plugins/pi-analysis/dist/host.mjs:1016`, `vendor/plugins/pi-analysis/dist/analysis-contract.d.ts:189`). Wiring those hooks into the host is a separate behavior ticket, as required by the inventory; current host review calls `reviewResults` (`packages/backend/src/services/analysis-task-controller.ts:204`).

## Contract

Proposed exact contents of `packages/plugin-api/src/analysis-lifecycle.ts` follow. These new names avoid changing the existing adapter `AnalysisContext`, scientific gate union, registry or loader (`packages/plugin-api/src/index.ts:384`, `packages/plugin-api/src/index.ts:507`). Existing shared names remain until consumer migration. The contract version describes operations, **not** a new persisted schema.

```ts
import type {
  AnalysisContext, AnalysisGateCode, AnalysisIdentity, AnalysisMode, AnalysisReviewCheck,
} from "./index.js";

export const ANALYSIS_LIFECYCLE_CONTRACT_VERSION = 1 as const;
export type AnalysisLifecycleStage =
  | "intake" | "design" | "readiness" | "execution" | "review" | "delivery" | "completed";
export type AnalysisLifecycleStatus = "active" | "paused" | "blocked" | "completed";
export type AnalysisLifecycleCapability =
  | "knowledge" | "research" | "analysis" | "literature" | "writing" | "planning"
  | "coding" | "web" | "files" | "visualization" | "external";
export type AnalysisLifecycleGateCode = AnalysisGateCode
  | "unsupported-assay" | "compute-authorization-required"
  | "destructive-operation-requires-review" | "publication-requires-review";
export interface AnalysisLifecycleGate {
  readonly code: AnalysisLifecycleGateCode;
  readonly severity: "pause" | "block";
  readonly message: string;
  readonly evidenceKey: string;
}
export interface AnalysisLifecycleReadiness {
  readonly ok: boolean;
  readonly inferentialClaimsAllowed: boolean;
  readonly gates: readonly AnalysisLifecycleGate[];
  readonly warnings: readonly string[];
}
export interface AnalysisLifecycleReadinessInput {
  readonly mode: AnalysisMode;
  readonly assay: string;
  readonly assessment: AnalysisLifecycleReadiness;
  readonly computeAuthorized: boolean;
  readonly destructiveOperation?: boolean;
  readonly publicationRequested?: boolean;
}
export interface AnalysisLifecycleLineage {
  readonly schemaVersion: 1;
  readonly eventId: string;
  readonly causationId?: string;
  readonly runAttemptId?: string;
}
export interface AnalysisLifecycleArtifactVersion {
  readonly artifactId: string;
  readonly versionId: string;
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly role: "input" | "output" | "review";
  readonly accessLevel?: "public" | "restricted" | "private";
  readonly parentVersionIds: readonly string[];
  readonly producedByJobId?: string;
}
export interface AnalysisLifecycleExecutionContext {
  readonly schemaVersion: 1;
  readonly revision: string;
  readonly observedAt: string;
  readonly source: "runner" | "host" | "replay";
  readonly values: Readonly<Record<string, string | number | boolean | null>>;
}
export interface AnalysisLifecycleProvenance {
  readonly adapter: AnalysisIdentity;
  readonly workflow: AnalysisIdentity;
  readonly method: AnalysisIdentity;
  readonly specSha256: string;
  readonly adapterSnapshotSha256?: string;
  readonly toolContractSha256?: string;
  readonly executionContext?: AnalysisLifecycleExecutionContext;
  readonly artifacts: readonly AnalysisLifecycleArtifactVersion[];
  readonly lineage?: AnalysisLifecycleLineage;
  readonly reproducibility: {
    readonly status: "not-assessed" | "recorded" | "verified" | "failed";
    readonly detail: string;
    readonly environmentFingerprint?: string;
    readonly checkpointId?: string;
  };
}
export interface AnalysisLifecycleReview {
  readonly approved: boolean;
  readonly detail: string;
  readonly limitations: readonly string[];
  readonly reportPath?: string;
  readonly checks?: readonly AnalysisReviewCheck[];
  readonly modelStatus?: "approved" | "rejected" | "unavailable";
}
export interface AnalysisLifecycleEvent {
  readonly type: "created" | "design-recorded" | "readiness-assessed"
    | "execution-approved" | "execution-finished" | "review-finished"
    | "delivered" | "paused" | "resumed";
  readonly at: string;
  readonly detail?: string;
}
export interface AnalysisLifecycleContext extends AnalysisContext {
  readonly branchOf?: {
    readonly analysisId: string;
    readonly checkpointId: string;
    readonly workspace: string;
  };
  readonly stage: AnalysisLifecycleStage;
  readonly status: AnalysisLifecycleStatus;
  readonly capabilities: readonly AnalysisLifecycleCapability[];
  readonly readiness: AnalysisLifecycleReadiness | null;
  readonly review?: AnalysisLifecycleReview;
  readonly provenance?: AnalysisLifecycleProvenance;
  readonly publicationRequested: boolean;
  readonly events: readonly AnalysisLifecycleEvent[];
}
export interface AnalysisLifecycleComputeBinding {
  readonly jobId: string;
  readonly specSha256: string;
  readonly adapter: AnalysisIdentity;
  readonly workflow: AnalysisIdentity;
  readonly method: AnalysisIdentity;
  readonly adapterSnapshotSha256: string;
  readonly toolContractSha256: string;
  readonly executionContext?: AnalysisLifecycleExecutionContext;
  readonly requiredOutputs: readonly string[];
  readonly inputs: readonly AnalysisLifecycleArtifactVersion[];
  readonly lineage?: AnalysisLifecycleLineage;
}
export interface AnalysisLifecycleLedger {
  readonly version: 1;
  readonly runs: Readonly<Record<string, AnalysisLifecycleContext>>;
  readonly bindings?: Readonly<Record<string, AnalysisLifecycleComputeBinding>>;
}
export interface AnalysisLifecycleCreateInput {
  readonly id: string;
  readonly question: string;
  readonly assay: string;
  readonly mode: AnalysisMode;
  readonly adapter?: AnalysisIdentity;
}
export interface AnalysisLifecycleReviewInput {
  readonly outputsVerified: boolean;
  readonly detail?: string;
  readonly review?: AnalysisLifecycleReview;
  readonly provenance?: AnalysisLifecycleProvenance;
}
export type AnalysisLifecycleCommand =
  | { readonly type: "create"; readonly input: AnalysisLifecycleCreateInput }
  | { readonly type: "fork-checkpoint"; readonly snapshot: AnalysisLifecycleContext;
      readonly branch: { readonly id: string; readonly checkpointId: string; readonly workspace: string } }
  | { readonly type: "record-design"; readonly id: string; readonly detail?: string }
  | { readonly type: "assess-readiness"; readonly id: string;
      readonly input: AnalysisLifecycleReadinessInput; readonly binding?: AnalysisLifecycleComputeBinding }
  | { readonly type: "approve-execution"; readonly id: string }
  | { readonly type: "record-execution"; readonly id: string;
      readonly result: { readonly ok: boolean; readonly detail?: string } }
  | { readonly type: "finish-review"; readonly id: string; readonly input: AnalysisLifecycleReviewInput }
  | { readonly type: "complete"; readonly id: string;
      readonly input?: { readonly publicationApproved?: boolean; readonly detail?: string } }
  | { readonly type: "resume"; readonly id: string };
export interface AnalysisLifecycleClock {
  readonly at: string;
}
export interface AnalysisLifecycleResult {
  readonly record: AnalysisLifecycleLedger;
  readonly events: readonly AnalysisLifecycleEvent[];
}
export interface AnalysisLifecyclePort {
  readonly contractVersion: typeof ANALYSIS_LIFECYCLE_CONTRACT_VERSION;
  empty(): AnalysisLifecycleLedger;
  get(record: AnalysisLifecycleLedger, id: string): AnalysisLifecycleContext | undefined;
  list(record: AnalysisLifecycleLedger): readonly AnalysisLifecycleContext[];
  getComputeBinding(record: AnalysisLifecycleLedger, id: string): AnalysisLifecycleComputeBinding | undefined;
  assessReadiness(input: AnalysisLifecycleReadinessInput): AnalysisLifecycleReadiness;
  capabilitiesForStage(stage: AnalysisLifecycleStage): readonly AnalysisLifecycleCapability[];
  capabilityLoadRequest(context: Pick<AnalysisLifecycleContext, "stage" | "assay" | "question">): {
    readonly capabilities: readonly AnalysisLifecycleCapability[];
    readonly task: string;
  };
  apply(record: AnalysisLifecycleLedger, command: AnalysisLifecycleCommand,
    clock: AnalysisLifecycleClock): AnalysisLifecycleResult;
}
export interface AnalysisLifecycleHostLoader {
  readonly contractVersion: typeof ANALYSIS_LIFECYCLE_CONTRACT_VERSION;
  load(): AnalysisLifecyclePort;
}
```

`apply` is synchronous and deterministic for its three arguments, never mutates them, and throws on an invalid transition. `clock.at` is a host-generated ISO timestamp used verbatim for the one newly appended event. IDs, checkpoint IDs, jobs and lineage are already explicit input; no new ID generator, callback, global clock, IO port or approval token is needed. `result.events` is precisely the target run's appended suffix; it is also in `record.runs[id].events`, never persisted twice. Queries return no events; `list` retains ID `localeCompare` sorting. This is a stateless owner of decisions over injected records, not a second ledger cache.

| Proposed operation | Replaces current method/pure export |
| --- | --- |
| `empty`, `get`, `list`, `getComputeBinding` | `emptyAnalysisLedger`, service `get/list/getComputeBinding` (`packages/backend/src/services/analysis-orchestration.ts:96`, `packages/backend/src/services/analysis-orchestration.ts:145`, `packages/backend/src/services/analysis-orchestration.ts:195`) |
| `apply(create)` | orchestrator/service `create` (`packages/shared/src/analysis-orchestration.ts:246`, `packages/backend/src/services/analysis-orchestration.ts:56`) |
| `apply(fork-checkpoint)` | service `forkCheckpoint` (`packages/backend/src/services/analysis-orchestration.ts:73`) |
| `apply(record-design)` | orchestrator/service `recordDesign` (`packages/shared/src/analysis-orchestration.ts:297`, `packages/backend/src/services/analysis-orchestration.ts:104`) |
| `assessReadiness`, `apply(assess-readiness)` | pure `assessAnalysisReadiness`, orchestrator/service `assessReadiness`, including binding/provenance policy (`packages/shared/src/analysis-orchestration.ts:199`, `packages/shared/src/analysis-orchestration.ts:269`, `packages/backend/src/services/analysis-orchestration.ts:108`) |
| `apply(approve-execution)`, `apply(record-execution)` | orchestrator/service `approveExecution/recordExecution` (`packages/shared/src/analysis-orchestration.ts:303`, `packages/shared/src/analysis-orchestration.ts:312`, `packages/backend/src/services/analysis-orchestration.ts:149`) |
| `apply(finish-review)` | orchestrator/service `finishReview` (`packages/shared/src/analysis-orchestration.ts:328`, `packages/backend/src/services/analysis-orchestration.ts:157`) |
| `apply(complete)`, `apply(resume)` | orchestrator/service `complete/resume` (`packages/shared/src/analysis-orchestration.ts:359`, `packages/shared/src/analysis-orchestration.ts:378`, `packages/backend/src/services/analysis-orchestration.ts:169`) |
| `capabilitiesForStage`, `capabilityLoadRequest` | `capabilitiesForAnalysisStage`, `capabilityLoadRequest` (`packages/shared/src/analysis-orchestration.ts:386`, `packages/shared/src/analysis-orchestration.ts:391`) |

The plugin exports **additional** `analysisLifecycleHostLoader` from its existing `host` entry; existing `analysisHostLoader`, registry and tools remain unchanged. No native tool accepts these mutation commands. The old loader stays version 1; the new loader negotiates lifecycle version 1 independently. Missing/new-version loader is unavailable for a future lifecycle consumer; it must never silently select the old host algorithm. No consumer switches in the three preparatory tickets.

API delivery is additive to the local 1.3 candidate (`packages/plugin-api/README.md:29`): add a package subpath `./analysis-lifecycle` and re-export the new symbols from `src/runtime.ts`, following `packages/plugin-api/src/runtime.ts:1`. Do not grow the already oversized root `index.ts`, rename/widen existing scientific types or require a new field on old `AnalysisHostPort`. The separate subpath and type-only imports introduce no Node/Pi dependency. Version publication remains decision 1.

Proposed public helper signature in `packages/plugin-api/src/analysis-lifecycle-validation.ts` (re-exported by the runtime barrel; the new subpath exposes the contract above):

```ts
export declare function assertAnalysisLifecycleResult(
  before: AnalysisLifecycleLedger,
  command: AnalysisLifecycleCommand,
  clock: AnalysisLifecycleClock,
  result: unknown,
): asserts result is AnalysisLifecycleResult;
```

The helper implements boundary validation, not another lifecycle reducer. Validate the exact v1 JSON shape recursively (required/optional fields, enums, finite numbers, arrays, identity shapes, lineage schema/ID rules), with no coercion or default filling. Unknown persisted versions/fields must be refused for mutation and preserved on disk for explicit review. Do not reject old v1 records merely for missing optional adapter, binding, provenance or lineage. The lineage wire shape matches `packages/shared/src/causality.ts:22`; host branding/issuance stays host-owned.

At future cutover, the host loads the current record inside the JsonStore transaction, supplies a detached immutable copy and trusted command/time, and validates the unknown result before commit. Check ledger keys against run IDs, target-only changes, immutable identity/question/assay/mode/branch origin, unchanged unrelated runs/bindings, preserved event prefix and exactly one matching event at `clock.at`. Match changed binding/provenance/review data to the host-supplied command, enforce the command's field allowlist, event kind and legal stage/status edges (no advancement past failed execution or rejected review), and verify publication pause/delivery against the current host decision. `complete` permits `paused` or `delivered` according to that decision; readiness may clear its binding; fork/create may only add the new run. These are integrity checks, not scientific reassessment. Invalid output throws, does not write and does not report success. JsonStore write/readback or capability receipt failures remain visible; events fan out only after durable success. The host separately rechecks live authorization/preflight before every actual effect; stored readiness, review approval and `execution-approved` events never substitute for it.

## Record compatibility

The current `analysis/runs.json` is exactly the `AnalysisLedger` envelope below (`packages/backend/src/services/analysis-orchestration.ts:16`); its path/schema are registered at `packages/backend/src/create-backend.ts:587`. This is a type description, not user data:

```ts
type CurrentRunsFile = {
  version: 1;
  runs: Record<string, AnalysisContext>; // shared durable context, not plugin-api adapter context
  bindings?: Record<string, AnalysisComputeBinding>;
};
```

The proposed ledger/context/binding types above spell out the same nested JSON fields. `readonly` changes caller mutation discipline only. No migration, wrapper, lifecycle version, namespace prefix, regenerated ID or timestamp is written. An unchanged read does not rewrite bytes; normal updates keep JsonStore serialization. The contract does not promise byte-for-byte reserialization ordering.

| Current field(s), including every nested field | Unchanged read/write rule and evidence |
| --- | --- |
| Ledger `version`, `runs`, optional `bindings` | Version remains 1; same run-keyed dictionaries. An omitted bindings map stays omitted except readiness assessment, which currently initializes `{}` even without a successful binding (`packages/backend/src/services/analysis-orchestration.ts:16`, `packages/backend/src/services/analysis-orchestration.ts:119`). |
| Context `version`, `id`, `question`, `assay`, `mode`, optional `adapter.{id,version}` | Inherit the identical public base; existing IDs are read verbatim. Only new creation uses the current NFKC/whitespace/bounded-text and safe-ID normalization; assay's host limit remains 512, even though native adapter creation uses 128 (`packages/shared/src/analysis-orchestration.ts:166`, `packages/shared/src/analysis-orchestration.ts:253`, `vendor/plugins/pi-analysis/dist/index.mjs:159`). |
| Optional `branchOf.{analysisId,checkpointId,workspace}` | Kept verbatim on existing runs; fork sets exactly these origin fields on a new intake run (`packages/shared/src/analysis-orchestration.ts:134`, `packages/backend/src/services/analysis-orchestration.ts:87`). |
| `stage`, `status`, `capabilities` | Same seven stages, four statuses and capability strings; stage changes use the current ordered arrays, including completed `[writing, visualization]` (`packages/shared/src/analysis-orchestration.ts:14`, `packages/shared/src/analysis-orchestration.ts:156`). The full ID vocabulary comes from `packages/shared/src/capabilities.ts:1`. |
| `readiness` (`null` or `{ok,inferentialClaimsAllowed,gates,warnings}`); each gate `{code,severity,message,evidenceKey}` | Null remains null; warning/gate order and text remain. Append compute/destructive gates, synthesize missing-data/block when adapter fails without gates, derive ok from gate count and inferential permission from adapter flag plus no gates (`packages/shared/src/analysis-orchestration.ts:30`, `packages/shared/src/analysis-orchestration.ts:199`). Do not silently repair inconsistent historical snapshots. |
| Optional `review.{approved,detail,limitations,reportPath?,checks?,modelStatus?}`; check `{id,passed,detail}` | Same optionality and values. `finish-review` pauses on unverified outputs or explicitly rejected review; it does not newly require a review object where the current method allows omission (`packages/shared/src/analysis-orchestration.ts:100`, `packages/shared/src/analysis-orchestration.ts:339`). Model parsing stays a separate policy migration. |
| Optional `provenance.{adapter,workflow,method,specSha256,adapterSnapshotSha256?,toolContractSha256?,executionContext?,artifacts,lineage?,reproducibility}`; each identity `{id,version}` | Exact hashes/identities remain unchanged. Successful readiness with binding initializes this object; otherwise prior optional provenance remains as today (`packages/shared/src/analysis-orchestration.ts:65`, `packages/backend/src/services/analysis-orchestration.ts:121`). No added scientificPlan/comparator field. |
| `executionContext.{schemaVersion,revision,observedAt,source,values}` in provenance or binding | Same schema 1 and string/number/boolean/null value dictionary, no inferred fields (`packages/shared/src/analysis-orchestration.ts:85`). |
| Each artifact/input `{artifactId,versionId,path,sha256,bytes,role,accessLevel?,parentVersionIds,producedByJobId?}` | Same paths, hashes, byte counts, IDs and parent order; absent access classification remains absent (`packages/shared/src/analysis-orchestration.ts:53`). |
| `lineage.{schemaVersion,eventId,causationId?,runAttemptId?}` in provenance or binding | Wire strings remain unchanged, absent lineage stays absent, no timestamp/path-based reconstruction (`packages/shared/src/causality.ts:22`, `packages/backend/src/services/causality-projection.ts:42`). |
| `reproducibility.{status,detail,environmentFingerprint?,checkpointId?}` | Same four status values; readiness starts at not-assessed with current detail, never upgrades recorded to verified during structural migration (`packages/shared/src/analysis-orchestration.ts:75`, `packages/backend/src/services/analysis-orchestration.ts:136`). |
| `publicationRequested`; `events[].{type,at,detail?}` | Same boolean, nine event kinds, append order and default detail strings; omit detail exactly where currently omitted (`packages/shared/src/analysis-orchestration.ts:115`, `packages/shared/src/analysis-orchestration.ts:178`, `packages/shared/src/analysis-orchestration.ts:265`). Publication intent is set by readiness, not interpreted as approval. |
| Binding `{jobId,specSha256,adapter,workflow,method,adapterSnapshotSha256,toolContractSha256,executionContext?,requiredOutputs,inputs,lineage?}` | Same sibling binding map, never embedded into the run or converted to an execution grant; only successful assessed readiness with an injected binding installs it (`packages/backend/src/services/analysis-orchestration.ts:22`, `packages/backend/src/services/analysis-orchestration.ts:119`). |

Transition parity includes current detail defaults (`design-recorded`, `ready`/`gated`, `failed`/`succeeded`, `outputs-unverified`/`verified`, `delivered`), status guards and publication pause/resume behavior at the cited methods. A readiness failure always removes the previous binding; supplying no replacement also removes it. Other commands preserve bindings. Fork copies only question/assay/mode/optional adapter, creates a fresh `created` event, intake/active state, null readiness and false publication intent: **no review, provenance, source events or execution binding is inherited** (`packages/backend/src/services/analysis-orchestration.ts:72`). Existing identities remain readable; restored execution state still needs fresh host authority. Legacy contract migration and its no-approval rule stay in shared, covered by inventory S (`docs/pluginization/inventory-analysis-services.md:24`).

Required implementation proof: synthetic v1 records covering every optional field plus minimal old records must round-trip without dropped/added fields; run fixed-clock traces through the old owner and new owner and compare complete ledger JSON after every command. Include failed readiness removing a binding, successful readiness with/without binding, fork isolation, failed execution, rejected/unavailable review, publication pause/resume and reopened records. Preserve the existing event prefix and unrelated run bytes/values. These tests are requirements, not evidence already obtained by T73.

## Mapping table

Every current export in `packages/shared/src/analysis-orchestration.ts` is listed. Keys refer to `docs/pluginization/inventory-analysis-services.md:11`. “Deleted later” means only after inventory ticket 5 migrates all callers; no export is removed in the preparatory tickets. Shared transport/legacy migration can retain type-only compatibility aliases without retaining an algorithm.

| Current export | New home / final disposition | Test key |
| --- | --- | --- |
| `ANALYSIS_STAGES` | pi-analysis `src/lifecycle.ts` stage constants; old shared value deleted later | S |
| `AnalysisStage` | plugin-api `AnalysisLifecycleStage`; shared alias during migration | S |
| `AnalysisMode` | existing plugin-api `AnalysisMode`; shared alias | S/C |
| `AnalysisStatus` | plugin-api `AnalysisLifecycleStatus`; shared alias | S/O |
| `AnalysisGateSeverity` | plugin-api `AnalysisLifecycleGate["severity"]`; shared alias | S |
| `AnalysisGateCode` | plugin-api `AnalysisLifecycleGateCode`; existing scientific-only gate type unchanged | S |
| `AnalysisGate` | plugin-api `AnalysisLifecycleGate`; shared alias | S |
| `AnalysisReadinessInput` | plugin-api `AnalysisLifecycleReadinessInput`; host supplies authority facts | S/C |
| `AnalysisIdentity` | existing plugin-api `AnalysisIdentity`; shared alias | S/O |
| `AnalysisArtifactVersion` | plugin-api `AnalysisLifecycleArtifactVersion`; shared evidence type alias | S/E |
| `AnalysisProvenance` | plugin-api `AnalysisLifecycleProvenance`; host maps branded lineage at boundary | S/C |
| `AnalysisExecutionContext` | plugin-api `AnalysisLifecycleExecutionContext`; host supplies observed values | S/C |
| `AnalysisReadiness` | plugin-api `AnalysisLifecycleReadiness`; shared alias | S |
| `AnalysisReview` | plugin-api `AnalysisLifecycleReview`; shared alias | S/C |
| `AnalysisReviewCheck` | existing plugin-api `AnalysisReviewCheck`; shared alias | S/A/C |
| `AnalysisEvent` | plugin-api `AnalysisLifecycleEvent` shape, pi-analysis creates events | S |
| `AnalysisContext` | plugin-api `AnalysisLifecycleContext`; shared alias stays for contracts/research migration until their own cutover | S/O/C/E |
| `AnalysisOrchestratorOptions` | pi-analysis receives explicit `AnalysisLifecycleClock`; old shared options deleted later, host obtains time | S/O |
| `assessAnalysisReadiness` | pi-analysis `AnalysisLifecyclePort.assessReadiness`; old shared function deleted later | S |
| `AnalysisOrchestrator` | pi-analysis stateless `apply`; old shared class deleted later; host retains JsonStore shell | S/O |
| `capabilitiesForAnalysisStage` | pi-analysis `capabilitiesForStage`; old shared function deleted later | S |
| `capabilityLoadRequest` | pi-analysis same port method; host performs activation; old shared function deleted later | S/C |

No pure lifecycle implementation stays in shared after cutover. Causal projection, legacy record migration and generic host transport remain host/shared responsibilities, not plugin imports. Do not change the shared star barrel before those consumers migrate.

## Implementation split

These are three concrete follow-up tickets, serialized where artifacts overlap. `plugins:` denotes canonical **drone-plugins repository** paths from the inventory, never edits to vendored source. Source files must each stay ≤400 lines and functions ≤60; split before growth. Full code gates apply in each repository. This proposal does not authorize downloads, publishing, lock updates, data cleanup or a production host switch.

### L1 — Drone public types and result-validation helper

Depends on manager approval of this contract and decisions 1–2. Files: new `packages/plugin-api/src/analysis-lifecycle.ts` (types/port/version, <250 lines), `analysis-lifecycle-validation.ts` (result envelope/change validation), `analysis-lifecycle-record-validation.ts` (nested record validation), `packages/plugin-api/test/analysis-lifecycle.test.mjs` and `analysis-lifecycle-record.test.mjs` (split tests to ≤400); edit `packages/plugin-api/src/runtime.ts`, `packages/plugin-api/package.json` (subpath), `packages/plugin-api/README.md`, `docs/INDEX.md`, and `docs/architecture-v2.md` to register this boundary before implementation. No host caller changes or root-barrel growth. Baselines/lockfiles require a separate authorization if tooling demands changes.

First add failing boundary tests for invalid plugin results, target/unrelated-field tampering, optional-field compatibility, event suffix integrity and forged publication completion. Implement only the needed validator, not a duplicate reducer. Acceptance in Drone: `npm run typecheck -w @gyoungwe/plugin-api`; `npm test -w @gyoungwe/plugin-api`; `node scripts/check-architecture.mjs`; `npm run lint && npm run typecheck && npm test && npm run build && npm run check:arch`. Record actual packed offline consumer imports of the new subpath/runtime and unchanged old root contracts; use manager-supplied API artifacts, never relative source dependencies. Published release acceptance remains separately authorized.

### L2 — Offline pi-analysis 0.2.0 vendor freeze

Depends on the already-decided 0.2.0 parity target; precedes L3 and any host switch. Manager supplies the exact existing offline archive and provenance. Files: one explicitly named new evidence document `docs/pluginization/analysis-lifecycle-vendor-freeze.md`, its `docs/INDEX.md` line; read-only `plugins.lock.json`, `vendor/plugins/pi-analysis/{package.json,plugin.manifest.json,build-manifest.json,.drone-fetch.json,dist/**}` and `packages/backend/package.json`. Do not refetch or modify vendor/locks. Record archive SHA-256, matching package/manifest version, commit and build-manifest input/output hashes, and confirm host/native export surfaces. If any identity differs, stop the freeze and request a separate manager correction ticket.

The older inventory mismatch (`docs/pluginization/inventory-analysis-services.md:5`) is not the current checkout: `plugins.lock.json:15` and `vendor/plugins/pi-analysis/.drone-fetch.json:2` both name `df4976b19654829cabe6d081b5206c051aa6ce0d` and hash `1cc86e9e15b1dbbc10bd64dfe96b5d825633f07ab7954fdaff4968ef99225cdf`. Metadata agreement does not prove archive/source reproducibility. Acceptance commands:

```sh
node -e 'const fs=require("node:fs");const l=JSON.parse(fs.readFileSync("plugins.lock.json")).plugins.find(p=>p.name==="@gyoungwe/pi-analysis");const f=JSON.parse(fs.readFileSync("vendor/plugins/pi-analysis/.drone-fetch.json"));const p=JSON.parse(fs.readFileSync("vendor/plugins/pi-analysis/package.json"));const m=JSON.parse(fs.readFileSync("vendor/plugins/pi-analysis/plugin.manifest.json"));if(l.version!=="0.2.0"||p.version!==l.version||m.version!==l.version||f.commit!==l.commit||f.sha256!==l.tarballSha256)throw Error("Freeze metadata mismatch");console.log("pi-analysis 0.2.0 metadata matches lock");'
node -e 'const fs=require("node:fs"),crypto=require("node:crypto");const root="vendor/plugins/pi-analysis/";const m=JSON.parse(fs.readFileSync(root+"build-manifest.json"));for(const [file,hash]of Object.entries(m.outputs)){if(crypto.createHash("sha256").update(fs.readFileSync(root+file)).digest("hex")!==hash)throw Error("Build output mismatch: "+file);}console.log("Vendored build-manifest output hashes match");'
node scripts/check-architecture.mjs
```

The output verifier covers the four entries actually listed in `vendor/plugins/pi-analysis/build-manifest.json:5`; freeze all other shipped declarations separately in the evidence, without claiming that `inputsSha256` was recomputed from unavailable source. The L2 dispatch must name the supplied archive path in an exact `shasum -a 256` command before the worker starts. Until supplied, archive rebuild/installation evidence is NOT_RUN, not a guessed path or PASS.

### L3 — drone-plugins stateless lifecycle owner, host export and version bump

Depends on L1's exact packed API candidate, L2's verified freeze, and decision 2. Files: `plugins:packages/pi-analysis/src/lifecycle.ts`, `src/lifecycle-transitions.ts`, `src/lifecycle-records.ts` (separate pure transition and binding/fork/query responsibilities if needed for limits), `test/lifecycle.test.mjs`, `test/lifecycle-records.test.mjs`, existing `src/host.ts`, `package.json`, `plugin.manifest.json`, `README.md`; build outputs `dist/**` and `build-manifest.json` generated in a separate artifact change. These are proposed plugin paths, not claims of source inspection in this worktree.

Expose the new loader through the existing manifest `entrypoints.host`; retain all three native tools, old adapter loader and current permissions (`vendor/plugins/pi-analysis/plugin.manifest.json:14`). No desktopRuntime/service declaration, extra IO, credential slot or approval API is needed for pure functions. Bump package and manifest together to proposed **0.3.0** for the additive lifecycle export; retain existing scientific adapter/method versions. Tighten the plugin-api dependency floor to the manager-approved artifact containing L1; do not keep `^1.2.0` while importing missing symbols. Do not add plugin-to-plugin or Drone source imports.

Begin with failing parity cases described above, then implement one operation at a time. Acceptance in drone-plugins: `npm run typecheck -w @gyoungwe/pi-analysis`; `npm run build:check -w @gyoungwe/pi-analysis`; `npm test -w @gyoungwe/pi-analysis`; `npm run smoke -w @gyoungwe/pi-analysis`; `npm run check -w @gyoungwe/pi-analysis`; workspace `npm run check`. Pin the API artifact offline before these commands; package smoke must use cached artifacts only or remain NOT_RUN. Check actual packed `host` imports for both loaders, unchanged tools/permissions and missing/wrong lifecycle version rejection. Unit/loader checks do not establish installed-session or final P5 acceptance.

Later inventory tickets 5–7 perform host routing/controller/review cutover after decisions 3–5, with O/C/A/B/S, real absent/disabled/revoked-owner SDK and installed-package evidence. Keep `analysis-orchestration.ts`, `analysis-task-controller.ts`, `analysis-review-decision.ts` and `causality-projection.ts` read-only in L1–L3. Retention and storage-registration cleanup remain inventory ticket 19; full-file/comparator integration remains separate. No migration is activated by merely exporting this contract.

## Decisions needed

These recommendations are proposals for the manager; none changes policy in T73.

1. **API artifact/version.** Options: extend the unpublished 1.3.0 candidate, or publish the additive contract in a later 1.x minor if 1.3.0 has been frozen/released. Recommend extending 1.3.0 only while unpublished, then pinning its exact packed artifact; never overwrite a release. L1 and L3 dependency binding wait on the manager's artifact/version selection.
2. **Owner API shape and plugin version.** Options: the proposed ledger-in/result-out stateless loader plus additive 0.3.0, or per-run operations plus separate binding patches. Recommend the ledger shape to retain atomic readiness/binding behavior without a second store; keep old host loader unchanged. L1/L3 wait on approval. **Parity stays fixed at vendored 0.2.0** under either option.
3. **Approval categories and authorization transport.** Options: reuse explicit existing host-issued categories/scopes when sufficient, or define additional categories/privileged request-receipt contracts separately. Recommend keeping issuance/revalidation in the host and separately reviewing freeze/import, audience export, report writes, model spending and execution/replay before routing those effects. Plain JSON booleans/events are never grants. Inventory tickets 6–9 wait on the applicable category/transport decisions; L1–L3 make no such policy change.
4. **Retention/adoption.** Options: explicit host-mediated adoption of existing roots/identities, or a separately designed automatic adoption policy. Recommend explicit adoption with byte/identity preservation and no grant/review inheritance; disable/uninstall preserves all runs/evidence. Deletion/cleanup requires its own authorization. Inventory ticket 5's durable-owner switch and ticket 19 wait on this decision; L1–L3 only operate on injected records.
5. **Credentials and model authority.** Options: retain host credential custody and approved model/network ports, or propose additional slots/storage/authority contracts separately if a later consumer needs them. Recommend existing host custody with no secret in lifecycle inputs/results and per-call spending authorization. Inventory tickets 6–7 wait on any new credential/authority requirement; L1–L3 need none and introduce none.
6. **Published shared compatibility.** Options: keep type aliases/explicit version-bounded deprecations through 1.x, or remove exports only in an explicitly approved breaking release. Recommend retaining type aliases for migration/transport and removing old algorithms after caller cutover; do not retain a fallback reducer. Inventory tickets 5 and 18 wait on the published-surface decision. No current shared export is deleted by L1–L3.

Open evidence dependency: L2 needs an exact offline archive in its dispatch; its vendored-output verifier is specified above. This does not block writing/reviewing this proposal. No data deletion, source implementation, model call, scientific execution or runtime acceptance was performed by T73.
