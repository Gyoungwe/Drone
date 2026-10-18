# @gyoungwe/pi-analysis

Portable, evidence-gated analysis adapter discovery and scientific readiness checks for native Pi.

The package exposes `analysis_list_adapters` and `analysis_assess_readiness`. They only resolve a versioned adapter and evaluate an immutable plan. Remote execution, authorization, persistence, artifact collection, review and delivery remain host responsibilities.

The first adapters cover bulk RNA-seq/DESeq2 and de novo assembly. A blocked readiness result is a real gate; it is never promoted to execution success by this package.
