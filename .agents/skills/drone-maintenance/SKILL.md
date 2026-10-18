---
name: drone-maintenance
description: Maintain the Drone host and drone-plugins repositories, enforce architecture and release red lines, and publish or verify @gyoungwe npm packages when explicitly authorized.
---

# Drone maintenance

Use this skill for changes that cross the Drone host, the `drone-plugins` repository, the pluginization plan, or the public `@gyoungwe` packages. It is also the runbook for reviewing a release or deciding whether a v1.1 gate is actually closed.

## Start every task

1. Read [`AGENTS.md`](../../../AGENTS.md), [`docs/INDEX.md`](../../../docs/INDEX.md), and [`docs/final-pluginization-plan.md`](../../../docs/final-pluginization-plan.md).
2. Inspect both worktrees before editing:

   ```sh
   git status --short --branch
   git -C ../drone-plugins status --short --branch
   git fetch --prune origin
   git -C ../drone-plugins fetch --prune origin
   ```

3. Read only the reference needed for the task:
   - [dual-repo.md](references/dual-repo.md) for ownership, branches, and synchronization;
   - [red-lines.md](references/red-lines.md) before changing architecture or external effects;
   - [npm-release.md](references/npm-release.md) before packing, publishing, or verifying a package;
   - [v1.1-roadmap.md](references/v1.1-roadmap.md) when selecting the next unfinished plan item.
4. Work on a `codex/*` branch. Keep unrelated changes out of the branch and never edit generated `.pi/**` files by hand.

## Required completion evidence

- A host change has the relevant root checks: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run check:arch`; add the targeted package/gate checks listed in the plan.
- A plugin change has `npm run check` in `../drone-plugins`, a clean package smoke/install check, and the matching host gate when the host loads the package.
- A published package is not considered released until the public registry tarball, integrity/shasum, clean install, and bundled resource shape have been checked. A local `npm pack` or a successful HTTP publish alone is insufficient.
- Update the plan, evidence file, and `docs/INDEX.md` when ownership, package versions, checks, or file locations change. Record a blocked or not-run gate as such; do not convert an environment limitation into a pass.

## Stop conditions

Stop before any external write, remote execution, deletion, npm publish, or version-tag mutation unless the current user has explicitly authorized that action. Protocols.io remains read-only under the current plan. Never place credentials, tokens, Vault/session contents, `results/`, or private machine state in either repository.

The detailed procedures are intentionally kept in the linked references so routine host edits do not load the npm or two-repository release runbook unnecessarily.
