# @gyoungwe/pi-core

Portable Pi extension for Drone's task ledger and user-facing core tools:
`ask_user`, `set_status`, `todo`, `deliver_files`, and `memory_save`.

It also exposes `/drone-doctor` (a stable JSON host/package diagnostic) and
`/drone-example` (a read-only research example preview, with `--run` for an
explicit user question). The example reports `needs-data`, `blocked`, `ready`,
or `started`; it never claims a scientific result without source receipts.

The package also registers the `@drone/tasks` runtime. Native Pi uses the
extension context's `ctx.ui`; Drone Desktop can inject its existing ask gate
through `registerPiCore(pi, { ask })`. The package has no Electron, backend, or
renderer dependency and keeps all task and memory data in the existing `.pi`
locations.
