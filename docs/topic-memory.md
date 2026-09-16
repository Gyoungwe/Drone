# Topic memory

Topic memory is bounded navigation metadata stored outside the configured Vault at
`<DRONE_KNOWLEDGE_DIR>/<vaultId>/topic-memory/<project>.json`. The scope is the
validated application binding (`vaultId`) and the current project; records never
cross either boundary.

The document is schema-versioned and written with a temporary file plus rename.
Updates are serialized per memory path and accept an expected `revision` for
compare-and-swap. Missing memory starts empty. Corrupt or future-version memory
is rejected and is never overwritten. Paths are derived from the validated
binding/project, and source references are Vault-relative path/hash pairs.

Each record is compact and bounded: title/aliases, summary, entities, unresolved
questions, source path/hash references, run/proposal/Show Me links, source session
id, lifecycle status and timestamps. Full transcripts, private reasoning, secrets
and generated instructions are not stored. Memory is navigation data only; it is
not evidence, a publication permission, or an instruction source. Sources listed
in a resumed record must be reread and revalidated in the current turn.

The host exposes `research_topics` and `research_resume_topic` for listing and
exact selection, plus read-only-safe metadata update/archive tools in writable
modes. Ambiguous selections return candidates. A completed, evidence-gated
`research_summarize_run` with current source reads records a deterministic
`new`, `additional`, `duplicate`, `stale`, or `conflict-candidate` receipt. The
last two are flags for human review; no semantic contradiction detector is
claimed and no human-authored Wiki text is silently changed.

The `createTopicMemory({ binding, project })` helper also exposes bounded
`context(topic)` and `refreshSourceCheck(topicId)` APIs. Context is capped at
2,400 serialized characters; source refresh marks changed or missing files
stale without creating parent-turn evidence receipts.

Tests in this worktree use synthetic temporary Vaults and deterministic fake
tool events/providers. They do not measure live model quality or call paid
providers.
