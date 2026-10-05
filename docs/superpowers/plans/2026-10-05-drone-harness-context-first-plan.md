# Drone Harness Context Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded, durable context contract to Drone so every model turn receives stable work guidance plus a compacted-session checkpoint derived from existing task, todo, subagent, and status records.

**Architecture:** Keep the current context-evaporation and task/evidence semantics. Add pure, SDK-free harness contracts in `@drone/shared`, then attach one session-engine extension that appends the stable harness contract to `before_agent_start` and injects a bounded checkpoint through `context` after session start or compaction. The extension reads existing branch entries and never copies full transcript/tool output into the model context.

**Tech Stack:** TypeScript, Vitest, `@earendil-works/pi-coding-agent` inline extensions, `@drone/shared` task/todo decoders, existing `SessionTraces` custom records.

**Spec:** `docs/superpowers/specs/2026-10-05-drone-context-agent-harness-design.md`

## Global Constraints

- Keep Pi SDK runtime imports inside `packages/backend/src/session-engine/**`; shared contracts must remain SDK-free.
- Treat task/evidence/topic memory as the source of truth; the harness checkpoint is a bounded model-facing projection.
- Never include private reasoning, secrets, full transcript copies, or unbounded tool output in the checkpoint.
- Preserve existing context evaporation, permission gates, task authorization, evidence receipts, and subagent behavior.
- Use custom message type `drone-harness-checkpoint-v1` with `display: false`; it is model context, not a user-facing UI card.
- Keep the checkpoint under 8,000 serialized characters and each source item under 1,200 characters.
- Hook failures must fail open: log and preserve the existing SDK message path.
- Run focused tests first, then `npm run typecheck`, `npm run test:unit`, and `npm run check:arch`.

### Task 1: Add SDK-free harness contracts and renderers

**Files:**
- Create: `packages/shared/src/harness.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/src/harness.test.ts`

**Interfaces:**
- `HarnessPosture`: `{ effort: "normal" | "ultra"; delegation: "off" | "light" | "standard" | "high"; autonomy: "interactive" | "balanced" | "autonomous"; mode?: "plan" | "execute" }`.
- `HarnessCheckpoint`: `{ version: 1; epoch: number; objective: string; deliverables: string[]; findings: string[]; workState: string; nextMove: string; relevantFiles: string[] }`.
- `HARNESS_CHECKPOINT_CUSTOM_TYPE`: literal `"drone-harness-checkpoint-v1"`.
- `HARNESS_CONTRACT`: stable text stating inspect/verify/preserve/deliver/report rules and that private reasoning must not be exposed.
- `renderHarnessPosture(posture): string`: bounded per-turn posture text.
- `renderHarnessCheckpoint(checkpoint): string`: deterministic Markdown/XML-safe projection with section order `Objective`, `Deliverables`, `Findings`, `Work state`, `Next move`, `Relevant files`.
- `checkpointFingerprint(checkpoint): string`: stable 64-character identity fingerprint over canonical JSON; it is used only for change detection and trace correlation, not as an authentication or evidence hash.

- [ ] **Step 1: Write failing pure contract tests**

Add tests for:

```ts
it("renders the stable contract without hidden reasoning instructions", () => {

	 expect(HARNESS_CONTRACT).toContain("Inspect before assuming");
	 expect(HARNESS_CONTRACT).toContain("Report evidence and limitations");
	 expect(HARNESS_CONTRACT).not.toContain("chain-of-thought");
});

it("renders a deterministic bounded checkpoint", () => {
	 const checkpoint = {
		 version: 1 as const,
		 epoch: 2,
		 objective: "Analyze the repository",
		 deliverables: ["architecture report"],
		 findings: ["Task is running"],
		 workState: "running",
		 nextMove: "Read the session engine",
		 relevantFiles: ["packages/backend/src/session-engine/extensions.ts"],
	 };
	 expect(renderHarnessCheckpoint(checkpoint)).toContain("Objective");
	 expect(renderHarnessCheckpoint(checkpoint).length).toBeLessThanOrEqual(8000);
	 expect(checkpointFingerprint(checkpoint)).toHaveLength(64);
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `npx vitest run packages/shared/src/harness.test.ts`

Expected: FAIL because the harness module and renderers do not exist.

- [ ] **Step 3: Implement the pure contract**

Define the exported types and constants. Normalize whitespace, cap each list item at 1,200 characters, cap each list at 8 items, and cap the final rendered checkpoint at 8,000 characters by dropping oldest findings before truncating required sections. Escape `<` and `>` in user-derived content before placing it inside the checkpoint block.

Use a deterministic canonical object serializer for the fingerprint; omit `undefined` values and sort object keys so equal checkpoints hash identically. Keep the implementation SDK-free; the identity fingerprint must not be presented as a security or evidence digest.

- [ ] **Step 4: Export and run the focused tests**

Export `./harness` from `packages/shared/src/index.ts`, then run `npx vitest run packages/shared/src/harness.test.ts`.

Expected: PASS with deterministic output, bounded text, and a 64-character fingerprint.

- [ ] **Step 5: Commit the shared contract**

```sh
git add packages/shared/src/harness.ts packages/shared/src/harness.test.ts packages/shared/src/index.ts
git commit -m "feat: add shared harness context contract"
```

### Task 2: Build the session-engine checkpoint adapter

**Files:**
- Create: `packages/backend/src/session-engine/harness/context.ts`
- Create: `packages/backend/test/harness-context.test.ts`

**Interfaces:**
- `HarnessContextExtensionOptions`: `{ report?: (sessionId: string, checkpoint: HarnessCheckpoint) => void; getPosture?: (ctx: ExtensionContext) => HarnessPosture }`.
- `makeHarnessContextExtension(options?: HarnessContextExtensionOptions): InlineExtension`.
- Internal `checkpointFromBranch(objective, epoch, branch): HarnessCheckpoint` must accept only `unknown[]`/narrowed branch records and use shared decoders for task views/todos.

- [ ] **Step 1: Write the failing adapter tests**

Create a fake inline extension host that captures handlers and supplies a branch containing:

```ts
{
	 type: "message",
	 message: {
		 role: "custom",
		 customType: "drone-task-status",
		 content: "当前任务：读取 session-engine",
		 details: { taskView: { version: 2, revision: 1, activeTaskId: "t1", selectionRequired: false, tasks: [/* valid bounded task */], limits: { stageCalls: 48, totalCalls: 192 } } }
	 }
}
```

Assert that `before_agent_start` appends `HARNESS_CONTRACT` and posture to `systemPrompt`, `session_compact` increments the epoch, and the next `context` call appends exactly one `drone-harness-checkpoint-v1` message containing the objective, active task state, and bounded next move.

Also assert that a second `context` call with no state change returns `undefined`, that a changed objective causes one new checkpoint, and that a malformed branch entry is ignored without throwing.

- [ ] **Step 2: Run the focused adapter test and confirm it fails**

Run: `npx vitest run packages/backend/test/harness-context.test.ts`

Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement branch projection**

In `checkpointFromBranch`:

1. Read the latest active `TaskView` with `decodeTaskView`; use the active task goal/state, unfinished milestone titles, accepted artifact paths, and `remainingSummary` as deliverables/work state/next move.
2. Read the latest `todo-reminder` custom message and include its bounded text in findings.
3. Read the latest `drone-task-status` and `drone-subagent-result` custom messages and include bounded observable summaries in findings.
4. Collect relevant paths only from task write roots, milestone acceptance paths, and task artifacts; discard absolute paths outside the task view and deduplicate.
5. Fall back to the current objective, `workState: "in_progress"`, and `nextMove: "Continue the current request and verify the next observable result."` when no task state exists.

Do not copy `drone-task-context`, raw tool results, assistant reasoning, or arbitrary custom entries.

- [ ] **Step 4: Implement lifecycle and context hooks**

The extension must:

- reset `epoch`, `needsCheckpoint`, `lastFingerprint`, and objective on `session_start`;
- set the current objective from non-empty `before_agent_start` prompt text;
- append `${event.systemPrompt}\n\n${HARNESS_CONTRACT}\n\n${renderHarnessPosture(...)}` from `before_agent_start`;
- set `needsCheckpoint = true` and increment `epoch` on `session_compact`;
- on `context`, build the checkpoint from `ctx.sessionManager.getBranch()`, compare its fingerprint, and append one custom message only when it is needed or changed;
- catch/log every hook failure and return `undefined`/the original prompt so existing behavior survives adapter failure;
- call `report` after a checkpoint is accepted, with no UI event emission.

The custom message must be:

```ts
{
	role: "custom",
	customType: HARNESS_CHECKPOINT_CUSTOM_TYPE,
	display: false,
	content: renderHarnessCheckpoint(checkpoint),
	details: { version: 1, epoch: checkpoint.epoch, fingerprint: checkpointFingerprint(checkpoint) },
	timestamp: Date.now(),
}
```

- [ ] **Step 5: Run the focused adapter tests**

Run: `npx vitest run packages/backend/test/harness-context.test.ts`

Expected: PASS, including idempotent context injection and fail-open malformed input behavior.

- [ ] **Step 6: Commit the adapter**

```sh
git add packages/backend/src/session-engine/harness/context.ts packages/backend/test/harness-context.test.ts
git commit -m "feat: add session harness checkpoint adapter"
```

### Task 3: Register the adapter and trace checkpoint transitions

**Files:**
- Modify: `packages/backend/src/session-engine/extensions.ts`
- Modify: `packages/backend/src/session-service.ts`
- Modify: `packages/backend/src/session-engine/harness/context.ts`
- Modify: `packages/backend/test/harness-context.test.ts`

**Interfaces:**
- Extend `SessionExtensionDependencies` with `harnessContext?: boolean` and reuse `traces` for the optional report callback.
- `buildSessionExtensionFactories` registers `makeHarnessContextExtension` once, before context evaporation and todo reminder so checkpoint projection happens before lower-level wire pruning.

- [ ] **Step 1: Add a registration test**

Assert that `buildSessionExtensionFactories` includes one extension named `harness-context` by default and omits it when `harnessContext: false`. Keep all existing factory names and ordering intact.

- [ ] **Step 2: Run the registration test and confirm it fails**

Run: `npx vitest run packages/backend/test/harness-context.test.ts -t "registers"`

Expected: FAIL because the dependency flag and factory registration do not exist.

- [ ] **Step 3: Wire the factory**

Add the dependency flag with default-on behavior, pass `deps.traces.recordCustom(sessionId, "harness_checkpoint", checkpoint)` as the report callback, and add the factory to `buildSessionExtensionFactories`. Do not add IPC, renderer state, or a new user-facing card in this phase.

- [ ] **Step 4: Run focused tests and typecheck the affected packages**

Run:

```sh
npx vitest run packages/backend/test/harness-context.test.ts
npm run typecheck -w @drone/shared
npm run typecheck -w @drone/backend
```

Expected: PASS with no new architecture import violations.

- [ ] **Step 5: Commit the registration**

```sh
git add packages/backend/src/session-engine/extensions.ts packages/backend/src/session-service.ts packages/backend/src/session-engine/harness/context.ts packages/backend/test/harness-context.test.ts
git commit -m "feat: register harness checkpoint extension"
```

### Task 4: Add architecture documentation and run the repository checks

**Files:**
- Modify: `docs/INDEX.md`
- Modify: `docs/superpowers/specs/2026-10-05-drone-context-agent-harness-design.md`
- Test: repository validation commands below

- [ ] **Step 1: Document the implemented seam**

Add the new `session-engine/harness/context.ts` entry to `docs/INDEX.md` and state that the checkpoint is a bounded model-facing projection, not a new evidence source. Update the design spec status from “design only” to “first context phase implemented” while retaining the future redirect/deliverables/workers units as follow-up scope.

- [ ] **Step 2: Run focused and repository checks**

Run:

```sh
npx vitest run packages/shared/src/harness.test.ts packages/backend/test/harness-context.test.ts
npm run typecheck
npm run test:unit
npm run check:arch
git diff --check
```

Expected: all focused tests, typecheck, unit tests, architecture checks, and whitespace checks pass. If a full workspace test exposes an unrelated existing failure, record the exact failing test and keep the new focused tests green.

- [ ] **Step 3: Commit documentation and verification**

```sh
git add docs/INDEX.md docs/superpowers/specs/2026-10-05-drone-context-agent-harness-design.md
git commit -m "docs: document harness checkpoint phase"
```

## Plan Self-Review

- Spec coverage: stable contract, per-turn posture, bounded checkpoint, compaction recovery, fail-open hooks, trace recording, tests, architecture constraints, and documentation are covered by Tasks 1–4.
- Scope: this phase intentionally excludes model-family prompt routing, recall search, deliverables retry, redirect guards, and worker attempt reconciliation; those remain separate follow-up plans.
- Data boundary: the checkpoint consumes existing task/todo/status/subagent projections and never becomes evidence or authorization.
- Type consistency: shared `HarnessCheckpoint` and `HarnessPosture` are defined in Task 1 and consumed by the session-engine adapter in Task 2; registration only passes the existing trace callback.
- Placeholder scan: no unresolved TODO/TBD or unspecified test commands remain in the plan.
