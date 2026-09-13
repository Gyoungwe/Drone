# Hybrid Retrieval

Semantic retrieval is opt-in. With no `semantic.json`, no embedding request is made and FTS remains the complete default retrieval path.

## Integration API

`KnowledgeService` provides `getSemanticSettings()`, `saveSemanticSettings(input, bindingRevision, settingsRevision)`, `testSemanticProvider(input, bindingRevision)`, `semanticStatus()`, and `rebuildSemanticIndex({limit, project, signal})`. Save and test reject a stale binding revision. Settings are atomically stored at `PERCHO_KNOWLEDGE_DIR/<vaultId>/semantic.json`; they contain only a credential environment-variable name, never a credential value.

Supported adapters are `ollama` and `openai-compatible`. Ollama sends `POST /api/embed` with `{model,input:[texts],truncate:false}`. The compatible adapter sends `POST /v1/embeddings` with `{model,input,encoding_format:"float"}`. Model names are sent unchanged. The exact provider contracts are documented by [Ollama](https://docs.ollama.com/api/embed) and [OpenAI-compatible embeddings](https://developers.openai.com/api/reference/resources/embeddings/methods/create).

Only loopback HTTP works without remote consent. A remote provider must use HTTPS, set `remoteConsent: true`, and name a valid credential environment variable. URLs with credentials, query strings, fragments, redirects, or non-HTTP(S) schemes are rejected. Responses, batches, timeouts, vectors, dimensions, and norms are bounded and validated. Production semantic candidates also use a configurable cosine floor (`minSimilarity`, default `0.45`). The floor is deliberately conservative because FTS remains available; it can be tuned per embedding model after validation and does not change the vector fingerprint or require re-embedding.

## Index and Search

The existing worker-owned SQLite database has additive `semantic_chunks` storage keyed by path, chunk index, content hash, provider/model fingerprint, and source signature. Rebuild is bounded incremental work; search never triggers a Vault-wide embedding pass. Changed/deleted notes invalidate their vectors. A provider/model/base-URL switch uses a new fingerprint, so incompatible vectors cannot be queried.

Lexical and semantic candidates run independently, then are deduplicated by path and fused with reciprocal-rank fusion. Candidate paths are hydrated from current source files through the normal ACL, project scope, symlink, and hash checks. Search hits do not grant evidence receipts; callers must read source content through the existing API. Provider timeout/unavailability/invalid response yields FTS results plus `retrievalMetrics.fallbackReason`, never a false successful empty result.

Every regular search includes `retrievalMetrics`: mode, lexical/semantic/merged candidate counts, bounded query, elapsed milliseconds, fallback reason, and index status. Existing linked-Wiki-first, current-read evidence, and publication gates are unchanged.

## Benchmark

`node scripts/benchmark-semantic.mjs` creates a disposable Vault and a deterministic local fake HTTP embedding server, then runs the production SQLite FTS baseline, production semantic adapter/index/candidate path, and production hybrid fusion for labelled synonym, Chinese-English, no-answer, and distractor cases. Its output is only a fixture regression signal and makes no general accuracy claim.

`node scripts/benchmark-semantic.mjs --live-local` is a separate optional measurement against a local provider. It requires `PERCHO_BENCHMARK_EMBED_BASE_URL` and `PERCHO_BENCHMARK_EMBED_MODEL`; no credentials are read by the script. Live output is not deterministic and must not be compared as an accuracy claim without a documented evaluation protocol.
