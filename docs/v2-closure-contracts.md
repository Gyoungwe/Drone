# v2 closure contracts

The v2 upgrade exposes one exact capability row per `capabilityId@version`. A
`CapabilityMatrixEntry` records the accepted input range, applicability,
validation gate references, evidence lineage, invalidation conditions, status,
validation scope, and freshness. Resolving a bare capability id or an
ambiguous version fails closed.

Evidence promotion is represented by a `ValidationPromotionRecord`. It binds a
ResearchCase, RunAttempt, Artifact, Knowledge, and Experience lineage and
projects evidence, claim, capability, reuse, scope, and freshness states
separately. Fixture or integration output cannot become scientific verification;
that requires explicit real-data lineage and a scientific review reference.

An approved `EvolutionCandidate` is the only input that can materialize a
`CapabilityVersion`. Materialization produces a `recommended` version, leaving
enablement to the normal capability gates. Versions can be compared by contract,
workflow, method, revision, and validation lineage, and retirement creates a
new immutable revision with an explicit reason and actor reference.

Capability governance manifests also declare named evidence outputs. The
catalog writes immutable audit projections for registration, assessment, and
submission blocks. Audit records retain source commit/license, schema hashes,
side effects, evidence outputs, environment probe metadata, and findings while
omitting credential and secret material.
