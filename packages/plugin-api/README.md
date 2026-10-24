# @gyoungwe/plugin-api

Stable, host-independent TypeScript contracts for Drone capability plugins.
The package contains no Electron, backend, Pi SDK, filesystem, or network
implementation. A host implements `DroneHostPort` and performs the capability
negotiation before loading a plugin. Analysis-capable plugins additionally
expose the versioned `AnalysisHostPort` registry through their `host` entry;
the host consumes that loader without importing adapter implementations.

The package is intentionally published at API major `1` while its npm scope is
still a project decision. Before publication, the host and `drone-plugins`
workspace use an `npm pack` tarball or a pinned git commit; they must never use
a relative path into the Drone source repository.

`compatible` and `incompatible` are the only negotiation outcomes in API v1.
There is no implicit partial or degraded load: a plugin that cannot satisfy its
declared requirements is refused with an actionable reason.

Hosts that execute an L1 plugin should wrap the port they pass to it with
`createPermissionedHostPort`. The wrapper treats the manifest's filesystem,
network, subprocess and `externalWrites` declarations as a deny gate before
calling the host authorization UI, and emits redacted `PluginPermissionAuditEvent`
records for denied and decided operations. This is the executable permission
contract for host-mediated side effects; it does not claim to sandbox direct
Node.js access from an untrusted plugin. Hosts may additionally load optional
extensions through Drone's process sandbox proxy; that runtime boundary is a
host capability and must not be implied by a manifest declaration.

The public package is currently `1.1.0`. API v1 is additive-only: publish a new
minor or patch only when the contract changes, verify the packed tarball in a
clean consumer before release, and never overwrite an existing version.
