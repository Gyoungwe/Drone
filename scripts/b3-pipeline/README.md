# B3 real RNA-seq smoke

`run-rnaseq-smoke.sh` is the explicit real-pipeline entry point. It runs the
official `nf-core/rnaseq` 3.18.0 commit with the `test` profile and records the
exact argv, Nextflow version, runtime container digests, input hashes and
output artifact hashes in `provenance.json`. Set
`DRONE_RNASEQ_CONTAINER_DIGESTS` to the JSON map captured from the OCI runtime;
the script refuses to run without resolved `sha256:` values. Set
`DRONE_RNASEQ_OUTDIR` (absolute) to choose a new, empty output directory and
optionally `DRONE_RNASEQ_SAMPLESHEET` (absolute) for a real sample sheet.
`DRONE_RNASEQ_ATTEMPT_ID` can pin the durable attempt identifier; otherwise the
script generates one. A non-empty output directory is rejected so a retry
cannot overwrite an earlier successful or failed attempt.

The receipt is an operational record, not a scientific conclusion. A successful
process must produce a MultiQC HTML report, Nextflow report/trace/timeline/DAG,
and a recognized count table before the script exits successfully. A process
failure or missing artifact set still writes a failed receipt with its observed
files and reason. `qcStatus` and `reviewStatus` remain `pending`, and
`scientificallyVerified` remains `false` until a separate review uses the
machine-readable outputs.

This script does not fabricate a report or mark scientific review complete. It
requires a Nextflow installation and the selected container runtime/cache; the
Docker/Slurm fixture is separate and is never used by production submissions.
