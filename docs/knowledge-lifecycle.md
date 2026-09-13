# Knowledge lifecycle integration

After a successful `research_summarize_run`, the existing host checks still
require current parent-turn reads and the normal evidence/publication validation.
Only then does the extension write a compact topic-memory record and continue
the existing automatic Wiki candidate flow. Wiki changes still require
`/obsidian-review`; run-only and read-only policies remain authoritative.

Topic memory uses the same bound Vault/project identity as the knowledge service,
but its generated JSON is outside user-authored notes. Repeated summaries with
the same deterministic run/source hash are idempotent. A changed source marks a
record stale; low-overlap additions are reported as `conflict-candidate` and
remain subject to human review. Neither status overwrites a human Wiki page or
satisfies an evidence gate.

`research_topics` lists compact records for the current project. A caller can
select an exact id, title, or unique alias with `research_resume_topic`; vague or
ambiguous input returns candidates. The selected packet is scoped to the active
turn and includes an explicit obligation to reread sources. Binding changes and
explicit topic changes clear that selection; continuation prompts (including
Chinese pronouns such as “那它的幼虫呢”) retain it. A manual prepare refresh
does not erase a valid selection.

The public helper API is `createTopicMemory({ binding, project })`, whose store
supports `read`, `list`, exact `get`, CAS `update`, CAS `archive`, and
`record`. Returned lifecycle receipts are suitable for Run Inspector display.

Lifecycle tests use deterministic synthetic fixtures and fake provider/tool
events only. They are regression tests for persistence, scope, concurrency,
path safety, deduplication and extension wiring, not live model measurements.
