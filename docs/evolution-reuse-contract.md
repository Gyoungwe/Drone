# Evidence-gated knowledge reuse and evolution

P2 of the v2 upgrade makes the reuse boundary explicit. A `KnowledgeSnapshot`
can be eligible for navigation or evidence reuse after the existing freshness,
project, workspace, assay, method, reference and input checks pass. Eligibility
does not authorize a new execution.

`KnowledgeReuseDecisionRecord` records that decision with project, run and
snapshot references. It starts as `eligible` or `blocked`. Only an explicit
human approval reference can move an eligible decision to `approved` and set
`executionEligible=true`; revocation always clears that flag.

`EvolutionCandidate` records a proposed improvement with its project, run,
knowledge snapshot and experience lineage. Candidates require at least two
observations by construction and start as non-executable `proposed` records.
Approval, supersession and revocation are immutable revision transitions with
parent references. A candidate cannot become executable from a single
observation or from a model recommendation alone.

The shared package owns the versioned contracts and transitions in
`packages/shared/src/evolution.ts`. `packages/knowledge/src/evolution.ts`
provides a host-neutral index with an injected persistence port; the backend is
responsible for binding that port to its existing atomic `JsonStore`. This
keeps knowledge pure and makes persistence, migration and sensitivity policy a
host concern.

An approved candidate can be materialized into a `CapabilityVersion` only by
`materializeApprovedEvolutionCandidate`, which produces a `recommended` version
with the approval and validation lineage attached. Version comparison and
retirement are explicit immutable operations; retirement requires a reason and
actor reference.

These records are navigation and governance data. They do not grant compute,
network, filesystem or publication authority. Any executable reuse must still
pass the existing analysis, compute authorization, evidence and review gates.
