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

Receipt root: `/private/var/folders/t2/rdsflks91vv8cyq176h324hc0000gn/T/drone-fresh-package-lmcY6Y`.

This proves the packaged host starts with an empty optional UI profile. It does not prove a signed release, a live model call, a package upgrade/rollback, or process-destruction failure handling; those remain separate acceptance items.
