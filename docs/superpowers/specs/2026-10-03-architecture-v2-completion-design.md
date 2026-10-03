# Architecture v2 Completion Design

Date: 2026-10-03

## Scope and completion contract

This work completes the latest Drone upgrade plan through B7. B8 team collaboration is explicitly out of scope. Completion means that the implementation is connected through the real desktop/backend composition root, has deterministic unit and integration coverage, and passes the local release gates. Requirements that need infrastructure absent from the development machine (a Windows host behind a bastion with OTP, or an external Slurm cluster) are represented by production adapters plus reproducible Docker fixtures; a real-environment smoke is run when that environment is available and is reported separately.

The following are not accepted as completion evidence on their own: a type-only domain package, an injected fake callback, a renderer component that calls an unavailable backend method, or a test that only checks a generated command without executing the lifecycle around it.

## Architecture

### Composition and boundaries

`@drone/compute` remains a host-independent domain package. It owns the host profile, runner protocol, workflow specification, state machine, idempotency, reconciliation, budgets, provenance, artifact manifest, and the B3 RNA-seq contract. It does not import Electron, Pi, backend, or other domain packages.

The backend composition root owns concrete transports and secrets. A `ComputeTransportFactory` creates an in-process SSH transport (ssh2), an OpenSSH process fallback, and a local fixture transport. The transport exposes argv-only execution, upload/download, shell channels, host-key verification, keyboard-interactive prompts, and multi-hop connection setup. A `RunnerDeployment` installs or verifies the pinned runner and returns its protocol/capability record. A `ComputeExecutor` is built from those ports and is passed to `ComputeService` at desktop startup; the service is never silently created without an executor in a production desktop build.

The scheduler adapter implements direct and Slurm submission behind the same executor interface. It records the immutable task contract hash, compute scope, budget, runner version, workflow revision, container digests, and host identity before submission. Job events are persisted before being projected to IPC. On restart, reconciliation uses the remote job identity and idempotency key, then transitions unknown jobs to a terminal or explicitly blocked state instead of duplicating work.

The desktop IPC layer exposes only shared contracts. The renderer receives host, job, log, terminal, onboarding, inquiry, discovery, and proposal projections through preload. LAN remains GET-only and receives redacted inquiry and provenance projections. Remote side effects require the existing task authorization boundary; read-only status and log projections do not.

### Research state and knowledge flow

`@drone/inquiry` is the single ledger contract for artifacts, findings, questions/priors, and attempts. The backend creates one project-scoped SQLite ledger for every configured project, subscribes to compute and task terminal events, and records artifact manifests and lineage automatically. Workspace writes are limited to `runs/`; promotion to `results/` is performed only by an accepted validator or an explicit user decision. The desktop research board and LAN projection consume the same read-only snapshot.

The publication gate obtains a host snapshot from the ledger and run provenance. It validates numeric claims against artifacts, methods against the executed workflow and parameters, checksum freshness, finding labels, and claim drift. Missing required snapshots fail closed for a research report; legacy operational turns remain compatible only when they are explicitly outside the research publication path.

The B4 proposal builder consumes cited findings and experience records. A completed compute attempt writes a verified or observed experience record, including contract hash, workflow revision, host/scheduler facts, failure signatures, repairs, and artifact references. A later task can search verified experiences before planning. Proposal revisions are content-hashed and invalidate prior approval when the scope, compute budget, cited findings, or workflow changes.

### Workflow repair, exploration, and data management

Workflow planning always registers priors before execution, compiles and type-checks the module graph, and records an attempt. The repair loop may diagnose an actual execution observation, apply a bounded declaration-only change, resubmit through the same authorized executor, and verify the result. It stops after three attempts or on a repeated failure signature and records each decision. Compile-only success is not a successful execution.

B5d adds a sandboxed Python/R kernel session with a container-only local mode, idle timeout, output classification, exported script/notebook, and an exploration budget. B5e adds an independent critic role and multi-path execution records with robustness grades. B5f adds deterministic benchmark runners and baseline storage for BixBench regression, rediscovery, inconsistency interception, confounder detection, clue hit rate, verification time, and repeated failures.

B7 adds dataset registration and content-addressed versions, sample-sheet/schema checks, controlled public-data fetch records, RO-Crate export, design-matrix/confounding checks, power/sample-size planning, and an analysis-plan record attached to the task contract. These validators run before submission and turn unresolved issues into proposal questions rather than silently changing scientific intent.

## Delivery sequence

1. Finish A3/A5 boundaries and update the architecture index. Keep compatibility shims isolated and remove every production cross-package `.pi` path that is not a declared generated entry.
2. Implement transports, runner deployment, direct/Slurm executors, durable reconciliation, budgets, and Docker sshd/Slurm fixtures.
3. Wire desktop startup, IPC, terminal, onboarding, authorization cards, task continuation, logs, artifacts, and health diagnostics.
4. Run the RNA-seq vertical slice through both fixture executors, including MultiQC parsing and provenance.
5. Wire B4 proposal/experience flow and B5a–B5c automatic ledgers, publication gate, repair execution, and read-only projections.
6. Add B5d–B5f exploration, critic, robustness, and evaluation packages.
7. Add B7 dataset/FAIR/design contracts and connect them to preflight validation.
8. Run unit, SDK, Docker integration, UI/CDP, LAN, packaged desktop, and clean-install smoke checks. Run external Windows/OTP and real Slurm smoke only when credentials and hosts are available.

## Failure and security rules

Remote connections never accept credentials in host endpoints. Private keys and tokens remain in the platform credential store or agent configuration and are never persisted in job specs, ledgers, traces, or provenance reports. Host keys are pinned and changes fail closed. Runner commands are argv-only and bounded by timeout, workspace, byte, and budget limits. Artifact collection rejects absolute paths, traversal, symlinks, missing checksums, and unexpected files.

Transport loss leaves a durable `unknown` job and triggers reconciliation; it does not resubmit automatically until the remote identity is resolved. A failed validator creates an actionable proposal finding. A failed research snapshot, stale checksum, missing citation, repeated repair signature, budget overrun, or unauthorized remote effect blocks completion.

## Verification

The implementation is considered complete only when the following are green: package unit tests, backend SDK tests, Docker sshd transport tests, single-node Slurm tests, disconnect/reconnect and restart reconciliation tests, duplicate-submission and cancellation tests, terminal/OTP contract tests, one-authorization SDK flow, RNA-seq fixture runs, inquiry lineage and cleanup tests, metacognitive injected-defect tests, repair-loop execution tests, kernel sandbox tests, critic/multipath tests, B7 dataset/design tests, desktop renderer/CDP smoke, GET-only LAN assertions, packaged-resource checks, `lint`, `typecheck`, `check:pi`, `check:arch`, `build`, and the release packaging check.

The final release notes must distinguish: (a) automated local fixture evidence, (b) any real Windows/OTP/Slurm smoke evidence, and (c) external-environment checks that were not runnable. B8 is not listed as a missing release gate for this scope.
