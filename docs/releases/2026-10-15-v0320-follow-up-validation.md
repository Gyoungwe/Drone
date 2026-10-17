# v0.32.0 follow-up validation

**Integration head**: `cadb9cfb` on `codex/v0320-self-integration`
**Scope**: close the repository-verifiable gaps from the Drone Scientific Workbench Upgrade Plan v2.

## Passed

- `npm run check:arch`: 0 baseline findings.
- `npm run typecheck` for backend, including the new ordinary-session causal root path.
- `npm run build` for Electron main/preload/renderer; LAN web build was removed with the LAN observer feature.
- `npm run check:ui-evidence`: settings, bounded graph/list, responsive and reduced-motion A contracts; LAN is no longer part of the surface.
- `npm run check:extensions`, `check:knowledge-runtime`, `check:research-runtime`, `check:tasks-runtime`, and `check:plugin-api`.
- `npm run test:research-packaging`: 16/16.
- Causal evidence/controller/projection tests: 15/15.
- Chrome parity harness: 168 screenshots across 375/768/1024/1440, light/dark and reduced-motion variants. Outputs and SHA-256 receipt are in `/tmp/drone-ui-parity-p5` and `/tmp/drone-ui-parity-p5.sha256`.

## Environment-qualified results

- `npm run lint` passes with the repository's three existing CSS specificity warnings; `--error-on-warnings` remains red for those warnings.
- `npm test` still has environment-sensitive failures in listener permissions, child-process module resolution and external usage/knowledge fixtures.
- `npm run test:upgrade -- --fixtures-only` passes orchestration stress but the hybrid fixture cannot listen on `127.0.0.1` in the sandbox.
- `npm run skills:check` remains fail-closed because the authorized external research skill pack and `.drone-pack.json` are absent.
- A user-authorized remote smoke ran on `gaoxuze@202.112.170.226` with one
  paired-end sample. FASTP, FastQC, HISAT2, featureCounts and MultiQC produced
  real hashed evidence; the receipt is in
  [real RNA-seq evidence](2026-10-15-real-rnaseq-evidence.md).
- The host has no Nextflow executable. The native run therefore does not close
  the pinned nf-core/rnaseq trace/provenance gate or scientific-review gate.

The repository now contains the implementation and controlled evidence needed for the A/B review gates, plus a bounded real-host FASTQ evidence receipt. The LAN observer and its HTTP/SSE release surface were removed on 2026-10-16 after product review. The pinned nf-core/rnaseq execution, scientific review and authorized skill-pack release checks remain C/release gates and are not inferred from fixtures, screenshots or the native smoke.
