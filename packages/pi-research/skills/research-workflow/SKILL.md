---
name: research-workflow
description: "Evidence-gated local source retrieval, reading, deposition and citation for native Pi."
alwaysWith: research
---

# Research workflow

Use `research_search_sources` to discover bounded local source records, then
call `research_read_source` for each source that supports the question. Read
at least two distinct sources before `research_answer_sources`. Every answer
must retain the returned source URI, path and SHA-256 read receipt. Use
`research_deposit_research_note` only for a candidate, source-linked note; it
does not prove scientific verification. If a connector is unavailable, report
that limitation rather than inventing remote results.
