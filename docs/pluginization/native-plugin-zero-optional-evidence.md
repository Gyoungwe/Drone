# Formal packaged zero-optional-plugin smoke

2026-10-27. This receipt is for the unsigned `0.33.4` arm64 production bundle built from the native plugin architecture branch.

Command:

```sh
node scripts/check-packaged-desktop.mjs packages/desktop/dist/mac-arm64/Drone.app
```

Result: **PASS**. The script launched the actual packaged Electron binary with a fresh `HOME`, `--user-data-dir`, Pi agent directory, knowledge directory and unrelated empty project. It verified:

- the packaged workbench became visible and preload mounted;
- `profile/ui-plugins` contained only host seed files (`SPEC.md`, `drone-ui.d.ts`, `_examples` and `.builtin-seed.json`), with no optional UI plugin;
- knowledge was enabled but unbound, with no inherited Vault;
- semantic/topic IPC methods and first-party research/Obsidian commands were present;
- fresh auth/model stores were empty.
- the Pi managed npm install root was empty, so no optional package was implicitly present before the host session started.

Receipt root: `/private/var/folders/t2/rdsflks91vv8cyq176h324hc0000gn/T/drone-fresh-package-lmcY6Y`.

The smoke now also creates and closes one generic Pi session through the packaged preload with the same empty optional-plugin profile. The latest arm64 receipt is:

```text
node scripts/check-packaged-desktop.mjs packages/desktop/dist/mac-arm64/Drone.app
PASS
root: /private/var/folders/t2/rdsflks91vv8cyq176h324hc0000gn/T/drone-fresh-package-EICc4Z
genericSession: 01a1797f-cbfa-71b0-8e47-90c617a96539
checks: workbench/preload, empty optional UI root and Pi managed npm root, unbound knowledge, semantic/topic IPC, research commands, generic session create/close, empty auth/model stores
```

The repeatable receipt now includes an explicit lifecycle section:

```json
{
  "status": "NOT_RUN",
  "operations": ["install", "disable", "restore", "upgrade", "rollback", "destroy-failure"],
  "reason": "A packaged lifecycle run needs an explicitly selected package source and authorized upgrade/rollback fixture; this zero-plugin smoke does not mutate package state."
}
```

This prevents the zero-plugin PASS from being interpreted as an install/disable/upgrade/rollback result.

This strengthens the zero-plugin host receipt to include a no-model generic session lifecycle. It still does not prove an actual model response, plugin install/disable/reload, package upgrade/rollback, or failed process destruction.

This proves the packaged host starts with an empty optional UI profile. It does not prove a signed release, a live model call, a package upgrade/rollback, or process-destruction failure handling; those remain separate acceptance items.

The public-package boundary was also rechecked on 2026-10-27 with:

```sh
node scripts/check-public-plugin-host.mjs
```

That receipt passed clean-prefix installation, Pi loader discovery for `@gyoungwe/pi-evidence` and `@gyoungwe/pi-connectors`, the connector process-sandbox test, and registry lifecycle `0.1.0 → 0.1.1 → rollback:0.1.0 → uninstall`; the installed UI package smoke passed as well. The separately owned third-party source boundary remains blocked because no package/licence scope was approved. This registry lifecycle is package-level evidence and is not a substitute for a packaged-app upgrade/rollback or process-destruction-failure receipt.

## 2026-10-27 packaged lifecycle slice

The arm64 production bundle was rerun with an explicitly selected public fixture in the same isolated profile:

```sh
node scripts/check-packaged-desktop.mjs \
  packages/desktop/dist/mac-arm64/Drone.app \
  --lifecycle-package=@gyoungwe/pi-evidence
```

Result: **PASS for install/remove only**. The actual packaged Electron process installed `@gyoungwe/pi-evidence@0.1.1` into the temporary Pi managed prefix, and the preload returned a successful install receipt with `staged → verified → enabled`; the configured `npm:@gyoungwe/pi-evidence` entry and package directory were read back. The same process then removed it and returned `disabled → drained → disabled`; the managed package directory and configured entry were absent on read-back. Receipt root: `/private/var/folders/t2/rdsflks91vv8cyq176h324hc0000gn/T/drone-fresh-package-Iw53Mq`.

The script now accepts `--lifecycle-package=@scope/name` for this bounded, network-backed fixture and records the receipt in `validation.json`. This closes a real packaged install/remove (disable) slice without touching the user's profile or credentials. It does **not** close restore/reload, upgrade, rollback, or destroy-failure acceptance; those remain `NOT_RUN` and the zero-plugin smoke remains distinct from this lifecycle run.

## 2026-10-27 cross-version lifecycle fixture

After adding the explicit `rollbackPackage(name, version)` host contract and rebuilding the arm64 app, the same script's `--lifecycle-fixture` mode used a temporary loopback npm registry and the actual packaged Electron host. The receipt passed `install 1.0.0 → upgrade 1.1.0 → rollback 1.0.0 → remove → restore 1.0.0 → remove`, including the `rolled_back` event, restore enablement receipt, and final package/configuration absence. The fixture is isolated and is not a public npm publication or user-profile mutation. Restore/reload and process-destruction-failure evidence remain separate acceptance items.
