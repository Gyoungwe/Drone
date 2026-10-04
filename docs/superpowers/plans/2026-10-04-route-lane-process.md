# 路由位置与泳道过程视图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用共享、可重放的过程归约器把正式客户端「过程」页替换为六条泳道位置视图，并让草图、文档和回归测试表达同一套八步门控语义。

**Architecture:** 从现有 `UIMessage`、`TurnRoute`、`TaskView` 和公开工具结果提取有序 `ProcessEvent`，在 `@drone/shared` 中纯归约为 `ProcessLaneState`。桌面 renderer 用该状态渲染六泳道及节点内公开明细；独立草图使用同构八步夹具，不能复制领域逻辑或产生第二本账。

**Tech Stack:** TypeScript 5.9、Vitest 3、React 19、Electron renderer、现有 CSS 变量和 i18n 字典、独立 HTML 草图、Node 状态/布局核对。

**Spec:** `docs/superpowers/specs/2026-10-04-route-lane-process-design.md`

## Global Constraints

- 正式客户端「过程」页以六泳道为主视图，节点内保留工具、来源、模型和诊断明细。
- 泳道状态是 transcript 的纯展示投影，不新增任务、研究、授权、引用或持久化账本。
- 只消费可观察字段；不读取思维文本，不从 Markdown 链接推断已读，不编造检索、主张或引用数量。
- 六条泳道固定为入口、门、执行、证据、沉淀、回答；没有回执的泳道保留灰色占位。
- 第 6 步只表示规则演示和授权门打开；第 7 步才表示哈希变化并创建 `reconcile-before-retry` 宿主门；第 8 步不从宿主门连回正在做。
- 沉淀与本轮引用没有连线；引用只接受本轮实际读取且哈希一致的路径，`scientificallyVerified` 保持 `false`。
- 新 UI 文案同时更新 `packages/desktop/src/renderer/src/i18n/zh.ts` 与 `en.ts`。
- 不编辑、重命名、移动或删除 `sources/`；不提交 Vault 正文、会话正文或 `results/`。
- `/Users/gaoyangwei/test.html`、`outputs/route-lane-sketch.md` 和 `outputs/drone-base-data.md` 位于 Drone checkout 外，修改时使用其绝对路径并在最后检查 `git status`，不要把它们误加入 Drone 的提交。

## File Map

- Create: `packages/shared/src/process-lanes.ts` — `ProcessEvent`、`ProcessLaneState`、事件提取和纯归约器。
- Create: `packages/shared/src/process-lanes.test.ts` — 事件提取、六泳道状态和八步关键断言。
- Modify: `packages/shared/src/index.ts` — 导出过程归约器和类型。
- Create: `packages/desktop/src/renderer/src/components/panel/ProcessLaneView.tsx` — 六泳道 renderer、节点内明细和门卡定位动作。
- Create: `packages/desktop/src/renderer/src/components/panel/ProcessLaneView.test.tsx` — 静态渲染、空泳道、门状态和规则标记测试。
- Modify: `packages/desktop/src/renderer/src/components/panel/ProcessPane.tsx` — 从倒序轮次卡片切换为泳道视图，保留现有 timing/usage/focus 数据。
- Modify: `packages/desktop/src/renderer/src/styles/shell.css` — 泳道、节点、边、门状态和窄栏布局样式。
- Modify: `packages/desktop/src/renderer/src/i18n/zh.ts` — 泳道标题、空状态、门状态、规则演示和可访问名称。
- Modify: `packages/desktop/src/renderer/src/i18n/en.ts` — 与中文键完全对应的英文文案。
- Create: `scripts/check-route-lane-sketch.mjs` — 用 Node VM 核对草图嵌入的共享状态与八步，不绕过浏览器访问检查。
- Modify: `/Users/gaoyangwei/test.html` — 同构八步事件夹具、内联执行回执、两拍门状态、规则标记和测量输出。
- Modify: `/Users/gaoyangwei/Documents/Codex/2026-09-30/git-checkout-b-docs-architecture-v2/outputs/route-lane-sketch.md` — 更新正式客户端边界、事件映射、八步两拍规则和验收表。
- Modify: `/Users/gaoyangwei/Documents/Codex/2026-09-30/git-checkout-b-docs-architecture-v2/outputs/drone-base-data.md` — 仅更新已实现的过程页职责和共享导出清单。
- Modify: `docs/INDEX.md` — 在 shared 导航中登记新增 `process-lanes.ts` 职责。

---

### Task 1: 建立共享过程事件与六泳道归约器

**Files:**
- Create: `packages/shared/src/process-lanes.ts`
- Create: `packages/shared/src/process-lanes.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `UIMessage`, `UIToolCall`, `TurnRoute`, `TaskView`、公开工具输出文本。
- Produces: `ProcessLaneId`, `ProcessEvent`, `ProcessNode`, `ProcessEdge`, `ProcessLaneState`, `deriveProcessEvents(messages)`, `deriveProcessLaneState(messages)`。

- [ ] **Step 1: Write the failing contract tests**

在 `packages/shared/src/process-lanes.test.ts` 建立最小 fixture helper，覆盖用户消息、带 `route` 的 assistant、带 `taskView` 的 assistant 和公开工具结果。测试先锁定以下接口和结果：

```ts
const events = deriveProcessEvents(messages);
expect(events.map((event) => event.type)).toEqual([
  "user-input",
  "turn-route",
  "tool-receipt",
  "task-view",
]);

const state = deriveProcessLaneState(messages);
expect(state.lanes.map((lane) => lane.id)).toEqual([
  "entry", "gate", "execution", "evidence", "deposit", "answer",
]);
expect(state.lanes.find((lane) => lane.id === "evidence")?.empty).toBe("这一轮没查文献");
```

追加三个行为测试：`继续。后面还有正文` 的新 route 清空前一轮节点；`进度如何` 保留前一轮 `pydeseq2` 节点且不新增边；没有 research 回执时沉淀和回答泳道只有灰色占位。

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm run test -w @drone/shared -- src/process-lanes.test.ts`

Expected: FAIL because `process-lanes.ts` and its exported functions do not exist.

- [ ] **Step 3: Implement the event types and event extraction**

在 `process-lanes.ts` 定义六条泳道、节点状态和公开事件。事件提取按 `messages` 顺序递增 `seq`：

```ts
export type ProcessEvent =
  | { type: "user-input"; seq: number; id: string; text: string }
  | { type: "turn-route"; seq: number; id: string; route: TurnRoute }
  | {
      type: "tool-receipt";
      seq: number;
      id: string;
      name: string;
      state: "running" | "done" | "error";
      blockedReason?: string;
      output?: string;
    }
  | { type: "task-view"; seq: number; id: string; view: TaskView }
  | { type: "research-stage"; seq: number; id: string; stage: string; details: Record<string, unknown> }
  | { type: "answer-check"; seq: number; id: string; ok: boolean; citations: string[]; reason?: string };
```

从 user 消息提取 `user-input`；从 assistant 的 `route` 提取 `turn-route`；从每个公开 `tools` 条目提取 `tool-receipt`。仅解析现有公开 JSON 输出中的 `research_loop` 阶段和 `research_check_answer` 结果，不把链接、正文或思维字段转换成证据。assistant 的 `taskView` 产生 `task-view`。对相同 `id` 的流式工具只保留最后状态，保证实时更新不会重复一张回执。

- [ ] **Step 4: Implement the pure reducer**

实现 `initialProcessLaneState()`、`reduceProcessEvent(state, event)` 和 `deriveProcessLaneState(messages)`。归约规则必须落成可测试的纯数据：

```ts
export function deriveProcessLaneState(messages: readonly UIMessage[]): ProcessLaneState {
  return deriveProcessEvents(messages).reduce(reduceProcessEvent, initialProcessLaneState());
}
```

`turn-route` 在 `new-topic` 且不是状态提问时清空当前轮节点并重新请求入口、节点选择和正在做；`status` 或 `keptCheckpoint` 只更新入口和正在做。工具与命中进入执行节点的 `receipts`。工具被 `task-authorization-required` 拒绝时请求任务门；批准后的 `planApproved` 只把门设为 `open`。TaskView 的 `blocked` 或 `reason` 请求宿主门并保留任务门。研究阶段只在真实阶段名称出现时请求证据、沉淀或回答节点。沉淀与引用不添加边；状态提问不添加边。

- [ ] **Step 5: Export and run the focused tests**

从 `packages/shared/src/index.ts` 导出新模块，运行：

```sh
npm run test -w @drone/shared -- src/process-lanes.test.ts
npm run typecheck -w @drone/shared
```

Expected: focused tests and shared typecheck pass, and `git diff --check` reports no whitespace errors.

- [ ] **Step 6: Commit the shared projection**

```sh
git add packages/shared/src/process-lanes.ts packages/shared/src/process-lanes.test.ts packages/shared/src/index.ts
git commit -m "feat: add replayable process lane projection"
```

### Task 2: Implement the six-lane renderer and replace the process pane

**Files:**
- Create: `packages/desktop/src/renderer/src/components/panel/ProcessLaneView.tsx`
- Create: `packages/desktop/src/renderer/src/components/panel/ProcessLaneView.test.tsx`
- Modify: `packages/desktop/src/renderer/src/components/panel/ProcessPane.tsx`
- Modify: `packages/desktop/src/renderer/src/styles/shell.css`

**Interfaces:**
- Consumes: `ProcessLaneState`, `RunInspectorTurn`, `TurnTiming`, `UsageDisplayTotal`, current `processFocus`/`clearProcessFocus` store actions.
- Produces: accessible six-lane DOM with stable `data-process-lane`, `data-process-node`, `data-turn` and expandable public details.

- [ ] **Step 1: Write failing renderer tests**

Render `ProcessLaneView` with a synthetic state containing one route, an empty evidence lane, a waiting task gate, an open rule-demo task gate and a blocked host gate. Mock `../../i18n`, `../../stores/ui` and `../chat/RunInspector` using the existing renderer test pattern. Assert:

```ts
expect(html).toContain('data-process-lane="entry"');
expect(html).toContain('data-process-lane="evidence"');
expect(html).toContain("这一轮没查文献");
expect(html).toContain("规则演示");
expect(html).toContain("reconcile-before-retry");
expect(html).toContain('data-process-node="doing"');
```

Add an assertion that the embedded inspector renders only inside the execution node and that the host action label is a navigation label, not an execution command.

- [ ] **Step 2: Run the renderer test to verify it fails**

Run: `npm run test -w @drone/desktop -- src/renderer/src/components/panel/ProcessLaneView.test.tsx`

Expected: FAIL because the component and lane markup do not exist.

- [ ] **Step 3: Implement `ProcessLaneView`**

Render six lane containers in fixed order. For each non-empty lane render nodes from `ProcessLaneState`; for empty lanes render the localized gray placeholder. Use stable ids for SVG paths and node cards. Render three text lines, technical code, status badge and receipts. Gate cards use `waiting`, `open` and `blocked` classes. The rule-demo badge is rendered only when the node has `demo === true`.

Preserve the existing process focus behavior by putting `data-turn` on the root state wrapper and using a `useEffect` that scrolls and adds `jump-flash` when `processFocus.turnIndex` changes. The formal client’s gate actions call only the supplied `onOpenTask` callback; the component never invokes a task or research tool.

- [ ] **Step 4: Add responsive lane CSS**

Append focused selectors to `packages/desktop/src/renderer/src/styles/shell.css`: `.process-lanes`, `.process-lane`, `.process-lane-empty`, `.process-lane-node`, `.process-lane-node[data-state="waiting"]`, `.process-lane-node[data-state="blocked"]`, `.process-lane-node[data-state="open"]`, `.process-lane-wire` and reduced-motion rules. Use the existing `--context-panel-w` variable; at 372px allow two columns with wrapping and at wider panels allow three columns. Keep wires pointer-events disabled and card contents keyboard-accessible.

- [ ] **Step 5: Replace `ProcessPane`’s card list**

In `ProcessPane.tsx`, replace `turns.map(...)` and the old panel-card list with:

```tsx
const laneState = useMemo(() => deriveProcessLaneState(messages), [messages]);
return (
  <div className="context-pane" ref={listRef}>
    <ProcessLaneView
      state={laneState}
      inspectors={inspectors}
      timings={timings}
      usages={usages}
      onOpenTask={() => setActiveTab("tasks")}
    />
  </div>
);
```

Keep the existing empty-session branch and timing/usage derivation. Remove the old turn-card-only DOM selectors, but preserve the `processFocus` store contract so turn-footer navigation continues to work.

- [ ] **Step 6: Run focused tests and desktop typecheck**

Run:

```sh
npm run test -w @drone/desktop -- src/renderer/src/components/panel/ProcessLaneView.test.tsx
npm run typecheck -w @drone/desktop
```

Expected: renderer tests pass, TypeScript reports no missing props or i18n keys, and the existing desktop suite remains runnable.

- [ ] **Step 7: Commit the renderer replacement**

```sh
git add packages/desktop/src/renderer/src/components/panel/ProcessLaneView.tsx packages/desktop/src/renderer/src/components/panel/ProcessLaneView.test.tsx packages/desktop/src/renderer/src/components/panel/ProcessPane.tsx packages/desktop/src/renderer/src/styles/shell.css
git commit -m "feat: render process history as lanes"
```

### Task 3: Add bilingual copy and preserve public detail access

**Files:**
- Modify: `packages/desktop/src/renderer/src/i18n/zh.ts`
- Modify: `packages/desktop/src/renderer/src/i18n/en.ts`
- Modify: `packages/desktop/src/renderer/src/components/panel/ProcessLaneView.tsx`
- Modify: `packages/desktop/src/renderer/src/components/panel/ProcessLaneView.test.tsx`

**Interfaces:**
- Consumes: the existing `useT` translation function and the shared lane state’s stable ids/statuses.
- Produces: matching `panel.processLanes.*` keys in both dictionaries and localized accessible names.

- [ ] **Step 1: Add the Chinese and English key sets**

Under the existing `panel` dictionary add matching keys for lane labels, empty messages, status labels, `ruleDemo`, `taskGate`, `hostGate`, `library`, `expandDetails`, `collapseDetails`, `openTask`, `openReconcile`, `receiptCount`, and the three-line fallback copy. Use the document’s exact Chinese empty copy: `等一句话进来`, `这一轮没停过`, `还没开工`, `这一轮没查文献`, `没有写入知识库`, `还没到回答`.

- [ ] **Step 2: Replace hardcoded renderer strings**

Change `ProcessLaneView` to call `useT` for all visible labels, badges, empty copy, button labels and `aria-label` values. Keep technical reason codes such as `task-authorization-required` and `reconcile-before-retry` as raw codes alongside localized human reasons.

- [ ] **Step 3: Extend bilingual rendering tests**

Render the component with the language mock set to `zh` and `en`. Assert that the same node ids produce the localized lane headings and that the technical reason code remains present in both languages. Assert that every key read by `ProcessLaneView` exists in both dictionaries by using the project’s inferred i18n typecheck.

- [ ] **Step 4: Run checks and commit copy changes**

Run:

```sh
npm run test -w @drone/desktop -- src/renderer/src/components/panel/ProcessLaneView.test.tsx
npm run typecheck -w @drone/desktop
```

Then commit:

```sh
git add packages/desktop/src/renderer/src/i18n/zh.ts packages/desktop/src/renderer/src/i18n/en.ts packages/desktop/src/renderer/src/components/panel/ProcessLaneView.tsx packages/desktop/src/renderer/src/components/panel/ProcessLaneView.test.tsx
git commit -m "feat: localize process lane states"
```

### Task 4: Upgrade the independent sketch and add deterministic layout checks

**Files:**
- Create: `scripts/check-route-lane-sketch.mjs`
- Modify: `/Users/gaoyangwei/test.html`

**Interfaces:**
- Consumes: the same event field names and status codes as `ProcessEvent`; `?reveal=<0..7>&width=<372|744>&play=0&measure=1` query controls.
- Produces: a standalone six-lane demo with `#measure` JSON containing `step`, `current`, `overlaps`, `overflow`, `edges`, `nodes`, `taskGateState`, `hostGateState`, `ruleDemo`.

- [ ] **Step 1: Add failing sketch assertions**

Create `scripts/check-route-lane-sketch.mjs` with Node `vm`. The sketch embeds an esbuild IIFE generated from the shared reducer, presentation, layout and demo fixture. Evaluate only that IIFE in a VM, then derive each of the eight steps and compute layout at `[744, 372]`; assert state and estimated rectangles. This is deterministic data/layout validation, not browser-rendered verification. Do not run Electron or another browser to bypass the unavailable CUA security check.

```js
if (report.overlaps.length !== 0) throw new Error(`overlap at ${width}/${reveal}`);
if (report.overflow) throw new Error(`overflow at ${width}/${reveal}`);
if (reveal === 5 && report.hostGateState) throw new Error("step 6 opened a host gate");
if (reveal === 6 && report.hostGateState !== "blocked") throw new Error("step 7 lacks host gate");
if (reveal === 7 && report.edges.some((edge) => edge === "hostGate-doing")) throw new Error("status loops to doing");
```

Run it before changing the sketch: `node scripts/check-route-lane-sketch.mjs /Users/gaoyangwei/test.html`. Expected: FAIL because the current `#measure` output has no gate-state fields and the current tool card is not inline.

- [ ] **Step 2: Change the sketch event fixture and reducer**

Add stable `id`, `ruleDemo`, `hashChanged` and gate status fields to the eight `STREAM` entries. Keep step 2 as a new topic because it contains正文 after `继续。`; keep step 8 as a status event that leaves the `pydeseq2` selection card. Replace the large `tools` node with an inline receipts list under `doing`; preserve the “搜到了，还没读 / 不进本轮读过” copy for hits.

- [ ] **Step 3: Implement the two-step gate styling**

At step 5 render a waiting task gate with the approval action. At step 6 mutate that same node to `open`, show `规则演示 · 仅授权，不代表写盘成功`, remove/disable the approval action, and do not create a host-gate edge. At step 7 add the blocked host gate with `reconcile-before-retry`, keep the open task gate, and show the host-observed stop in `doing`. It is a demonstration event, not an actual disk hash check. Step 8 updates only the user input and doing lines and adds no new edge.

- [ ] **Step 4: Extend layout measurement and visual state output**

Update `measure()` to include gate states, rule-demo status, current node, and edge ids. Add visible badges for lane state and rule demonstration. Keep six fixed lanes, gray empty text, 744 three-column/372 two-column wrapping, and reduced-motion behavior.

- [ ] **Step 5: Run the sketch checks and commit the script**

Run:

```sh
node scripts/check-route-lane-sketch.mjs /Users/gaoyangwei/test.html
node --check scripts/check-route-lane-sketch.mjs
```

Expected: all 16 width/step state and estimated-layout checks pass; actual browser layout remains a separate UI verification. Commit only the repository script; the absolute `/Users/gaoyangwei/test.html` remains outside the Drone commit:

```sh
git add scripts/check-route-lane-sketch.mjs
git commit -m "test: verify route lane sketch layout"
```

### Task 5: Reconcile documentation and repository navigation

**Files:**
- Modify: `/Users/gaoyangwei/Documents/Codex/2026-09-30/git-checkout-b-docs-architecture-v2/outputs/route-lane-sketch.md`
- Modify: `/Users/gaoyangwei/Documents/Codex/2026-09-30/git-checkout-b-docs-architecture-v2/outputs/drone-base-data.md`
- Modify: `docs/INDEX.md`

**Interfaces:**
- Consumes: shipped `process-lanes.ts` exports, renderer behavior, sketch eight-step fixture and measurement script.
- Produces: documentation whose claims match the implementation and whose formal-client boundary says the process page is the six-lane view.

- [ ] **Step 1: Update `route-lane-sketch.md`**

Keep the two existing blocks, but add the code-to-position mapping after “稳定位置”: `drone-turn-route` → 用户输入/节点选择, `TaskView` → 门, tool receipts → 正在做, research stages → 证据/沉淀/回答. Change the formal-client note from “过程页仍是倒序卡片列表” to “过程页使用六泳道位置视图；节点内保留公开明细”。

Expand the eight-step table with an explicit “规则演示” marker on step 6 and “哈希变化” on step 7. State that step 6 does not imply a successful write, step 7 creates `reconcile-before-retry`, and step 8 does not connect the host gate back to doing. Preserve the two-book rule and gray empty lanes.

- [ ] **Step 2: Update `drone-base-data.md` only for shipped facts**

In the interface section, replace the old process-page description with the six-lane projection and node-detail behavior. Add `packages/shared/src/process-lanes.ts` to the shared code map with its event extraction/reducer responsibility. Do not copy the eight-step fixture or claim new task/research behavior that the implementation did not add.

- [ ] **Step 3: Update `docs/INDEX.md` navigation**

Under the shared package table add one row pointing to `src/process-lanes.ts`, stating that it is the pure transcript-to-six-lane projection and that it owns no persistence or authorization. Leave unrelated existing modifications untouched.

- [ ] **Step 4: Review docs against code and commit repository docs**

Run:

```sh
git diff --check
rg -n -F -e TODO -e TBD -e 待定 docs/superpowers/specs/2026-10-04-route-lane-process-design.md docs/superpowers/plans/2026-10-04-route-lane-process.md
```

Review the external files with `sed -n '1,260p'` and verify that every statement about lane names, step numbers, reason codes and client behavior matches the code and sketch checks. Commit only `docs/INDEX.md` from this repository; leave the external output files in their owning checkout.

```sh
git add -p docs/INDEX.md
git commit -m "docs: index process lane projection"
```

### Task 6: Run the complete validation gate

**Files:**
- No new files; validate all files changed by Tasks 1–5.

**Interfaces:**
- Consumes: shared projection, renderer, i18n, sketch checker and documentation.
- Produces: passing test/typecheck/build evidence and a clean reviewable diff for this feature.

- [ ] **Step 1: Run focused shared and renderer suites**

```sh
npm run test -w @drone/shared -- src/process-lanes.test.ts
npm run test -w @drone/desktop -- src/renderer/src/components/panel/ProcessLaneView.test.tsx
```

Expected: both focused suites pass.

- [ ] **Step 2: Run the sketch and architecture checks**

```sh
node scripts/check-route-lane-sketch.mjs /Users/gaoyangwei/test.html
npm run check:arch
```

Expected: all 16 sketch state/layout checks pass and architecture checks report no new violations.

- [ ] **Step 3: Run repository typecheck, lint, tests and build**

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Expected: all commands exit 0. If a pre-existing unrelated failure appears, record the exact command and output in the final report without weakening the lane assertions.

- [ ] **Step 4: Inspect the final diff and external files**

```sh
git diff HEAD~5..HEAD --stat
git status --short
sed -n '1,260p' /Users/gaoyangwei/Documents/Codex/2026-09-30/git-checkout-b-docs-architecture-v2/outputs/route-lane-sketch.md
```

Confirm that no `sources/`, Vault, session, or `results/` file entered the repository diff, that the formal process page is the lane view, and that the external sketch file is the requested `/Users/gaoyangwei/test.html`.

- [ ] **Step 5: Commit only if validation changed tracked repository files**

```sh
git status --short
```

If the validation produced no source changes, leave the existing task commits intact; do not create an empty commit. Report the feature commit ids and the exact validation commands in the final response.

## Handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-04-route-lane-process.md`. Execute it task-by-task only after choosing an execution mode. The repository’s multi-agent policy requires inline execution unless the user explicitly asks for delegation; if delegation is chosen, use the superpowers subagent-driven workflow with a review after each task.

## Implementation review adjustments

- Put presentation copy in `packages/shared/src/process-lanes/presentation.ts`, fixture in `demo.ts`, and pure estimated layout in `layout.ts`. Re-export through the facade. This avoids one large reducer and generates the sketch from the actual shared implementation with esbuild.
- The extractor uses successful `research_read_knowledge` receipts with non-empty text, path and hash; the answer check consumes `verified.sources`, checks those hashes against current reads, and never treats delivery links as evidence.
- A user message resets only current-turn reads and citations. Its routing receipt determines whether workflow/gate cards reset; status routes preserve selected workflow and gates. Historical snapshots remain available through a round picker and turn-footer focus.
- Track tool observations by `toolCallId` plus state, allow completed updates to supersede running observations, and include `transcript.streaming` in the live projection. Retain subagent receipts through the existing structured subagent messages.
- Node checks do not certify rendered layout. CUA browser access is currently unavailable, so do not replace it with another browser controller.
