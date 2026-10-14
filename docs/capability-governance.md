# Capability governance manifest

P3 introduces a host-neutral catalog contract for skills, tools and analysis adapters. A manifest pins the source repository, commit, path, license, input/output schema hashes, declared permissions, resource limits, side effects and the environment probe that produced its readiness state.

`CapabilityGovernanceCatalog.assess()` is the submission boundary. Unknown IDs are unregistered; missing or non-semver versions, missing provenance or schema hashes, undeclared permissions/resources, and `unknown` or `not-ready` environments all fail closed. A ready assessment only says that the capability is eligible to reach the existing execution approval and compute preflight; it does not grant host access, network access, publication authority or scientific validity.

The manifest is intentionally separate from the runtime tool registration object. Extensions can bind a registered manifest to a tool family without moving source/license or host-specific probes into the renderer. Environment probes must be persisted with their fingerprint and timestamp by the host that ran them.
