# Research skill packs: discovery is not activation

Drone 的内置研究技能来源目前只有两个公开仓库：

- [Nature Skills](https://github.com/Yuan1z0825/nature-skills)
- [Scientific Agent Skills](https://github.com/K-Dense-AI/scientific-agent-skills)

它们随发布包内置。每周的 GitHub Actions 会检查上游 `main`、更新固定 commit 与归档 SHA-256，并创建一个可审阅的更新 PR。已安装客户端启动后会自动检查一次、之后每两小时检查一次；发现更新会在「技能与连接」显示。应用更新仍需用户点击确认：客户端只下载固定 commit 的归档，校验路径、清单、文件哈希和归档哈希，写入用户目录的版本化 overlay，最后在安全重启后启用，不会静默替换正在使用的技能。`npm run skills:update` 可在维护者本地执行同一更新检查。新增或删除技能会停在审阅门槛，不会静默改变内置清单。

桌面端的「技能与连接」页同时显示每个内置科研技能对应的 GitHub 仓库和锁定 commit/path，并在页面顶部显示仓库级来源卡片、内置技能数和当前加载数；仓库卡片可直接打开上游地址，并标出“支持自动检查”或“仅目录”。Pi loader 返回的 `local`、`auto` 等运行时标签只用于没有目录映射的本地技能，不能作为上游仓库身份。

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
| [Nature Skills](https://github.com/Yuan1z0825/nature-skills) | 见 `research-skill-sources.json` | 20 | 20 |
| [Scientific Agent Skills](https://github.com/K-Dense-AI/scientific-agent-skills) | 见 `research-skill-sources.json` | 166 | 148 |
| Academic Research Skills（可选、非默认） | — | — | 不随默认发布包分发 |

Nature has Apache-2.0 root licensing (some individual headers say MIT). Scientific has MIT root licensing, **but its individual skill metadata is mixed**. We conservatively exclude 18 entries from default redistribution: `biopython`, `bioservices`, `cobrapy`, `deepspot-m`, `docx`, `etetoolkit`, `glycoengineering`, `imaging-data-commons`, `matplotlib`, `pdf`, `phylogenetics`, `polars`, `pptx`, `primekg`, `rowan`, `sympy`, `what-if-oracle`, `xlsx`. These have copyleft, restrictive, unknown, URL-only or otherwise unresolved per-skill declarations. Some headers may describe the documented software rather than the documentation itself; exclusion is precautionary, not a legal determination. Enabling them for redistribution requires a separate license review and a reviewed lock change. Existing independently installed user skills are not uninstalled or relicensed.

Academic Research Skills/ARS remains an optional, separately reviewed integration. It is not downloaded, loaded or shipped by the default Drone build, so the two built-in packs do not require a user-supplied ARS path or license receipt.

Original license files and directory structure are preserved. The Nature `nature-proposal-writer` directory declares the SDK name **`researchwrite`**; we keep that actual name instead of inventing a rename. Scientific's source lock records only the reviewed, redistributable entries; unresolved entries remain available for separate review rather than being silently bundled. Claude hooks, other repository extensions and scripts are not automatically registered or executed.

## Installation, validation and packaging

Requires Python 3.10+ for acquisition/verification only; the running app remains Node/Electron.

```sh
npm run skills:sync                 # default: nature + filtered scientific
npm run skills:check                # offline: validate every acquired file hash
```

The first acquisition downloads commit-pinned GitHub archives (Scientific's full archive is about 234 MB, despite the selected skill files being much smaller). A verified archive is retained in the gitignored `.local/research-skill-cache/` cache, keyed by source, commit and the lock's archive SHA-256, so a clean resource directory can be restored without downloading again. Pass `--offline --cache-dir <path>` to require a cache-only restore; a missing or corrupted entry is rejected and never replaced by an unverified network response. The scheduled updater changes only the reviewed source lock; the release workflow and the installed-client updater both perform the same path/hash checks before activation. Downloads have size bounds, locked SHA-256 checksums, path/type checks and staged publication; both cache and user manifest publication use temporary files and versioned directories. The script never executes upstream code or reads credentials. Skill scripts remain inert until a separately authorized agent task requests execution.

Generated sources live in `packages/desktop/resources/research-skills/`, intentionally gitignored. Keep the source lock, updater, installer and routing code in Git rather than vendoring huge repositories. `npm run dist -w packages/desktop` verifies Nature and Scientific before building. The electron-builder `beforePack` hook repeats the fail-closed check, including when invoked directly. A fresh checkout — including the Release workflow — acquires and verifies both built-in sources. Missing packs, stale hashes, redirected resources or unreceipted extra files fail the release check. Runtime missing/stale packs fail closed with a diagnostic warning; first-party skills remain available.

ARS can still be acquired separately when a future integration explicitly supplies an applicable license basis, but it is outside the default built-in pack workflow.

Release preflight (offline, no build or publish):

```sh
python scripts/sync-research-skills.py --sources nature scientific --check --for-release
```

To restore a previously acquired pack without network access, use the same lock and cache explicitly:

```sh
python scripts/sync-research-skills.py --sources nature scientific --cache-dir .local/research-skill-cache --offline
```

The `--offline` path is a restore operation and still writes only a fully staged, receipt-bearing resource directory. It never grants or infers a license. Do not embed private license contracts or credentials in the resources.

After installation or changing source paths, reload/restart the development app at a convenient time. This work does not forcibly restart the current user session.

## Update and rollback

To update a source, the scheduled updater checks the upstream `main` commit and archive checksum, refuses changed skill inventories, and opens a review PR for unchanged inventories. The installed client performs the same check on demand and at startup, stages each updated source under `userData/research-skills/<source>-<commit>`, atomically replaces its manifest, and waits for a guarded restart before loading the new overlay. GitHub API rate limits (403/429) fall back to the repository's public commit Atom feed; a failed API and feed check or download leaves the current verified pack active. The lock's `bundled` flag is a reviewed redistribution decision, not an automatic inference at runtime.

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

### Resource-copy verification and consolidation proposal

`python scripts/test-research-release.py` exercises release-gate failures without network access. `node scripts/check-research-packaging.cjs` uses electron-builder's actual resource matcher/copier in a temporary directory and verifies every copied source file against its receipt. This check does not build, sign, publish or install the application.

See `research-skill-consolidation.md` and `research-skill-consolidation.csv` for the assessment of 197 source/project skills and the six-direction proposal. The consolidation is a proposal only: no skill body, original command name or source directory has been removed or rewritten.
