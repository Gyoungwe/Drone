# Percho Release Hardening Plan

Updated: 2026-09-12

## Ordered checklist

- [x] 1. Make repository lint/CI checks green without disabling rules.
  - Verified: `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` all exit 0.
  - Full tests: backend 730 + desktop 372 = 1,102 passed. Biome still reports non-blocking warnings; no rule was disabled.
- [x] 2. Normalize public repository metadata, release links, badges, issue URLs, and version metadata.
  - Verified: public repository/issues/security/release/CI/update links resolve to `Gyoungwe/percho`; original author attribution remains unchanged.
  - Release version remains intentionally at desktop `0.5.6` until item 7, after installer and live-review validation.
- [x] 3. Show Wiki model-review token/cost usage in the review UI with the same honest accounting rules as chat usage.
  - Verified in real Electron components: 900 input + 120 output renders as 1.0k tokens; `cost=0` renders as unknown pricing, not free; no cache rate is invented.
- [ ] 4. Commit the completed sidebar, model-review, distribution-parity, and release-hardening source changes.
- [ ] 5. Build fresh packaged artifacts and run a clean-install / first-launch smoke test without developer-local skills or Vault data.
- [ ] 6. Run one real model-assisted Wiki review against an isolated disposable Vault and record usage/result; never modify the user's real Vault.
- [ ] 7. Finalize release version and changelog after the packaged-app and live-review checks pass.
- [ ] 8. Push `main` to `origin` and verify the branch CI workflow is green.
- [ ] 9. Create and push the matching `v*` tag, verify GitHub Release artifacts, and record final release checks.

## Guardrails

- Do not package or commit model credentials, sessions, private Vaults, downloaded literature, browser logins, generated research results, or user-installed third-party skill directories.
- Do not weaken publication gates, Wiki version checks, project trust, or model-review consent to make tests pass.
- Keep model review distinct from scientific verification and human review.
- Every completed checklist item must have a reproducible validation note before it is checked off.
