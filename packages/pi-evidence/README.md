# @gyoungwe/pi-evidence

Portable evidence contracts for native Pi and Drone Desktop. The package is a
read-only boundary: it validates content-addressed artifact manifests,
provenance and digest declarations, immutable checkpoint and branch metadata,
evidence capsules, and replay/import proofs.

The package does not read files, write a ledger, create workspaces, execute a
workflow, or inherit execution authorization. A host supplies bytes and
persists validated records in its composition root. Capsule blobs are passed as
base64 strings or `Uint8Array` values, so a host can choose its own storage
policy. Absolute paths, traversal, credential names, `.pi`/`.drone` state and
other private state labels are rejected at the contract boundary.

The native Pi extension registers three read-only tools:

- `evidence_validate_manifest`
- `evidence_validate_capsule`
- `evidence_verify_replay`

`npm run check` runs the typecheck, deterministic self-contained build,
registration tests and a clean tarball install smoke. It does not publish the
package or call a model.
