# Ordered public stage timeline

The chat now keeps each public phase summary immediately before its declared tool batch, followed by later summaries/tools and the checked final response. It does not expose private provider reasoning, invent historical explanations, or certify an agent-reported progress statement as scientific evidence.

## Data and order

`set_status` retains its existing short status and optional `detail`/`next`, with an optional `kind` (`plan`, `update`, `summary`). Its tool description and research-vault guidance request a concise public plan before a meaningful batch and an observed-results/gaps summary after the batch. No extra model call or automatic hidden-thought summarizer is introduced. Models may omit summaries; that omission is not filled with fabricated reasoning.

Successful status results are tied to their declared assistant tool-call positions. Multiple status messages within one provider response are retained rather than overwriting a single field. Parallel completion order does not reorder them. The same pure timeline projection is used during live execution, turn finalization and history reconstruction. Declared status calls that failed or never returned do not earn visible stage summaries. Late status results from another provider response cannot enter the current cycle.

Consecutive provider tool cycles are displayed as separate groups even when an older conversation has no public summaries. The current usage adapter still associates reported usage with exactly one output slice per provider response; splitting stages never creates extra charges. Repeated rendering reuses committed message/meta objects, avoiding a full history remount on every update.

Desktop and LAN message components render public summaries separately from final prose. Each tool group remains independently expandable. Long histories retain normal scroll behavior; only actual public status content is restored. Existing subagent/image output ordering remains the prior transcript convention; this work does not reinterpret arbitrary custom extension messages as stages.

## Verification

Twelve focused timeline cases cover live before-completion visibility, multiple summaries per batch, reordered/duplicate tool results, history parity, response boundaries without invented summaries, final prose placement, failed statuses, status-kind propagation, interruption, mixed text/tool order, stale completions and stable render references. An additional real PiBackend/SDK test with a scripted provider checks live events, history, exported JSONL, final publication and usage parity over five responses. No live paid model was invoked.

The isolated Electron smoke drives the actual MessageList and transcript reducer, checks stage/tool DOM order before and after completion, toggles tool details and checks narrow layouts. Its inputs are explicitly labelled fixture events; it does not touch user notes or approve Wiki changes.

Final workspace test run: backend 701 and desktop 368 passing, 1,069 total. This includes the previously uncommitted SDK usage UI and task-feedback fixes, which are committed together with the timeline. No tokenizer, pricing engine, new billing database, automatic model retry or raw hidden reasoning stream is added.
