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

The unpublished 1.3.0 candidate now gives each application one runtime owner per installed package. The factory receives `{ applicationId, signal, resources, capabilities, events }`; it must not capture a window, workspace or session. Each operation receives `{ scope, signal, capabilities }`, where `scope` is a discriminated union: `{ kind: "application" }`, `{ kind: "workspace", workspaceId, workspaceDirectory }`, or `{ kind: "session", workspaceId, workspaceDirectory, sessionId }`. `workspaceId` is an opaque normalized identity and must never be used as a path. `workspaceDirectory` preserves the actual live session entry’s directory, including case; access still requires an approved root handle. The current desktop path emits application or session scopes. Host code resolves session identity, canonical workspace, project trust, read-only state and lifetime from its live session registry; renderer input cannot provide those facts. Session selection returns an opaque main-issued lease; the internal IPC invocation must echo that lease, so queued input from an earlier selection cannot execute under a later session, including A → B → A.

Switching the selected session cancels that window's old calls and pending approvals while retaining the shared application owner. Closing a session revokes its registered identity, including when a later session reuses the same ID. If the window providing initial activation approval closes before startup, the pending activation is canceled and surviving windows must obtain fresh approval. Closing one window after activation leaves sibling callers running; releasing the final caller drains and disposes the owner. Disabled/replaced packages revoke every caller before replacement, and failed disposal blocks reactivation. Reads require a live trusted caller; writes also require operation approval and reject read-only sessions. With no selected real session (including a draft), the caller explicitly has application scope and receives no fabricated workspace authority.

The worker has direct read access only to self-contained package bytes. `capabilities.call(name, input)` can reach only handlers registered for that activation; each handler declares input/result schemas and a read/write effect. A factory-held port borrows the current invocation authority and cannot be retained as background access. Construction can use only explicitly approved bootstrap read handlers. `resources` contains opaque handles granted by the host, never arbitrary paths selected by the plugin. A read operation cannot escalate to a write capability. Capability failures and unfinished accepted operations remain part of the outer receipt.

`events.changed()` emits no domain payload; the host assigns a monotonic revision. A UI client subscribes with `subscribe(listener)` and rereads its own operations. Main and renderer reject revoked bindings and stale selection leases; event notifications carry no Vault content or session messages.

`@gyoungwe/plugin-api/native` imports official Pi types only. The optional `createNativeSession()` projection returns an official `ExtensionFactory`, a session disposer, and optional `toolEffects`. The current isolated execution adapter supports `registerTool` and `session_start`/`session_shutdown`; unknown tool effects require write approval. Native and desktop operations use the same application owner. Bootstrap becomes callable only after the host binds an actual live SDK session entry. Discovery for a draft grants no session authority. Other official APIs and live publication projections are explicitly unsupported in this slice; they must not be replaced with mock success or JSON copies of proof objects.

`@gyoungwe/plugin-api/resource` describes optional isolated resource factories. The host selects a private derived-data directory and passes it to a resource process; this is not a Vault write grant. Resource requests reuse the caller's capability port and scope. Children must really exit before the activation releases their ownership reservations. The existing 1.2 knowledge UI contract remains available during its documented migration; these candidate ports do not mean all 56 domain methods have migrated.


## Optional Node reservation implementation (1.3.0 candidate)

`@gyoungwe/plugin-api/node/reservations` is an explicit Node-only subpath. It exports the existing `PluginResourceReservations` implementation shared by host and native adapters: exclusive local-user lease files, SHA-256 canonical resource keys, random owner token/PID, identity-checked release, and no automatic stale takeover. The package root, UI, runtime and native contract subpaths do not import it or Node. Importing the helper grants no filesystem permission; callers must authorize and canonicalize resource identities before reserving, drain domain and child work before release, and preserve a failed cleanup for explicit recovery.
