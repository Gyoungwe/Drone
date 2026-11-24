# Delivery and explainers

Read this when delivering a paper, manual or explainer, archiving a Show Me explainer and closing the run.

Load the relevant delivery sections of `research-vault` for a paper/software/manual task. “Download the manual” includes the version-specific CLI reference, arguments, input/output and runnable example explanations, not just the homepage or a bibliographic entry. Capture substantive paper methods/claims and software principles/usage in reusable source-grounded notes. A generated run summary is an operational record; its successful save is not scientific verification.

When the user requests an explainer and writes are authorized, use the loaded show-me skill after source reading for a focused explainer, linked in the normal final text answer. Do not create presentation artifacts for plain read-only planning. For software, distinguish documented performance from local measured tests (or explicitly “not tested”); for research, explain the main viewpoint, methods, evidence and limitations. Never substitute the UI progress status for delivery or treat file download as comprehension.

After `research_summarize_run` succeeds in application mode, the host automatically stages one shared topic Wiki candidate when the summary is substantial and at least one current-version non-Wiki evidence note was actually read this turn. The candidate is generated from the saved summary, stored outside the live Vault, and remains unverified until the user reviews it. Do not create a duplicate proposal unless the host reports that automatic staging was skipped or failed; if an existing topic requires a fresh read, read it and then propose the correction explicitly.

## Show Me in the knowledge base

After generating a source-grounded Show Me HTML/Markdown file under the configured results root, call `research_archive_explainer` with the active research run `metadata.topic_id` (reuse it across rounds), title, short summary, and 1–12 underlying evidence note paths that were actually read this turn. The host copies the visual artifact into `Attachments/Explainers/<topic-id>/`, maintains `Library/Explainers/<topic-id>.md` as the searchable latest/history pointer, and preserves human review text. Explainers are presentation-only: they may help a human navigate and understand a topic, but they are excluded from evidence receipts, automatic Wiki source selection, and scientific verification. Never cite an older explainer instead of the paper/software/manual sources it summarizes.
