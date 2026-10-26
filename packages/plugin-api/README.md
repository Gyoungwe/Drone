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

The local candidate package is `1.3.0`; the current public release remains `1.2.0`. API v1 is additive-only: publish a new
minor or patch only when the contract changes, verify the packed tarball in a
clean consumer before release, and never overwrite an existing version.

## Desktop knowledge UI contract

`@gyoungwe/plugin-api/ui` exports the type-only `KnowledgeUiPort`,
`KnowledgeUiBindings`, `DroneUiRuntime`, and `KnowledgeSurfaceProps` contracts.
A UI plugin accesses services through `window.DroneUI.knowledge`; the host retains
authorization, Vault boundaries, and persistence. The port is an explicit list of
56 required methods, not the complete preload API. React bindings require React 19
types only when importing this UI subpath; the package has no runtime dependency.

`src/ui-wire.ts` is generated from the shared wire contracts and existing public
knowledge types. The allowlist in `scripts/knowledge-ui-contract.json` fixes the
public scope. In the source checkout, run
`node scripts/generate-knowledge-ui-contract.mjs` after changing a wire type.
Package build and typecheck reject a stale generated contract.

## Optional desktop runtime (1.3.0 candidate)

`@gyoungwe/plugin-api/runtime` provides type-only factory, scope, operation and lifecycle contracts. A combined native Pi package may declare `entrypoints.desktopRuntime` in its optional Drone manifest. Drone activates that entry only after explicit approval, in a separate restricted process. The default export returns operations (JSON schemas, read/write effect, execute) and an awaited dispose hook. Inputs/results must be JSON serializable; use null for a void result.

UI modules use `usePluginRuntime()` from the host-provided `@drone/ui` shim. The client is bound by the main process to an installed package, window and activation. It accepts an operation and input, never a package ID or workspace assertion. Revoke invalidates old closures; replacement waits for real disposal. Shared-renderer UI modules remain trusted code, so binding tokens are not an isolation boundary against another UI module.

The first integration has window-scoped runtime instances and read-only access to self-contained package bytes. It does not yet provide Vault/storage/network capabilities, domain service migration or full official Pi ExtensionAPI support. Those are separate plan items; the existing 1.2 knowledge UI contract remains available during its documented migration.
