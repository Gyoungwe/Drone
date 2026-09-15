# Knowledge answer and prompt lifecycle contract

## Prompt intake

The backend prompt interface returns a receipt (`agent`, `queued`, or `command`).
A receipt acknowledges routing/preflight; it is not an authoritative running-state snapshot.
SDK `agent_start` / `agent_settled` events own running state in desktop and LAN clients.
A UI-only extension command must not fabricate a model turn, tokens or completion events.
Deferred setup handoffs are real SDK turns and must not be cleared by the command's receipt.
Late acknowledgements and rejected queue submissions must not resurrect a settled run.

## Publication

Host materialization may perform a real current-turn search and bounded source reads, then attach citations.
This is provenance checking, not scientific verification; `scientificallyVerified` remains false.
The strict validator still rejects unread/changed sources, changed bindings/navigation, partial coverage and forged proofs.
Only coverage/revision races may trigger bounded search refresh; this does not waive validation.
A new user question gets a new ticket and proof, including queued questions within one SDK run.
Zero hits are labeled only after complete coverage. Generated outputs are deliverables, not evidence.
Drafts and private model protocol blocks stay out of public events, polling, history and exports.
Signed tool protocol is retained only for the live provider context. HTML-export tests decode its session-data payload.
Provider failures retain their error card and are not replaced by knowledge-gate notices.

## Confirmation and connection probes

Compact Ask dialogs require confirmation and cancellation choices without custom-answer options.
Normal questionnaires keep free-text input. Preview-bearing questions retain the full form.
Provider probes have a 15-second deadline, pass cancellation to the SDK and disable retries.
An aborted or error result is a failure; timer resources are cleared after completion.

Design review used Matt Pocock's `improve-codebase-architecture` and `codebase-design`: keep routing knowledge at the backend seam and test callers through the same interface."}