# Decision ledger design

## Goal

Collect agent-made decisions in a project-scoped ledger that users can inspect and revoke. Revocation changes only Drone's ledger and marks the affected artifact lineage pending review; it never attempts to undo a completed external write or job.

## Data and migration

`@drone/inquiry` advances its document and SQLite metadata schema from v1 to v2 and adds `DecisionRecord` plus a `decisions` collection. File documents accept v1 and v2, add an empty decision collection when reading v1, and retain legacy record versions. SQLite recreates the metadata table under the v2 check constraint while retaining existing payload tables. `ArtifactStatus` adds `pending-review`.

## Runtime and transport

The backend inquiry service accepts successful decision receipts from task authorization/rebind, workflow repair, subagent dispatch, compute submission and Zotero write extension events. The new `DecisionsContract` exposes `list(projectId)` and `revoke(id, reason)` through shared types, main IPC and the CJS preload. The renderer task panel fetches the project ledger, displays newest decisions first, and confirms before revocation.

## Publication behavior

The metacognitive publication policy rejects any supplied artifact whose status is `pending-review` with the fail-closed code `artifact-pending-review`. Existing human review flows remain the path for clearing that state; no existing authorization, receipt or publication gate is weakened.

## Verification

Tests cover v1 migration in both adapters, all six decision kinds, two-level lineage propagation, publication failure behavior and the absence of external adapter calls during revocation. Full lint, typecheck, unit, architecture and build checks remain required before the PR is opened.
