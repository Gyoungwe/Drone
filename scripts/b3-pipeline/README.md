# B3 real RNA-seq smoke

`run-rnaseq-smoke.sh` is the explicit real-pipeline entry point. It runs the
official `nf-core/rnaseq` 3.18.0 commit with the `test` profile and records the
exact argv and runtime container digests in `provenance.json`. Set
`DRONE_RNASEQ_CONTAINER_DIGESTS` to the JSON map captured from the OCI runtime;
the script refuses to run without resolved `sha256:` values. Set
`DRONE_RNASEQ_OUTDIR` (absolute) to choose the output directory and optionally
`DRONE_RNASEQ_SAMPLESHEET` (absolute) for a real sample sheet.

This script does not fabricate a report or mark scientific review complete. It
requires a Nextflow installation and the selected container runtime/cache; the
Docker/Slurm fixture is separate and is never used by production submissions.
