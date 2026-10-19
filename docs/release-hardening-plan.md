# Drone Release Hardening Plan

Updated: 2026-09-12

## Ordered checklist

- [x] 1. Make repository lint/CI checks green without disabling rules.
  - Verified: `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` all exit 0.
  - Full tests: backend 730 + desktop 372 = 1,102 passed. Biome still reports non-blocking warnings; no rule was disabled.
- [x] 2. Normalize public repository metadata, release links, badges, issue URLs, and version metadata.
  - Verified: public repository/issues/security/release/CI/update links resolve to `Gyoungwe/Drone`; original author attribution remains unchanged.
  - At item 2 the release version intentionally remained `0.5.6`; item 7 finalized desktop `0.6.0` after installer and live-review validation.
- [x] 3. Show Wiki model-review token/cost usage in the review UI with the same honest accounting rules as chat usage.
  - Verified in real Electron components: 900 input + 120 output renders as 1.0k tokens; `cost=0` renders as unknown pricing, not free; no cache rate is invented.
- [x] 4. Commit the completed sidebar, model-review, distribution-parity, and release-hardening source changes.
  - Commit: `c012518 feat(research): add model review and harden release parity`; no push performed.
- [x] 5. Build fresh packaged artifacts and run a clean-install / first-launch smoke test without developer-local skills or Vault data.
  - Verified arm64 DMG mount/copy/launch with isolated HOME, userData, agentDir and knowledgeDir. Packaged app exposed built-in research skills/commands, knowledge was enabled-but-unbound, and fresh auth/model stores were `{}`.
  - Expected pre-release caveat: updater reports no production Release at `Gyoungwe/Drone/releases/latest`; re-check after item 9.
- [x] 6. Run one real model-assisted Wiki review against an isolated disposable Vault and record usage/result; never modify the user's real Vault.
  - Live provider: `youngwe/gpt-5.6-sol`; verdict `approve`; 5,103 input + 177 output tokens; all five checks passed; no cautions.
  - Advice-only (`autoApply=false`): Wiki not written, candidate remained pending, parent messages unchanged, `scientificallyVerified=false`; disposable Vault/credential copies removed.
- [x] 7. Finalize release version and changelog after the packaged-app and live-review checks pass.
  - Final version: `v0.6.0`; desktop package and package-lock agree. Added `CHANGELOG.md` plus `docs/releases/v0.6.0.md`; release workflow consumes tag-specific notes.
  - Re-verified lint, typecheck, 1,102 tests, build, workflow YAML parse, and packaged-resource smoke.
- [x] 8. Push `main` to `origin` and verify the branch CI workflow is green.
  - Remote CI run `34693203619` passed on `5613871`; final storage-isolated HEAD `f62616d` passed run `34693582584` (npm ci, lint, typecheck, 1,102 tests, build).
  - Push-triggered runs were not created on this fork, so `workflow_dispatch` remains the explicit reproducible fallback; Actions itself is enabled and the manual runs used GitHub-hosted runners normally.
- [x] 9. Create and push the matching `v*` tag, verify GitHub Release artifacts, and record final release checks.
  - Storage isolation: `Ywei-pi` currently holds ~22.3 GB Actions artifacts plus ~4.78 GB caches. Drone Release now uploads build outputs directly to a draft GitHub Release instead of Actions artifact storage, then verifies required assets before publishing.
  - Fork push/tag events did not create workflow runs automatically; Release now also supports `workflow_dispatch(tag)` and validates/checks out that existing tag before building, so v0.6.0 can be recovered without moving the tag.
  - First manual Release run `34694088202` validated tag checkout and Windows direct uploads; macOS upload failed only because Bash 3.2 lacks `mapfile`. Upload loop was made Bash 3.2-compatible before retrying the same draft/tag.
  - Final Release run `34694503041` succeeded: prepare, macOS, Windows, required-asset verification/publish, and website jobs all passed.
  - Published `v0.6.0` contains 13 assets including both macOS DMGs/ZIPs, Windows installer/ZIP, blockmaps and updater metadata; `/releases/latest` points to v0.6.0.
  - A clean packaged 0.5.6 app then reported updater state `available` for `0.6.0` with no updater error (`manual:true` is expected for adhoc macOS signing).

## Guardrails

- Do not package or commit model credentials, sessions, private Vaults, downloaded literature, browser logins, generated research results, or user-installed third-party skill directories.
- Do not weaken publication gates, Wiki version checks, project trust, or model-review consent to make tests pass.
- Keep model review distinct from scientific verification and human review.
- Every completed checklist item must have a reproducible validation note before it is checked off.

## v0.33.3 follow-up gate

The v0.33.2 audit showed that resource checks and asset-name checks could pass
while a public macOS installer remained malformed. The release workflow now
has two separate package gates:

- **Build gate:** each runner opens the artifacts it built. macOS uses native
  `ditto` ZIP extraction and read-only `hdiutil` DMG attachment; Windows
  expands the ZIP and runs the NSIS installer silently, then checks the app
  payload and `app.asar`.
- **Upload gate:** macOS and Windows runners download the assets back from the
  GitHub draft release, compare size/SHA-256 to the build manifest, and repeat
  the platform package checks. Only the `finalize` job can remove `draft`.

The unsigned policy remains unchanged. A local or static resource check cannot
close either package gate; evidence must come from the actual installer files.

### v0.33.3 timing and metadata follow-up

The package build now runs from the immutable candidate commit in parallel
with the full validation matrix. The macOS runner produces arm64 and x64 in a
single Electron Builder invocation, so `latest-mac.yml` has one producer and
cannot be silently overwritten when artifacts are merged. Electron runtime
and builder caches are keyed by platform and package locks. Each build rejects
unexpected files, and the post-upload manifest comparison is exact in both
directions, covering installers, blockmaps, and updater metadata.
