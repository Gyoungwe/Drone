# Real RNA-seq execution and evidence plan

This document is the handoff from the hermetic compute demo to a real
`nf-core/rnaseq` run. It keeps the route, execution, evidence, plotting and
writing stages separate so that a fixture result cannot become a scientific
claim.

## Current state

The repository has a working local vertical slice:

```text
intent → route → pinned workflow plan → preflight → authorization
      → queued → succeeded → artifact manifest → provenance receipt
```

The local demo uses an in-memory executor and writes deterministic fixture
files. It proves the compute seam and lifecycle, but it does not execute
Nextflow, open SSH, read FASTQ files, run MultiQC, or produce biological
evidence. The fixture must remain explicitly selected with
`executionMode: "fixture"`.

The production route now requires an explicit registered host, a staged
absolute remote samplesheet path, and an output directory relative to the
runner output root. The typed workflow reference carries the validated
`input`, `outdir`, `genome`, `strandedness`, and profile values to the runner;
these are argv data fields and never shell text.

Resource requests are optional route inputs. When they are absent, the
registered host or scheduler profile must choose them during capability and
quota preflight; the route does not invent CPU, memory, or wall-time values.

## Gate 1: starting-point assessment

Before planning a production run, record a data inventory:

- FASTQ paths, read pairs, file sizes and SHA-256 checksums;
- sample identifiers and their relationship to the samplesheet;
- biological experimental units, groups, batches, pairing and covariates;
- organism, genome build, annotation and library strandedness;
- whether the samplesheet and FASTQs are already on the target host or need an
  approved staging/upload step;
- the intended endpoint: QC only, quantification, or a later count-matrix
  analysis.

Local paths are not remote inputs. A production submission must either refer to
files already present under the approved remote read roots or pass through a
future checksum-verified staging adapter. The current runner does not silently
upload local files.

## Gate 2: scientific design

Create an immutable analysis design before execution. For bulk RNA-seq it must
state:

- the biological question and decision;
- the experimental unit and number of biological replicates;
- groups, baseline, contrasts and covariates;
- the reference genome and annotation;
- the quantification level and output semantics;
- QC release criteria and failure conditions;
- claims that will remain unsupported if inputs or replicates are incomplete.

The design contract is bound to the authorization hash. Changing the data,
sample metadata, reference or contrast invalidates the old execution contract.

## Gate 3: target and workflow readiness

The host-side adapter must perform these checks before `submit`:

1. Resolve a registered target and verify its configuration hash.
2. Probe the runner and record Nextflow version, executor, container runtime,
   CPU, memory and free disk.
3. Verify the pinned `nf-core/rnaseq` revision and every required OCI digest.
4. Verify that the remote samplesheet, FASTQs, reference and annotation are
   readable from approved roots.
5. Verify that the output directory is inside the runner collection root.
6. Compile and validate the immutable plan, register the workflow and check the
   workflow authorization immediately before the remote side effect.
7. Refuse submission when any capability, path, digest or authorization fact is
   missing or unknown.

The current runner's durable root is selected by the registered host
configuration. `remoteWorkDir` is retained as a typed task-contract field for
the upcoming staging adapter; it does not currently relocate the runner's
durable root by itself.

The existing `scripts/b3-pipeline/run-rnaseq-smoke.sh` is the explicit real
Nextflow entry point. It requires Nextflow, an OCI runtime/cache and a complete
digest map. It must remain separate from the fixture launcher.

## Gate 4: execution and collection

The production adapter should submit through `ComputeService`, reconcile the
durable job, collect bounded artifacts and preserve the run receipt. The
workflow output contract should collect the actual nested files produced by
the selected nf-core version, including where present:

- MultiQC HTML and its machine-readable data;
- per-sample FastQC reports;
- quantification or gene-count tables with their declared semantics;
- Nextflow trace, report, timeline and DAG;
- workflow and container provenance.

It must not assume that a fixture's flat `multiqc_report.html` and
`counts.tsv` are the real pipeline output layout. A missing or inaccessible
artifact is reported as a collection failure or limitation, not replaced with
hand-written content.

## Gate 5: QC and results interpretation

After a terminal run, inspect actual artifacts before writing any conclusion.
At minimum verify sample identity, read layout, mapping or assignment metrics,
library orientation, reference compatibility, outliers, quantification
semantics and the workflow's own QC summaries. Parse machine-readable MultiQC
data where available; an HTML report alone is a visual artifact, not a complete
QC table.

Keep these states separate:

- execution succeeded;
- QC passed or failed;
- the analysis is scientifically reviewable;
- a biological conclusion is supported.

The first state never implies the other three.

## Gate 6: plots and writing

Only after real result tables and QC have been inspected should the project
generate publication artifacts.

- Exact numeric figures must be made by deterministic plotting code from the
  verified result tables and stored with their input hashes.
- `imagegen` may be used for a clearly labelled conceptual workflow schematic
  or cover visual. It must not invent expression values, QC metrics, p-values or
  biological group differences.
- The writing workflow should use the run receipt, provenance, QC summary,
  analysis plan and actual tables to write Methods, Results and figure legends.
- Every figure legend should identify the data source, denominator, grouping,
  normalization/statistical method and any limitation visible in the evidence.
- If the run is blocked or partial, write an evidence-limited report and do not
  generate a result figure that implies completion.

## Acceptance criteria for the next implementation slice

The real execution slice is complete only when all of the following are true:

- a real target is registered and its runtime probe is recorded;
- a real samplesheet and FASTQ manifest pass checksum/path validation;
- the production route carries all invocation parameters to the runner;
- workflow registration and authorization pass immediately before submit;
- the real Nextflow run reaches a terminal state;
- actual MultiQC/trace/count outputs are collected and checksummed;
- a QC summary is written without setting scientific verification automatically;
- deterministic plots are generated from those actual tables;
- Methods, Results and legends cite the same provenance and artifact hashes.

Until these criteria are satisfied, the repository may report an operational
demo but must not report a real transcriptome finding.
