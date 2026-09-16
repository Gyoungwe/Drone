# One task authorization

New workbench tasks use one consent card after bounded read-only discovery. The agent supplies the original goal, a plain-language scope summary, existing write directories and immutable acceptance milestones with `task_plan`. The single **确认一次，执行到交付** action approves those acceptance criteria and the task execution budget and starts the task without a second Continue click.

## What is authorized

- Normal stage transitions and at most 3 host-triggered recovery turns within the unchanged 192-call lifetime ceiling (48 calls per stage).
- Ordinary write/edit operations under the displayed canonical directories and their children. Output readback may use these explicitly approved roots even when data lives outside the session cwd; CURRENT read permissions and canonical directory identity are still checked. Missing output subdirectories are allowed; the approved project directory must already exist.
- Existing command permissions, not a new arbitrary-shell/fullAccess privilege. The plan must state planned installations and preserve previous refusals.

If a command confirmation still appears during an authorized task, the approval card offers **本次任务全部允许 / Allow all for this task** (`allowRun`, shortcut `T`): it auto-approves every remaining confirm in the current agent run, drains the queue, and expires at `agent_end`. It is not persisted, is not remembered by pattern, and never overrides `deny` rules. Together the two mechanisms give the user at most one authorization card plus at most one command prompt per task.

## What is not authorized

Explicit deny rules, pattern-specific asks, sensitive files (credentials, permission/trust/model configuration, private keys, VCS internals), canonical path/symlink escape, hard-linked write targets, new risks or unrelated scope, unreviewed Wiki changes, genuine manual review and uncertain side effects retain their gates. Task consent is not scientific certification. Confirmation cannot increase the total call ceiling or reset failed-effect deduplication.

Old records do not silently receive consent. Consent is attached to the immutable task ID, goal, binding, scope summary, directory list and acceptance contract. It does not transfer to another task/session/branch or a changed contract. Restoring a session does not start it automatically. Cancellation, shutdown or a new user input invalidates a queued handoff.

## Automatic progress and recovery

Only successful results of host-allowed, distinct non-control calls count as observed progress. Status/todo spam, failed checks and fabricated result events do not. Observation is not scientific verification. Automatic stages require new observed progress; recovery is limited, refuses unresolved side effects/user actions, and never replays a write blindly.

A recoverable blocked publication can start a hidden **host** continuation through the SDK. It is not forged as a user message. SDK custom-message turns bypass `before_agent_start`, so only a host-minted continuation nonce lets the knowledge message-start hook refresh current-turn navigation, read budgets and publication state. Evidence must be read/validated again where required; private draft protections and specialist lifetime budgets remain unchanged.

Hard limits, missing credentials, absent necessary user data and unrecoverable errors are reported with actual outputs and the specific remaining blocker rather than repeatedly requesting routine stage approval. Ordinary final delivery must explain outcome, result entry points, validation limits and one next action when needed.

## Code map

- `.pi/lib/tasks/consent.mjs`: contract hash and canonical directory proposals.
- `.pi/lib/tasks/workbench.mjs`: revision-checked consent, bounded progress and continuation reservations.
- `.pi/lib/tasks/register.mjs`: authorization card, cancellable SDK handoff and permission-adapter bridge.
- `backend/src/permissions/task-consent.ts`: canonical target checks for scoped ordinary writes; called only after existing deny evaluation.
- `backend/src/permissions/gate.ts`: `allowRun` answer (run-scoped blanket approval for the remaining confirms; cleared on `agent_end` by `PiBackend.emitEvent`).
- `.pi/skills/research-workflow/SKILL.md` § Interruption budget: front-load all user decisions into one message; decide mid-task with defaults and report them under 我替你决定的.
- `desktop/.../TaskWorkbenchCard.tsx` and shared task types: one localized approval action; no recurring stage-budget control for new tasks.

This is source-level behavior. Rebuild/restart the desktop app to load changed bundled code/resources. No old conversation, research artifact, credential store or installed application is rewritten as part of this implementation.
