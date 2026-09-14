# Skill catalog and initialization ownership

The first-party Obsidian setup has one visible action: `/obsidian-setup`, owned by `research-vault`. `/setup` and `/research-setup` remain registered compatibility aliases but are folded into the primary action in the desktop catalog and extension resource list. Alias search returns the primary action; selecting it sends the canonical SDK invocation. `/obsidian-review` remains a separate review action, not initialization.

This is not a removal or global rename of user skills. All loaded workflows keep their SDK names, source paths, manual-only flags, permissions and bodies. The shared catalog is a presentation taxonomy, not a new router skill and not a security policy. Similar names such as `grill-me`/`grilling` or `handoff`/`claude-handoff` are not assumed equivalent.

## Browsing

The Skills settings page groups skills by knowledge, research/literature, writing/review, figures/explanations, engineering/testing, collaboration/planning, specialized setup and shared references. Unknown skills appear under Other. Search covers names, descriptions, origins and known bilingual purpose labels. Setup/reference groups are collapsed by default, not uninstalled. Descriptions and paths are expanded on demand.

The slash menu hides specialized setup and internal references during blank browsing and includes a reveal control. Searching automatically includes these entries. The three currently installed engineering initializers retain their real commands:

| Command | Responsibility |
| --- | --- |
| `/skill:setup-matt-pocock-skills` | Engineering issue tracker, triage vocabulary and domain docs |
| `/skill:setup-pre-commit` | Git pre-commit formatting, type checks and tests |
| `/skill:setup-ts-deep-modules` | TypeScript dependency and module boundaries |

They are not Obsidian setup. `nature-shared` remains an internal reference dependency rather than a normal suggested workflow.

The renderer and Enter/Tab keyboard handler now consume the same grouped ordering. Previously the display regrouped search matches while selection consumed their ungrouped order, allowing the highlighted row and selected command to differ. Indices are clamped at both ends.

## Ownership, compatibility and loading

First-party commands explicitly declare presentation metadata. Aliases fold only when their primary is registered by the same source object; unrelated `setup` commands, orphan aliases and the SDK's conflict suffixes stay intact. The SDK dispatch table is never rewritten by catalog presentation.

`research-vault` owns setup/read/maintenance/Wiki review. `zotero-literature` owns `/zotero-setup` and Zotero CLI access; it does not initialize the Vault. `research-workflow` handles full research runs, not another initializer. Its previously invalid unquoted YAML description contained a colon and failed loading; the header is now valid. It remains project-scoped and checks tool availability rather than promising a global research toolchain.

A local metadata audit after this repair found 70 skills in the tested development project: knowledge 2, research 9, writing 13, presentation 6, engineering 24, collaboration 12, specialized setup 3, references 1. These are a local snapshot, not a shipped mandatory inventory. No source under the user's shared `.agents/skills` directory was modified, and no package was uninstalled.

## Checks and inspection

- `scripts/audit-skill-catalog.mjs <cwd> <agentDir> [--trusted-project]` loads the resource catalog, not a model or setup command. Project-local resources default to untrusted; use the explicit flag only for an authorized project. As with normal SDK loading, extension modules may run registration code.
- `packages/backend/test/command-catalog.test.ts` checks ownership, collision names, compatibility and valid first-party frontmatter.
- `packages/desktop/src/renderer/src/components/composer/skill-catalog.test.ts` checks classification, search, special entry visibility and consistent grouping.
- `scripts/check-skill-catalog-ui.mjs` renders real components and exercises the real keyboard handler in an isolated Electron window. No model, Vault write or user test-session restart occurs.

Catalog work does not change knowledge publication checks, review approvals, or initialization write confirmations. Updates require reloading the local application build; the currently running acceptance-test window is not forcibly restarted by this work.
