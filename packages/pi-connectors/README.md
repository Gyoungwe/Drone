# `@gyoungwe/pi-connectors`

`@gyoungwe/pi-connectors` is the portable connector boundary for native Pi and Drone Desktop. It ships declarations, a registry, operation planning, and provenance receipt contracts for:

- Zotero citation metadata
- WebDAV storage reads
- read-only generic MCP discovery/invocation
- institutional access and approved browser handoffs
- declared public search providers
- approved browser source reads

The package is intentionally transport-free. Its tools only list or inspect connector declarations. A host composition root owns network requests, credential lookup, browser sessions, writes, deletes, readback, and retry policy through `ConnectorExecutionPort`. Credential fields are opaque references; secrets are never part of a descriptor or receipt.

Every descriptor declares:

- capabilities and supported hosts (`native-pi`, `drone-desktop`)
- network mode and an explicit host allowlist label
- credential requirement and accepted host-owned sources
- read/write/delete access (all built-ins default to read-only)
- authorization-required operations
- external side effects, including browser navigation

`ConnectorRegistry` validates these declarations and provides deterministic listing and permission-audit projections. `planConnectorOperation` fails closed for undeclared writes/deletes and for operations missing a host authorization reference. `createConnectorReceipt` and `createConnectorReceiptChain` let a host record source hashes, opaque authorization handles, and write/readback/delete phases without this package performing those actions.

## Build and verify

```sh
npm run typecheck -w @gyoungwe/pi-connectors
npm run check -w @gyoungwe/pi-connectors
```

The package build emits a self-contained `dist/index.mjs`; it has no runtime dependency on Electron, Drone backend, or a Pi SDK. `scripts/smoke-pi-connectors.mjs` packs the package, installs the tarball into a fresh temporary prefix, discovers the extension with the Pi resource loader, checks both read-only tools, and uninstalls it. The smoke does not use credentials, network transports, browser state, or external writes.
