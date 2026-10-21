# Dual-repository maintenance

## Ownership today

| Repository | Owns | Does not own |
| --- | --- | --- |
| `Drone` (`/Users/gaoyangwei/Documents/ChatGPT/Drone`) | Electron host, backend, shared contracts, domain packages, `plugin-api`, `pi-core`, `pi-research`, compatibility adapters, root checks, release evidence, and the plan | The canonical source for packages already migrated to `drone-plugins` |
| `drone-plugins` (`../drone-plugins`, GitHub `Gyoungwe/drone-plugins`) | The migrated plugin workspace: currently `pi-knowledge`, `research-suite`, and `desktop-ui-pack`; package manifests, self-contained build/smoke, and plugin-specific release metadata. v2 is merged on `main`; v3 work continues on `codex/plugin-platform-v3`. | Electron/backend internals, source-relative imports into Drone, and host-only persistence or IPC |

The ownership table is a current fact, not a prediction. Do not claim that `plugin-api`, `pi-core`, or `pi-research` has moved until its source, package check, host loading path, and release evidence all point to `drone-plugins`.

## Branch and synchronization protocol

1. Start from up-to-date `main` in both repositories and verify clean worktrees.
2. Use a `codex/<short-name>` branch for each change. Keep host and plugin changes in separate commits when their responsibilities differ.
3. If the change is package-owned, implement and check it in `drone-plugins` first. Run its `npm run check`, then update the host lock/install boundary and run the corresponding root checks.
4. If the change is host-owned, update the shared contract and all required IPC/preload/main/backend or host API surfaces together. Run the plugin compatibility gate if a manifest or package contract changed.
5. Record both repository heads in the plan or evidence file whenever a release or migration gate is closed. Push only the branch the user asked to publish or merge; never force-push or rewrite a published commit.
6. After merging, fetch both remotes again and rerun the cross-repository gate from a clean checkout. A passing local worktree with an unpushed external head is not an integration result.

## Migration protocol

For a new package, first make the package self-contained and pass its external install smoke. Then:

- expose only the stable `@gyoungwe/plugin-api` contract;
- keep the host adapter at the composition root;
- add manifest, permission, resource, and version evidence;
- make Desktop load the installed package rather than a hidden source fallback;
- remove the old host copy only after the installed-package gate passes;
- update `docs/INDEX.md` and the final plan in the same change.

Do not create a second plugin repository, copy a domain implementation into both repositories, or use a relative import from `drone-plugins` into Drone.
