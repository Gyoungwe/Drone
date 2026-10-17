# @drone/pi-core

Portable Pi extension for Drone's task ledger and user-facing core tools:
`ask_user`, `set_status`, `todo`, `deliver_files`, and `memory_save`.

The package also registers the `@drone/tasks` runtime. Native Pi uses the
extension context's `ctx.ui`; Drone Desktop can inject its existing ask gate
through `registerPiCore(pi, { ask })`. The package has no Electron, backend, or
renderer dependency and keeps all task and memory data in the existing `.pi`
locations.
