---
name: research-workflow
description: "Bounded personal research workflow for Drone: local knowledge first, Web fallback, evidence verification, and parent-session-only knowledge writes."
---

# Research Workflow

Use this skill for substantive research requests, literature discovery, source comparison, and evidence-backed technical investigation. This is not a second knowledge-base setup: initialization, read ordering and Wiki maintenance belong to `research-vault` and `/obsidian-setup`. Check that `research_loop` and the archive/verification tools are loaded before starting this project workflow; do not pretend unavailable tools exist.

1. Choose the task scope first: existing-literature consultation, discovery, deposition, planning or execution. Preserve the exact question. Use a persistent `research_loop(action=start)` when a tracked evidence run is needed; same-turn successful source reads may occur before or after start. Do not create execution/review milestones for a read-only consultation.
2. In desktop application mode, first use the current bounded global navigation and project context, read the relevant Wiki with `research_read_knowledge`, then search evidence with `research_search_knowledge`. Search the user's Zotero library through `zotero-literature` / `zotero-cli` (optional MCP `zotero` only if enabled). For newly acquired literature, deposit interpreted `Library/Papers` notes when writes are authorized; reuse existing notes without rewriting them for read-only tasks. Zotero hits are not Vault evidence receipts. Respect partial index coverage and pending Wiki reviews. In legacy project mode use the project Wiki and read-only Vault MCP. The host records successful local query/read receipts; do not manually repeat `record_local` to satisfy bookkeeping. A self-reported query alone is not proof of a successful tool call.
3. Use Web search only when local evidence is absent, stale, incomplete, or conflicting. The host records successful external lookup receipts. Read-only local reuse does not require a separate skip call; use `record_external` only when an explicit external-search decision needs recording.
4. Inspect original sources. A Wiki page, search snippet, failed MCP call, or `browser_required` result is not verified evidence and not a successful retrieval.
5. For newly acquired sources, archive authorized papers/manuals/software with traceable DOI/URL/version/license/hash. When the user wants a paper in Zotero, call `research_zotero_save` once per DOI (host-controlled: DOI dedup, native consent card unless the authorized plan lists the DOI as a `zotero_item` milestone, single write, DOI read-back), then deposit the `Library/Papers` note with the returned `zotero_key`. For read-only reuse, read the existing Library/Papers notes this turn, then call `research_verify_literature` for each DOI/key/path. The host matches the real read hash and current binding, rechecks identity, and records `sources_reused` without a new download or import. An identity check alone is not an original-source read. If a note is insufficient, state the limitation and seek bounded original-source evidence; do not fabricate reading.
6. After the bounded read/verification batch, call `research_loop(action=complete, claim_refs=[...])` once with explicit claim-to-paper/location/limitation references. The host closes the remaining stages serially. Do not manually walk inspect_sources/bind_claims/verify_archive/finalize or repeat retrieval merely to clear a warning. Reuse requires fresh current-turn receipts; changes to binding or content invalidate reuse. Plain research advice/read-only verification does not require task_plan or a human-review milestone; tasks with actual execution/writes still require the usual host consent.
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
6. **Collapse the audit trail, not the evidence links.** Keep exact Library/Papers citations beside the claims they support; do not replace them with a Wiki link or move all supporting citations away from the claims. Put run directories, archive hashes, `[[wiki links]]`, tool counts, failed download attempts and “not verified” bookkeeping in one final short section titled `依据与记录` (or `Sources & record`). A failed fetch is one clause (“Nygaard 2016 未能下载，未作为依据”), not a paragraph. Never put file hashes or run IDs in the body.
7. **Limitations are decision-relevant only.** One short paragraph: what the user should *not* conclude from this answer. Do not list every tool you did not run.
8. **Length**: a methods recommendation should fit on one screen (~600–900 Chinese characters / ~400–600 English words) before the `依据与记录` section. If the analysis genuinely needs more, offer the detail as a Show Me explainer or a saved run summary and link it rather than inlining.
9. **Tone**: second person, concrete, no hedging stacks. Say “不确定” once with the reason, not three synonyms. Avoid internal vocabulary (“宿主”“归档”“发布门禁”“证据回执”) in the body; if a host mechanism blocked something, say what the user can do (“既有文献的复用检查失败，暂未完成”；不要把程序错误归因为用户未确认或建议点击无关确认按钮).

10. **科研助手而不是执行清单**: When the user asks whether to continue or what to do next, begin with the scientific conclusion and evidence level. Give one recommended sequence and its rationale. Do not begin with “写入笔记”“绑定 claims”“生成 Wiki” or another storage operation; put those actions after the scientific answer under `依据与记录`, if they matter at all. Translate “已读/未读/未核验” into what the evidence can and cannot support, and state which primary evidence would change the conclusion.

A useful self-check before `research_check_answer`: could the user act on the first screen alone? If not, restructure rather than add.

### Interruption budget (ask once, then decide)

The user wants to be involved at most once per task. Treat every question to the user as expensive:

1. **Front-load decisions.** Before the first tool call that needs user input, list *every* choice you can already foresee for the whole task in one message (analysis engine, which samples to include, batch vs. block, output format, whether to install software). Each item carries a recommended default in one line. Do not ask them one at a time across turns.
2. **Mid-task: decide, don't ask.** If a new choice appears after the user has answered (or after they approved a permission with “本次任务全部允许”), take the most defensible default, continue, and record it. Only stop for genuinely irreversible or destructive actions the user did not foresee (deleting data, overwriting their own files, spending money).
3. **Report decisions made on their behalf** in the final answer under a short `我替你决定的` list: “按 X 处理了；如需改为 Y，回复一句即可”. This replaces mid-task questions — the user corrects after the fact instead of approving in advance.
4. **Never re-ask** something already answered in this session or recorded in the run; reuse the answer.
5. **Budget/stage checkpoints from the host** are not questions to relay verbatim. Finish the answer with what you already have, then tell the user in one sentence how to let the task continue.

Load the relevant delivery sections of `research-vault` for a paper/software/manual task. “Download the manual” includes the version-specific CLI reference, arguments, input/output and runnable example explanations, not just the homepage or a bibliographic entry. Capture substantive paper methods/claims and software principles/usage in reusable source-grounded notes. A generated run summary is an operational record; its successful save is not scientific verification.

When the user requests an explainer and writes are authorized, use the loaded show-me skill after source reading for a focused explainer, linked in the normal final text answer. Do not create presentation artifacts for plain read-only planning. For software, distinguish documented performance from local measured tests (or explicitly “not tested”); for research, explain the main viewpoint, methods, evidence and limitations. Never substitute the UI progress status for delivery or treat file download as comprehension.

After `research_summarize_run` succeeds in application mode, the host automatically stages one shared topic Wiki candidate when the summary is substantial and at least one current-version non-Wiki evidence note was actually read this turn. The candidate is generated from the saved summary, stored outside the live Vault, and remains unverified until the user reviews it. Do not create a duplicate proposal unless the host reports that automatic staging was skipped or failed; if an existing topic requires a fresh read, read it and then propose the correction explicitly.


## Show Me in the knowledge base

After generating a source-grounded Show Me HTML/Markdown file under the configured results root, call `research_archive_explainer` with the active research run `metadata.topic_id` (reuse it across rounds), title, short summary, and 1–12 underlying evidence note paths that were actually read this turn. The host copies the visual artifact into `Attachments/Explainers/<topic-id>/`, maintains `Library/Explainers/<topic-id>.md` as the searchable latest/history pointer, and preserves human review text. Explainers are presentation-only: they may help a human navigate and understand a topic, but they are excluded from evidence receipts, automatic Wiki source selection, and scientific verification. Never cite an older explainer instead of the paper/software/manual sources it summarizes.

## Knowledge-service specialists

The desktop host may automatically dispatch `knowledge-navigator` for knowledge-oriented requests, and `knowledge-evidence-curator` for comparisons with multiple located sources. After a successful parent research summary it may invoke `knowledge-wiki-editor` and `knowledge-explainer`. These are bounded isolated model calls, not four agents for every chat message. The application has automatic/manual/off modes and a read-local permission ceiling; respect disabled modes and do not bypass them with generic subagents.

Each child receives only its current task, bounded selected notes and (for the explainer only) the actually loaded show-me skill. No parent transcript, general filesystem/shell tools, raw MCP writes, network-fetch capability, recursive delegation or approval tool is available. Parent handoffs are compact unverified summaries with current source ranges. They do not mint parent read/search receipts: read the originals needed for the final answer through native tools. A source record is not full-paper/manual comprehension.

Do not duplicate the host's post-summary Show Me or Wiki work in automatic mode. Use `research_delegate_knowledge` for explicit scoped tasks when appropriate; Wiki delegation requires a target and parent-read sources, and explainer delegation requires an existing research run and stable topic id. The child submits content, while the parent host stages a Wiki candidate or saves an explainer only after checking policy, source versions and path constraints. Actual Wiki approval remains exclusively human. Presentation artifacts remain outside the evidence layer.

No raw child transcript or model reasoning is returned to the parent. Longer Wiki/HTML content remains on the host and is surfaced through a candidate/artifact link; visible progress includes role, model, observed activity, token usage and failures. At most four role calls per user turn (one per role), two concurrent knowledge specialists, three total native children with lower per-project ceilings respected, 120-second per-call deadlines and no unbounded retries. New user turns and cancellation invalidate pending work. Failures or missing show-me must be stated, not reported as completed output.


## Research design and evidence boundaries (required)

For read-only planning or reuse, do not create task plans, human-review milestones, explainers or child agents merely to satisfy workflow bookkeeping. Read existing source notes and verify identities in parallel where independent; a tracked run may start before or after those reads in the same turn. The host retains successful receipts. Complete once with explicit claim bindings; do not manually backfill local/external/inspection stages or re-import papers to clear a gate. A run writes operational metadata even if the literature/Vault task is read-only; do not claim absolutely no files were written.

Keep four dimensions separate: bibliographic identity, acquisition/attachments, actual reading scope, and claim support. DOI/hash checks establish identity/version, not scientific validation. This-turn note reuse is not this-turn HTML/PDF reading. State historical original-reading locations as historical, and cite the exact note beside the supported claim. A downloaded paper is not automatically read or evidence for a claim. Report inaccessible OA fulltext honestly; preserve metadata-only states and human notes.

Research plans must start from a testable question, not a software list. Identify sampling units, biological replicates, comparison groups, data/annotation quality, method assumptions, confounders, alternative explanations and the experiments needed for causal claims. Distinguish proposed, executed and QC-passed analyses. Mark sample counts, thresholds and parameters as source-backed, user-constrained or provisional; never invent a universal minimum.

Before final delivery, check:
- Ligands/receptors, DNA-binding TFs, cofactors and effectors are different categories. Wg/Dpp/Hh are not DNA-binding motif models. Motif hits are not occupancy or causality.
- A specific tool's protein-input requirement is not a universal requirement of all homology inference. Identify the relevant software/version.
- Species groups must use compatible levels or explicitly crossed factors: Neuroptera belong within holometabolous insects, not a mutually exclusive third group alongside hemi-/holometaboly.
- Single-species/tissue/stage results are evidence for the tested conditions; broader conservation remains a hypothesis. Orthology, expression correlation, perturbation and direct binding support different claims.
- Apparent gene absence/copy differences require checks for assembly/annotation/isoform artifacts; comparative tests must consider phylogenetic non-independence. Cross-species expression requires comparable tissues/stages.
- No hits, non-significance and no phenotype do not prove absence/no function. A literature-gap claim must state search scope/date, or be qualified as not established.

These are reasoning checks, not a claim that the host has scientifically validated the answer. If a method layer lacks appropriate sources, mark it provisional, name the missing original methods/version documentation, and offer a bounded next step with a concrete deliverable (for example, “可继续补检 dN/dS 与 CAFE 的方法原文和当前版本手册，整理适用前提、输入、参数依据与局限”). Use external read-only retrieval when it is already within the requested scope; otherwise include this option with the other end-of-answer decisions. Keep unsourced parameters provisional and preserve explicit local-only or no-write constraints.


## Structured claims and interrupted-operation recovery

Prefer `research_loop(action=complete, claim_bindings=[...])`: each binding includes claim, relationship (direct/indirect/hypothesis/unsupported), organism and method where applicable, limitations, and source entries with path/start_line/end_line/verbatim quote. Use the actually read note lines, not guessed original PDF lines. `original_location` is a historical locator only; it does not claim this-turn original reading. The host checks identity, current hash, read range and quote; support relationship remains model-asserted/unreviewed. Legacy claim_refs carry an unstructured warning, not equivalent verification.

When calling `research_summarize_run`, carry the evidence-backed observations into its optional `claims` array so topic memory can compare this run with prior knowledge. For each substantive claim provide `claim`, `subject`, `predicate`, `sourcePath`, `sourceHash` and `relation` (`observation`, `interpretation`, or `hypothesis`), plus `value`, `organism`, `tissue`, `stage`, `method`, and `location` when they affect interpretation. Use the exact Vault note hash and path returned by a successful read. Keep different conditions as separate claims; do not turn a summary sentence, search snippet, or model inference without a read receipt into a claim. If a run has no substantive evidence-backed claims, omit `claims` rather than filling it with placeholders.

If deposition fails or its response is uncertain, call `research_reconcile_literature` with run_dir/DOI/key/note path BEFORE another write. Its persistent per-DOI log reports destinations separately. Reuse verified destinations, preserve human notes, and only complete a missing side with the user's existing write authorization and controlled tools. Unavailable is not absent; identity conflicts require review. Reconciliation itself makes zero library writes; it is not automatic import permission or scientific validation.

The UI recovery action continues the existing unfinished answer with a host checkpoint and read-only tools. It does not send the original user prompt again or automatically retry writes. If the process restarted, old receipts may need fresh verification; do not relabel historical evidence as current. Report a remaining execution/deposition failure explicitly instead of pretending read-only answer recovery completed it.
