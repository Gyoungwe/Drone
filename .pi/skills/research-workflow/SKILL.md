---
name: research-workflow
description: "Bounded personal research workflow for Percho: local knowledge first, Web fallback, evidence verification, and parent-session-only knowledge writes."
---

# Research Workflow

Use this skill for substantive research requests, literature discovery, source comparison, and evidence-backed technical investigation. This is not a second knowledge-base setup: initialization, read ordering and Wiki maintenance belong to `research-vault` and `/obsidian-setup`. Check that `research_loop` and the archive/verification tools are loaded before starting this project workflow; do not pretend unavailable tools exist.

1. Create a persistent run with `research_loop(action=start)` and preserve the exact research question.
2. In desktop application mode, first use the current bounded global navigation and project context, read the relevant Wiki with `research_read_knowledge`, then search evidence with `research_search_knowledge`. Search the user's Zotero library through `zotero-literature` / `zotero-cli` (optional MCP `zotero` only if enabled). Deposit interpreted `Library/Papers` notes before citing literature; Zotero hits are not Vault evidence receipts. Respect partial index coverage and pending Wiki reviews. In legacy project mode use the project Wiki and read-only Vault MCP. Record the exact local query with `research_loop(action=record_local)`; a self-reported query alone is not proof of a successful tool call.
3. Use Web search only when local evidence is absent, stale, incomplete, or conflicting. Record the query or explicit skip reason with `record_external`.
4. Inspect original sources. A Wiki page, search snippet, failed MCP call, or `browser_required` result is not verified evidence and not a successful retrieval.
5. Archive selected papers/manuals/software with traceable DOI, PMID, URL, version, commit, license, file hash, or equivalent provenance; verify the archive through `research_loop(action=verify_archive)`.
6. Bind explicit claim references, distinguishing Observed, Supported interpretation, Hypothesis, Unknown, Conflict, and Unverified; then finalize the evidence gate before summarization.
7. Subagents may gather bounded evidence, may query the paired Obsidian knowledge base read-only when `subagentMcpPolicy=read-local`, and may write only inside the active run directory. The parent session alone owns persistent Obsidian/Vault deposition through controlled write tools.
8. After a completed run, reusable workflow successes or failures may be compiled into WikiSkill. WikiSkill patterns are operational experience, never scientific authority.

Do not weaken evidence standards to make an answer, Wiki page, or Skill look successful. Never invent citations, downloads, tool calls, archive state, or validation scores.

For application-mode Wiki maintenance, first read current source notes and the target Wiki, then stage `research_propose_wiki_update`. The user reviews the exact change with `/obsidian-review`. A staged or user-approved synthesis is not independently verified scientific evidence. Never bypass this through the old Wiki builder, raw MCP, shell, or `research_deposit_knowledge(type=wiki)`. Source checks and final-answer validation remain separate from Wiki write approval.

## User-facing delivery

### Answer shape (the user is a researcher, not an auditor)

Write the final answer for a domain scientist who wants a decision, not a compliance record. Evidence rules above are unchanged; this section only governs presentation.

1. **Lead with the answer.** The first 3–5 lines state the recommendation and the one or two facts that drive it (e.g. “用 DESeq2，设计公式 `~ hive + caste`；因为你的数据是 3 蜂箱 × 5 类 × 3 重复的完全交叉设计，而现有脚本先减蜂箱效应再检验是错误路线”). No preamble such as “研究完成”.
2. **Then what the user must decide**, as a short numbered list with a default for each item (“建议：装 R + Bioconductor”). Put this section second, not last — it is the only part that blocks progress.
3. **Then the reasoning**, in the user's language, plain paragraphs or short bullets. Explain *why* a choice matters for their result before naming the function; give at most one code identifier per sentence. Tables only for numbers the user will act on (QC outliers, sample counts), not to list everything measured.
4. **Data facts and QC**: report what changes a decision (outlier samples, library-size range, confounded groups). Skip measurements that merely confirm the data is normal unless asked.
5. **Problems in the user's existing work**: state each as “what it does → why it misleads → what to do instead”, ordered by impact. Do not enumerate cosmetic issues.
6. **Collapse the audit trail.** Put run directories, archive hashes, `[[wiki links]]`, tool counts, failed download attempts and “not verified” bookkeeping in one final short section titled `依据与记录` (or `Sources & record`). A failed fetch is one clause (“Nygaard 2016 未能下载，未作为依据”), not a paragraph. Never put file hashes or run IDs in the body.
7. **Limitations are decision-relevant only.** One short paragraph: what the user should *not* conclude from this answer. Do not list every tool you did not run.
8. **Length**: a methods recommendation should fit on one screen (~600–900 Chinese characters / ~400–600 English words) before the `依据与记录` section. If the analysis genuinely needs more, offer the detail as a Show Me explainer or a saved run summary and link it rather than inlining.
9. **Tone**: second person, concrete, no hedging stacks. Say “不确定” once with the reason, not three synonyms. Avoid internal vocabulary (“宿主”“归档”“发布门禁”“证据回执”) in the body; if a host mechanism blocked something, say what the user can do (“任务面板点‘确认下一阶段预算’可继续”).

A useful self-check before `research_check_answer`: could the user act on the first screen alone? If not, restructure rather than add.

Load the relevant delivery sections of `research-vault` for a paper/software/manual task. “Download the manual” includes the version-specific CLI reference, arguments, input/output and runnable example explanations, not just the homepage or a bibliographic entry. Capture substantive paper methods/claims and software principles/usage in reusable source-grounded notes. A generated run summary is an operational record; its successful save is not scientific verification.

Use the loaded show-me skill after source reading for a focused explainer, linked in the normal final text answer. For software, distinguish documented performance from local measured tests (or explicitly “not tested”); for research, explain the main viewpoint, methods, evidence and limitations. Never substitute the UI progress status for delivery or treat file download as comprehension.

After `research_summarize_run` succeeds in application mode, the host automatically stages one shared topic Wiki candidate when the summary is substantial and at least one current-version non-Wiki evidence note was actually read this turn. The candidate is generated from the saved summary, stored outside the live Vault, and remains unverified until the user reviews it. Do not create a duplicate proposal unless the host reports that automatic staging was skipped or failed; if an existing topic requires a fresh read, read it and then propose the correction explicitly.


## Show Me in the knowledge base

After generating a source-grounded Show Me HTML/Markdown file under the configured results root, call `research_archive_explainer` with the active research run `metadata.topic_id` (reuse it across rounds), title, short summary, and 1–12 underlying evidence note paths that were actually read this turn. The host copies the visual artifact into `Attachments/Explainers/<topic-id>/`, maintains `Library/Explainers/<topic-id>.md` as the searchable latest/history pointer, and preserves human review text. Explainers are presentation-only: they may help a human navigate and understand a topic, but they are excluded from evidence receipts, automatic Wiki source selection, and scientific verification. Never cite an older explainer instead of the paper/software/manual sources it summarizes.

## Knowledge-service specialists

The desktop host may automatically dispatch `knowledge-navigator` for knowledge-oriented requests, and `knowledge-evidence-curator` for comparisons with multiple located sources. After a successful parent research summary it may invoke `knowledge-wiki-editor` and `knowledge-explainer`. These are bounded isolated model calls, not four agents for every chat message. The application has automatic/manual/off modes and a read-local permission ceiling; respect disabled modes and do not bypass them with generic subagents.

Each child receives only its current task, bounded selected notes and (for the explainer only) the actually loaded show-me skill. No parent transcript, general filesystem/shell tools, raw MCP writes, network-fetch capability, recursive delegation or approval tool is available. Parent handoffs are compact unverified summaries with current source ranges. They do not mint parent read/search receipts: read the originals needed for the final answer through native tools. A source record is not full-paper/manual comprehension.

Do not duplicate the host's post-summary Show Me or Wiki work in automatic mode. Use `research_delegate_knowledge` for explicit scoped tasks when appropriate; Wiki delegation requires a target and parent-read sources, and explainer delegation requires an existing research run and stable topic id. The child submits content, while the parent host stages a Wiki candidate or saves an explainer only after checking policy, source versions and path constraints. Actual Wiki approval remains exclusively human. Presentation artifacts remain outside the evidence layer.

No raw child transcript or model reasoning is returned to the parent. Longer Wiki/HTML content remains on the host and is surfaced through a candidate/artifact link; visible progress includes role, model, observed activity, token usage and failures. At most four role calls per user turn (one per role), two concurrent knowledge specialists, three total native children with lower per-project ceilings respected, 120-second per-call deadlines and no unbounded retries. New user turns and cancellation invalidate pending work. Failures or missing show-me must be stated, not reported as completed output.
