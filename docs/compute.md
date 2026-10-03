# Remote compute

Drone's compute path is split between the portable `@drone/compute` domain package and the
Node backend adapter. The domain package validates workflow specifications, resource bounds,
dataset/design contracts, provenance and QC without importing Electron or the Pi SDK. The
backend owns host profiles, durable jobs, runner deployment, SSH transport and the desktop
projection.

## Hosts and credentials

Hosts are stored as metadata only. Private keys, passwords and OTP values are never persisted;
an SSH identity path is checked against the local credential boundary and keyboard-interactive
answers live only for the connection. Built-in SSH verifies a configured `known_hosts` entry or
the explicit SHA-256 host-key fingerprint, supports SFTP, ProxyJump and terminal channels, and
falls back to system OpenSSH for features that `ssh2` cannot represent. Remote effects require a
task/session authorization callback; missing authorization fails closed.

## Runner and jobs

The bundled runner uses one JSON request per stdin line and persists job state under the host's
`DRONE_REMOTE_ROOT`. Direct jobs run through the fixed `runner.py` protocol; Slurm jobs use the
same protocol and call the scheduler's `sbatch`, `squeue`/`sacct` and `scancel` commands. Job
submission is idempotent, status is reconciled after reconnect or restart, and an unknown
transport outcome is recorded as `unknown` so the host never silently retries a side effect.
Logs are cursor based and bounded. Collection accepts only declared output paths and verifies
the returned manifest before publishing artifacts.

The runner can be exercised locally with:

```sh
npm run test:compute:runner
npm run test:compute:docker   # optional; requires a running Docker daemon
```

The Docker fixture includes an OpenSSH endpoint and a single-node Slurm controller. It is a test
fixture only and is not a production cluster configuration.

## RNA-seq vertical slice

`@drone/compute` pins `nf-core/rnaseq` 3.18.0, its revision and the resolved container digest.
The opt-in smoke script refuses to submit unless Nextflow, the pinned revision and an approved
OCI digest are available on the target host:

```sh
npm run test:compute:rnaseq
```

Execution provenance records the workflow revision, module commits, container digests, executor,
remote roots, scheduler identity and QC result. MultiQC thresholds are deterministic; passing QC
does not by itself mark a scientific conclusion as reviewed.

## Data and design contracts

Datasets are content-addressed versions with file checksums, sample-sheet schemas and public-data
fetch records. The design validator checks required metadata, duplicate identifiers, missing
values, confounding and sample balance. Analysis plans include power/MDE planning and deviations
are retained for review. A deterministic RO-Crate export contains the dataset, plan, fetch records,
workflow and provenance references. These records are attached to the task authorization contract,
so changing a dataset or plan invalidates the old contract hash.

## External acceptance

The repository contains hermetic direct-runner tests and an opt-in Docker/Slurm fixture. A real
Windows client, OTP keyboard-interactive login, multi-hop jump host, external Slurm cluster and
real nf-core test-profile run require the corresponding environment and credentials; they are
recorded as pending external smoke checks rather than simulated in CI.
