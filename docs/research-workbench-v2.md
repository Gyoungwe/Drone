# Research workbench v2

This upgrade keeps research runs inside the existing Knowledge overview. It does not add a second task list or a separate route page.

The panel exposes four independent signals:

- **Route**: only evidence-gate events that actually occurred can become complete; archive and reuse remain separate branches.
- **Evidence**: claims retain their relationship, limitations, source path, quote, hash, and line range. Unsupported and hypothesis claims are shown as gaps.
- **Integrity**: archive entries are checked against the current file bytes, with changed and missing files counted separately.
- **Reproducibility**: the run manifest is projected as observed, incomplete, or changed; it never claims scientific validation.

The event timeline is a bounded, read-only view of the run ledger. A source opens through the existing note reader in the same panel, preserving the current knowledge binding and read-only semantics.

## Acceptance criteria

1. A run with only an archive event leaves the reuse branch pending.
2. Changing an archived file changes its integrity result and creates an evidence gap.
3. A claim card exposes the relationship and limitations instead of treating every citation as direct support.
4. A missing or changed reproducibility manifest is visible without being presented as a failed scientific rerun.
5. No new top-level task list or page is introduced.
