# Knowledge management UI

The desktop Knowledge panel now exposes two human-only tabs: **Semantic retrieval** and **Topic memory**.

Semantic retrieval is opt-in and starts disabled. Settings use a provider, endpoint, explicit model name, and a credential environment-variable name; raw credentials are never accepted or returned. Remote consent is explicit, and saving settings never sends Vault content. The provider test sends fixed generic text only. Indexing is an explicit bounded batch (maximum eight chunks per request), can be cancelled by request id, and reports observed results without inferred coverage, cost, or token counts. Lexical FTS remains the fallback. A human-configurable minimum cosine similarity (default `0.45`) filters weak semantic neighbours; it changes candidate filtering only, not evidence status or vector identity.

Topic memory is read-only until a user explicitly archives a topic. Lists are scoped to the current project and application Vault, use the document revision for compare-and-swap archiving, and present candidate/stale/conflict/archived states neutrally. Resume is an explicit click in a writable, idle session; the prompt quotes the exact topic id and asks the model to prepare knowledge, call `research_resume_topic`, and reread recorded sources. No transcript or private reasoning is injected.

All new IPC channels retain the application main-frame guard. Save, test, index, and archive require the current binding revision; indexing and topic operations also require a validated project cwd. Tests use synthetic fixtures/mocks only and do not claim real model execution; the integration fixture is enabled once the parent worktree supplies the semantic and topic core modules.
