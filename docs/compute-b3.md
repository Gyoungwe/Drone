# Compute B3 RNA-seq vertical slice

`@drone/compute` is the host-independent domain boundary for the first remote
RNA-seq workflow. It accepts a declarative `WorkflowSpec`, validates pinned
module metadata and typed edges, emits a small Nextflow DSL2 artifact, and
invokes `nextflow -preview` through an injected command runner. No shell text
from a model is executed.

The direct and Slurm executor adapters produce argv and environment data only.
The B1/B2 transport and runner layers can submit those requests through their
fixed JSON runner protocol. `FakeCommandRunner` and `FakeRemoteRunner` keep
package tests hermetic; no Nextflow installation, SSH credential, Docker daemon,
or Slurm cluster is required for the unit tests.

The RNA-seq factory pins the pipeline name, revision/profile fields and module
container digest in the WorkflowSpec. The test profile is a validation fixture;
a real run still needs a remote runner with the requested nf-core revision and
container cache staged on the target host. Direct execution uses Nextflow's
local executor; Slurm execution selects Nextflow's Slurm executor and carries a
validated queue/partition.

MultiQC parsing and threshold evaluation are deterministic execution checks.
Even a passing gate remains unreviewed and does not become scientific evidence.
Remote provenance records the WorkflowSpec hash, module commits, container
digests, executor, remote roots, scheduler identity and QC summary. An adapter
can pass its declaration to `recordRunProvenance`; the existing provenance
contract continues to report `qcVerified: false` and
`scientificallyVerified: false` until a human review occurs.

Before a real cluster smoke test, provide an approved task contract containing
the host alias, bounded remote read/write roots, workflow allow-list, resource
budget and one authorization hash. Confirm a reachable Nextflow installation,
the pinned nf-core revision, container runtime/cache, samplesheet and reference
data. For Slurm, the login host must allow `sbatch`, `squeue`/`sacct`, and
`scancel`; for direct, the host must provide the local executor's CPU, memory and
disk limits. A jump host or OTP remains a host-owned login action and is never
handled by the workflow compiler.
