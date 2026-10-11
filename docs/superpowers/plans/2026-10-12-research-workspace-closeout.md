# Research workspace closeout

## Scope

This release closes four visible seams in the desktop workbench:

1. The Process panel is the only route-progress surface. Chat messages carry the answer and task decisions; they do not render a second route diagram.
2. The Process panel shows the current node of the selected user turn in a short, readable sequence. Internal route states still drive the projection, but labels such as “blocked” and “review” are not repeated as user-facing banners.
3. A first-run guide appears in a new empty session until the user chooses an entry or dismisses it. The guide opens the existing knowledge, Zotero, and compute configuration surfaces and offers a real literature example task.
4. Visible proposal copy comes from the bilingual message catalog, so internal labels in `AskDialog` do not leak into the research-facing UI.

## Knowledge architecture decision

The architecture review is recorded in the Archify artifact [knowledge-dataflow.html](/Users/gaoyangwei/.codex/.chatgpt-projects/g-p-6ac00da3f1688191b23c3024ffabae6c/Drone/.archify/dataflow-knowledge-20261012-041547/knowledge-dataflow.html). Its verified main path is:

`Vault binding → ingest classification → SQLite FTS / constrained semantic recall → observed read receipt → Wiki review → versioned reusable Vault`

The existing rules are retained because they match the intended research boundary:

- Search candidates are not evidence. Reuse requires a non-empty read, current content hash, line/excerpt provenance, and the strict-mode completeness checks.
- A note becomes a deposit candidate only when the ingest policy classifies it as knowledge; run logs, raw outputs, and ephemeral files do not enter the durable knowledge base by accident.
- Binding revision, source hash, Wiki proposal hash, navigation, and delivery changes invalidate old receipts.
- Zotero remains the literature source of record; only interpreted, citable notes are copied into the Vault. Remote hosts remain compute targets and are probed before execution.

## Acceptance checks

- Chat contains no `TurnRouteCard` or mind-map route surface.
- Process shows one compact current-node summary and the detailed explanation only through the process lane.
- The first-run guide is visible by default in an empty session, stores dismissal after any click, and exposes knowledge, Zotero, remote-host, and example-task paths.
- Example tasks remain ordinary user-visible tasks: one structured first message, `task_plan`, one authorization boundary, and observable deliverables.
- User-facing proposal labels are translated in both Chinese and English.
- Desktop targeted tests, shared route/process tests, typecheck, lint, architecture checks, and a build pass.
