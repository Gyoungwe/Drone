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
