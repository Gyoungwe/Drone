# Knowledge delivery round 3 — topic closure

This round closes the gap between completed research runs and visible topic knowledge.

After a successful `research_summarize_run`, the application host inspects only the current turn's actual, current-version non-Wiki read receipts. If the saved summary is substantial and bounded, it deterministically stages one shared `Wiki/<result-slug>.md` candidate outside the live Vault. It does not start another model, does not scan the whole Vault, and does not publish the candidate.

The candidate body comes from the evidence-gated run summary. `stageWikiProposal` still adds source versions/read ranges and still enforces human review. Existing Wiki targets require a current read before they can be replaced. Missing evidence, oversized/short summaries, existing targets without a read, run-only policy, or other review constraints produce an explicit skip/failure status instead of silently inventing a topic.

A same-project pending candidate for the same target is reused rather than auto-duplicated. Explicit model proposals suppress the automatic proposal path for that turn.
