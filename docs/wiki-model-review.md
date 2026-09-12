# User-delegated model review

## UI and authority

In Knowledge → Wiki review, select a candidate and click **模型自动审核**. The user acknowledges a separate model request and may explicitly select “apply this candidate after successful review.” Advice-only is the default. The consent and preview token apply to one exact candidate; neither automatic approval of future candidates nor an ongoing background reviewer is enabled.

The host requires an open writable session in the originating project, a selected model, trusted project, permitted Vault child access and non-off specialist settings. No live Wiki auto-apply in run-only mode. The desktop main-frame IPC is the only new entry; no model tool or LAN write endpoint is exposed. A per-role model override can select `knowledge-wiki-reviewer`; otherwise it inherits the selected session model. A missing configured override fails without provider fallback.

## Review and application

A fresh isolated request sees the old/proposed managed block, protected human text and 1–6 exact recorded source ranges. It has only a structured result submission tool: no shell, arbitrary file access, network, recursive delegation or write/approval tool. Parent conversation history is absent. The packet is limited to 34 KB, sources to 8,000 characters each, one model response and 120 seconds including queue time. Over-budget data is refused rather than silently truncated. Standard native-agent concurrency limits remain in force.

The model returns approve / needs-human / reject, a short explanation, all supplied source paths, cautions, and five checks: source support, retained scope/uncertainty, absence of unresolved contradictions, protection of human content and no identified instruction injection. Automatic application requires approve, every check true and no cautions, plus explicit user authorization. Otherwise the pending candidate remains for human handling; a model rejection does not delete it.

Host checks compare candidate, target, source and binding versions before and after evaluation and immediately before writing. Candidate merges and decisions share one lock. Human edits outside the managed block are unchanged. Audit records persist before an attempted write and retain the exact candidate hash, source hashes/ranges, reviewer model, verdict, checks, usage and write outcome. The applied proposal records `reviewMethod=model`, `humanReviewed=false`, `scientificallyVerified=false`. A changed candidate cannot reuse its old model report or one-shot preview.

Audit-only results do not invalidate the entire index or trigger model consolidation. Actual application updates only the changed note and existing navigation-maintenance queue. Closing the panel cancels the task; closing its session, disabling access, failure or timeout prevents accepting a late result. A failed request consumes the preview, and the UI explicitly requires refresh before another action.

## Boundaries

This checks consistency against the supplied Markdown ranges, not automatic comprehension of original PDFs or scientific truth. A metadata-only archive record should cause needs-human. Model checks can still be wrong; opting into auto-apply delegates that risk rather than certifying the result. No private model reasoning is displayed or persisted as review evidence. Separate review usage is retained in its audit; it is not silently counted as a main-chat SDK response.

Tests cover both advice-only and authorized application, protected human text, pending verdicts, failed checks/cautions, exact source coverage, replayed/forged tokens, changed sources/targets/candidates, cancellation, project/trust boundaries, missing model capabilities, mode-off behavior and unchanged main session context. SDK tests use a scripted provider, not a live paid model. The GUI fixture exercises consent, mode defaults, audit display and needs-human with real IPC and a scripted review result; no user Vault is modified.
