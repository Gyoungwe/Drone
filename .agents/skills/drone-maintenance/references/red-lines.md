# Drone maintenance red lines

These are blocking constraints. A violation is a failed change even if tests happen to pass.

## Architecture R1–R7

- **R1:** Pi SDK runtime imports stay in `packages/backend/src/session-engine/**` or an explicitly registered migration allowlist. Renderer and domain packages use contracts or types only; renderer talks through preload `window.pi`.
- **R2:** `knowledge`, `tasks`, and `research` do not depend on Electron, Pi SDK, backend, or desktop.
- **R3:** renderer and any retained web surface depend across packages only on `@drone/shared`; they do not import backend, Electron, or Pi SDK.
- **R4:** Do not add `Symbol.for("drone.*")` global bridges. Migration work may only reduce the existing baseline.
- **R5:** Do not cross a package boundary through a relative path into `.pi/` runtime files.
- **R6:** Domain dependencies remain one-way: tasks may use knowledge public types, research may use knowledge, and the reverse edges are forbidden.
- **R7:** `@drone/compute` depends only on `@drone/shared` and Node standard library. SSH, Electron, Pi SDK, and backend adapters stay in the composition root.

Use `npm run check:arch` after changes. Do not update the architecture baseline to hide a new violation.

## Product, data, and release red lines

- Use backend `JsonStore` for JSON persistence; preserve atomic writes and corrupt-file behavior.
- Sync new IPC in shared contract, preload, main IPC, backend, and event forwarding. Keep preload CommonJS and update both `i18n/zh.ts` and `i18n/en.ts` for new UI text.
- Do not commit credentials, npm tokens, security-key material, Vault or session content, `results/`, or local generated state.
- LAN is removed from the product plan; do not reintroduce a LAN adapter, UI, IPC, manifest entry, or acceptance item.
- Protocols.io is read-only. Any future write requires a separate explicit authorization and the same create/bookmark → read-back → delete → read-back proof used for other external writers.
- A package is not “published” until its public tarball has been fetched and clean-installed. Never publish from workspace symlinks or declare a bundled dependency based only on a workspace dry-run.
- Never overwrite a published version. For a defect, publish a new patch version and deprecate the defective version if needed; do not unpublish as a routine rollback.
- Unsigned desktop artifacts are the accepted release mode for this project. A missing signing certificate is not a failure; the local artifact gate remains the authority.

## Evidence wording

Use `PASS` only for observed behavior with a reproducible evidence path. Use `BLOCKED` when an external credential/service or required environment is unavailable. Use `NOT_RUN` when the gate was intentionally deferred. UI presence, a toggle state, a unit test, or a local pack without runtime behavior is not sufficient evidence by itself.
