# Analysis orchestration design

## Goal

Keep `capability_load` as a narrow runtime visibility router and add a separate,
host-owned analysis orchestration contract for NGS work. The orchestrator makes
stage changes and scientific gates observable without granting the model a new
permission to execute commands or publish results.

## Boundaries

`capability_load` selects tool schemas and skill metadata. It does not install
software, execute workflows, validate statistical claims, or serve as a
security boundary. The analysis orchestrator owns the lifecycle state and maps
the current stage to the smallest capability set. Compute authorization,
design-matrix validation, artifact checksums, persistence and side effects stay
in the host and Compute service.

The first validated policy is bulk RNA-seq. Inferential analysis is paused when
any comparison group has fewer than two biological replicates. Exploratory
output may continue with an explicit warning and inferential claims disabled.
Unresolved contrasts pause, unresolved references block, and destructive or
publication actions require review.

## State flow

```text
intake → design → readiness → execution → review → delivery → completed
                  ↑              │          │
                  └── reassess   └─ block    └─ pause for review
```

Each snapshot includes the current stage, status, required capabilities,
readiness gates and a public event history. Snapshots are immutable so the host
can persist them through its normal `JsonStore` or inquiry ledger without
putting filesystem access in the domain package.

## Capability mapping

| Stage | Capability packs |
| --- | --- |
| Intake | `analysis`, `files` |
| Design | `analysis`, `planning`, `files` |
| Readiness | `analysis`, `files`, `coding` |
| Execution | `analysis`, `files`, `coding` |
| Review | `analysis`, `visualization`, `literature` |
| Delivery | `analysis`, `visualization`, `writing`, `literature` |

The model must still read the selected skill's `SKILL.md`; a capability list is
not a substitute for the skill contract.

## Implementation and verification

The pure state machine is implemented in
`packages/shared/src/analysis-orchestration.ts` and exported from the shared
package. Its tests cover stage capability mapping, missing biological
replicates, exploratory labeling, execution gating and publication pause.
The host integration persists these snapshots through the registered
`agent-analysis-runs` store. `AnalysisTaskController` activates the current
stage through the same `CapabilityRuntime.activate` path used by
`capability_load`, binds the exact preflight-checked Compute specification, and
only advances execution after observed terminal job status. In review, the
controller collects the verified manifest, sends bounded artifact evidence and
readiness limitations to the session model, writes the model-authored report,
and advances to delivery only after a non-empty approved review; unavailable or
failed model review remains paused.
