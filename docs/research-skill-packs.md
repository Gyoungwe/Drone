# Research skill packs: discovery is not activation

## Architecture

Keep the existing `CapabilityRuntime` / `CapabilityResourceLoader` boundary. This is **not** another agent, global mega-prompt, or a replacement for the first-party research workbench.

1. **Installed source files**: immutable, commit-pinned upstream skill directories, references, manifests and scripts. Installing a skill does not install its Python packages, enable a service, execute its scripts, or register upstream agent extensions/hooks.
2. **Host catalog**: all installed skills retain upstream SDK names, paths and manual invocation semantics. Settings and slash browsing can inspect this full inventory. Existing user skill precedence and SDK collision diagnostics are unchanged.
3. **Capability routing**: existing tools continue to follow capability detection and permission gates.
4. **Task routing**: the new research selector exposes only relevant skill metadata. A generic `research` / `external` activation no longer dumps every imported skill into the prompt. Bilingual intent topics plus exact skill-name matches select at most **6 automatically discovered research skills**, with an estimated **6,000-byte metadata budget**. First-party skills are outside this supplemental budget. One execution workflow owns the current stage, including explicitly named candidates; specialists can supplement it. Longest exact name matching prevents academic-paper-reviewer from selecting academic-paper. Replies and polishing take precedence over broad review/writing keywords. Explicit comparisons can expose multiple workflows as read-only comparison references, not simultaneous execution owners.
5. **Progressive reading**: the agent reads a selected `SKILL.md`, then only its task-required fragments/references. `nature-shared` is kept on disk as a dependency, never auto-suggested as a standalone workflow. No skill bodies are concatenated into the system prompt.

Direct `/skill:name` is an explicit user choice and bypasses automatic discovery limits, as before. An SDK-expanded skill body is reduced back to its invocation before routing; its embedded instructions must not become new user routing intent. These routing controls are context selection, **not a filesystem security boundary**: available read tools can still read permitted paths.

## Ownership examples

| User task | Preferred supplemental skill |
| --- | --- |
| 论文写作 / draft manuscript | `nature-writing` (fallback `scientific-writing`) |
| 润色 / language-only editing | `nature-polishing`, not the full drafting pipeline |
| 文献综述 / systematic review | `literature-review` |
| 引用核验 | `nature-ref-verifier` |
| 科研绘图 | `nature-figure` (fallback `scientific-visualization`) |
| 单细胞分析 | `scanpy` |
| 差异表达 / bulk RNA-seq | `bulk-rnaseq` |
| 统计分析 | `statistical-analysis` |
| `qiskit` / another exact installed name | that specialist only, then relevant task owners |
| End-to-end academic pipeline | `academic-pipeline` **only if independently opted in**, otherwise retain the first-party research workflow and report ARS unavailability (no daily-feed fallback) |
| Greeting / code review / generic MCP connection | no imported research skills |

For a missed or changing subtask, the existing escape hatch now accepts:

```json
{"capabilities":["research"],"task":"scanpy single-cell analysis"}
```

This is input to `capability_load`, not a new tool. Only installed skills can become visible. It does not download or install anything. Vague research queries retain the first-party `research-workflow`; the agent can clarify intent rather than expose 190 skills. Exact named specialist choices take precedence over competing default owners.

New independent turns reset the selected topics; `继续` / `continue` restores them. Session checkpoints store only bounded topic IDs and recognized skill names, not the raw prompt. Read-only library restrictions, excluded tools, project trust, publication checks and user confirmations remain in force. ARS orchestration instructions are advisory: Drone owns task state, native Vault/Zotero tools, evidence receipts, and publication approval.

## Sources and licenses

`packages/shared/src/research-skill-sources.json` is the committed source lock and inventory:

| Source | Pinned commit | Indexed | Release profile |
| --- | --- | ---: | ---: |
| [Nature Skills](https://github.com/Yuan1z0825/nature-skills) | `2375e0abdf42158ef149256f2c64b1f759a0d274` | 20 | 20 |
| [Scientific Agent Skills](https://github.com/K-Dense-AI/scientific-agent-skills) | `330c8e764435a731eff571e3efdda70b363d0792` | 166 | 148 |
| [Academic Research Skills](https://github.com/Imbad0202/academic-research-skills) | `3c546bc08c56f79e0068f1ea4f0acedf5bf69b5e` | 4 | 4 (separate permission) |

Nature has Apache-2.0 root licensing (some individual headers say MIT). Scientific has MIT root licensing, **but its individual skill metadata is mixed**. We conservatively exclude 18 entries from default redistribution: `biopython`, `bioservices`, `cobrapy`, `deepspot-m`, `docx`, `etetoolkit`, `glycoengineering`, `imaging-data-commons`, `matplotlib`, `pdf`, `phylogenetics`, `polars`, `pptx`, `primekg`, `rowan`, `sympy`, `what-if-oracle`, `xlsx`. These have copyleft, restrictive, unknown, URL-only or otherwise unresolved per-skill declarations. Some headers may describe the documented software rather than the documentation itself; exclusion is precautionary, not a legal determination. Enabling them for redistribution requires a separate license review and a reviewed lock change. Existing independently installed user skills are not uninstalled or relicensed.

ARS upstream remains **CC BY-NC 4.0**. At the product owner's explicit request, this release profile now includes the complete ARS pack using separately held permission. This is a distribution configuration decision, not a change to the upstream license or a grant to downstream users. The distributor must ensure the separate agreement covers the intended recipients and distribution. Local noncommercial installation remains possible but cannot satisfy release preflight. This change does not assert a commercial license clearance for the external libraries, databases or assets described by any skill.

Original license files and directory structure are preserved. The Nature `nature-proposal-writer` directory declares the SDK name **`researchwrite`**; we keep that actual name instead of inventing a rename. Academic's four skills live at the repository root, not the `skills/` symlink facade. The importer now preserves the complete ordinary-file repository (2,737 files at this pin), including pi/, commands/, MODE_REGISTRY.md, shared agents, scripts and references. Only four redundant skills/* symlink facades are omitted for Windows portability. The host registers the four real skill entries, 16 original prompt templates, and one reviewed bridge. Claude hooks, other repository extensions and scripts are not automatically registered or executed.

## Installation, validation and packaging

Requires Python 3.10+ for acquisition/verification only; the running app remains Node/Electron.

```sh
npm run skills:sync                 # default: nature + filtered scientific
npm run skills:check                # offline: validate every acquired file hash
```

The first acquisition downloads commit-pinned GitHub archives (Scientific's full archive is about 234 MB, despite the selected skill files being much smaller). There are no runtime network fetches. Downloads have size bounds, locked SHA-256 checksums, path/type checks and staged publication. An existing changed/stale destination is **not overwritten**; move it aside explicitly before resync. The script never executes upstream code or reads credentials. Skill scripts remain inert until a separately authorized agent task requests execution.

Generated sources live in `packages/desktop/resources/research-skills/`, intentionally gitignored. Keep the source lock, installer and routing code in Git rather than vendoring huge repositories. `npm run dist -w packages/desktop` verifies all three sources before building. The electron-builder `beforePack` hook repeats the fail-closed check, including when invoked directly. A fresh checkout must acquire Nature/Scientific and explicitly install ARS with applicable separate permission. Missing ARS, stale hashes or a noncommercial-only receipt fail the release check. Runtime missing/stale packs fail closed with a diagnostic warning; first-party skills remain available.

**ARS acquisition**, only under an applicable license basis. Noncommercial local use (not the release profile):

```sh
python scripts/sync-research-skills.py --sources academic --acknowledge-noncommercial
python scripts/sync-research-skills.py --sources academic --acknowledge-noncommercial --check
```

If a separate permission already covers your commercial **local use**, record that explicit attestation instead (this flag does not grant a license):

```sh
python scripts/sync-research-skills.py --sources academic --acknowledge-commercial-permission
python scripts/sync-research-skills.py --sources academic --check
```

The development and packaged apps both register verified ARS resources. `electron-builder.yml` explicitly lists Nature, Scientific and Academic; full ARS paths, original LICENSE/NOTICE and the acquisition receipt are retained. Inclusion does not switch on every skill: session/task visibility and start/stop behavior are unchanged.

Release preflight (offline, no build or publish):

```sh
python scripts/sync-research-skills.py --sources nature scientific academic --check --for-release
```

The release check requires `licenseAuthorization=separate-permission`, based on the distributor's existing agreement and explicit redistribution instruction; a receipt is an attestation, not the agreement itself. Do not embed private license contracts or credentials in the resources. Neither this configuration nor the app's MIT license relicenses upstream ARS or its external dependencies.

After installation or changing source paths, reload/restart the development app at a convenient time. This work does not forcibly restart the current user session.

## Update and rollback

To update a source, review upstream code/data and license changes, regenerate the source inventory and archive checksum for a specific commit, review task mappings and validate the importer/router/pack loader. The lock's `runtimeFiles` also pins the Pi executable wrapper, package manifests, mode registry and original command templates individually. The `bundled` flag is a reviewed redistribution decision, not an automatic inference made at runtime. Preserve local modified packs before replacing them. No background updater follows `main`.

To disable all acquired sources locally, move their directories outside `resources/research-skills` and restart/reload; no global `.agents/skills` files are touched. Reverting the integration code restores the previous broad category selector. Pre-existing and concurrent UI, resource-preview and SSH changes are unrelated and must not be reverted with this upgrade.


## ARS Pi bridge and conflict policy

The source remains the upstream [Pi wrapper](https://github.com/Imbad0202/academic-research-skills/blob/main/pi/README.md), unmodified and commit/hash-pinned. `academic-pi-bridge.ts` delegates command transformation, original argument substitution, capability doctor and compatibility text to that wrapper through a narrow API facade. It does not reimplement ARS paper/reviewer content or install a second agent framework.

- `ars-pi-state` remains the authoritative session/branch mode record. Host eligibility is synchronized from it at session start, tree navigation and start/stop. Stop retracts stale explicit ARS selections as well.
- `/ars-plan`, `/ars-full`, `/ars-reviewer` etc. route on the **canonical target plus original user arguments**, not the wrapper-generated command instructions. Native SDK skill expansion is retained. The subsequent `message_start` does not interpret the expanded body/command description as a fresh user request.
- `/ars-pi-start` allows ARS to own matching research stages. It does not inject ARS instructions into unrelated work. Compatibility text is emitted only while the actual authorized ARS skill is visible for that task.
- The input adapter refuses ARS commands/mode changes during streaming. Retry after the current run is idle; there is no promise of rewriting an in-flight system prompt. Direct SDK steer/follow-up bypassing normal prompt dispatch is not a supported way to activate an ARS workflow.
- If a required canonical ARS name resolves to a different user's skill path, the bridge refuses the command rather than overwriting or silently invoking the shadowing skill. Running a standalone vanilla wrapper alongside the bridge is rejected with an actionable loader error.
- The source's Claude hooks are **not** active. Its wrapper does **not** supply agent isolation. Existing host permission/read-only/publication checks remain in force, and simulated roles must not be called independent blind review.
- The mandatory AI-figure paragraph in Scientific `literature-review` is explicitly overridden at the host compatibility layer: it does not authorize extra deliverables, external uploads, payments or generation. The agent must honor user scope, privacy and journal policy. This guidance supplements existing tool permissions; it is not a claim that every arbitrary shell command is semantically sandboxed.
- The 6 KB budget concerns automatic **metadata discovery only**. Native `/skill:*` expansion can add a much larger source body (ARS entries are about 37–53 KB). Reference/body I/O and compatibility text are separate from that estimate.

Typical commands after reloading the development app:

```text
/ars-pi-doctor
/ars-plan your research question
/ars-reviewer
/ars-full
/ars-pi-start
/ars-pi-stop
```

`doctor` runs only when explicitly invoked; missing optional Python/Pandoc/tectonic/search/orchestration capabilities are reported, not installed automatically. A source acquisition receipt is not evidence that those tools or APIs are installed.

### Validation

- `packages/backend/test/research-skill-router.test.ts`: name boundaries, stage precedence, single workflow ownership, comparisons, non-equivalent fallback removal, budgets and continuation behavior.
- `packages/backend/test/academic-pi-bridge.test.ts`: the real pinned wrapper, real SDK skill expansion and host router with controlled session/tool I/O. Tests idle/streaming behavior, state restoration, source shadowing and generated-command isolation.
- `packages/backend/test/academic-pi-sdk.test.mjs`: actual PiBackend and SDK sessions with an **offline faux model provider**, temporary project/agent directories, real command registration and final system-prompt assertions. Also rejects duplicate vanilla/bridge registration.
- `packages/desktop/src/main/research-skill-packs.test.ts`: fail-closed integrity/license checks, prompt registration and ARS packaging inclusion and mandatory release preflight.

The two ARS integration suites explicitly skip when an authorized local ARS pack is absent. Run them after an authorized installation; a skipped suite is not an acceptance pass. No paid model, remote research service or production session is needed for these checks.
