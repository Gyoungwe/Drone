# 子智能体面板（会话内专属派发）

右侧上下文面板新增「子智能体」页签：看见当前会话能用的子智能体、直接把任务派发到本会话、跟踪本会话的每一次运行。派发走后端 `runSubagent`——与模型自己调用 `subagent` 工具是**同一条运行时路径**（权限 gate、互斥、`required_tools` 校验、运行槽排队、子会话文件、运行卡），面板只多了一层「谁派发的」登记。

设计稿：`docs/design-example-tasks-subagent-ui-permissions.md` §B + `subagent-ui-mockup.html`（S0–S9）。

## 面板结构（从上到下）

| 区块 | 内容 | 数据源 |
| --- | --- | --- |
| 可用 | 内置 `scout` / 用户 `~/.pi/agent/agents/*.md` / 项目 `.pi/agents/*.md`；每行 = 头像 + 名称 + 来源角标 + 描述，点开看工具集 / MCP 访问 / 模型 / 定义文件；「派发」把它填进表单 | `subagents:list` → `SubagentPanelService.listAgents` |
| 派发到本会话 | 每行任务 = 子智能体 + 任务文本 + 必需工具（只能从该 agent 的工具集勾选）；批量字段 = 阶段提示（`WORKFLOW_STAGES` 的 contract 追加到任务末尾）/ 工作目录（默认会话 cwd）/ followUp 开关（默认开）/ 项目级定义信任勾选；最多 8 个并行任务；「插入到输入框」是保底路径（把结构化请求交给主模型自行编排，不派发） | `subagents:dispatch` |
| 本会话运行 | 每个运行一张卡：头像表情 = 状态、状态胶囊、目标 / 当前 / 工具 / tokens / 时长、上级请求回复、steer 引导、操作按钮 | `subagent_run` 事件 + `subagents:runs` 补水 |

页签徽标 = 本会话运行中的数量（含需要回复 / 等待审批）；存在「需要回复 / 等待审批」时徽标变琥珀。

## 状态机

```
queued ──(首个 onProgress = 子会话已创建)──▶ running ⇄ needs_reply / waiting_approval ──▶ done / error
   │                                                   │
   └── 取消 ──────────────────────────────────────────┴── 中止 ──▶ aborted
```

| 状态 | 含义 | 头像表情 | 操作 |
| --- | --- | --- | --- |
| 排队中 | 等运行槽（`withNativeSubagentSlot`：全局 3 + 项目 `maxConcurrentSubagents` 1–3）；只有面板派发会暴露此态 | 半阖眼徘徊 | 取消 |
| 运行中 | 子会话在跑 | 扫视 + 紫色微光 | 中止 · steer · 展开 |
| 需要回复 | 子会话 `contact_supervisor` 且 `expectsReply` | 抬眼 + 琥珀圈 | 卡内直接回复（`replySubagentSupervisor`） |
| 等待审批 | 子会话的工具确认挂在父会话 gate 上（审批坞已弹出） | 抬眼 + 琥珀圈 | 查看审批（滚到审批坞）· 中止 |
| 完成 · 待 / 已进入上下文 | followUp 已交给主模型：主模型忙则排 followUp 队列（待），被消费后（已） | 眯眼笑 + 绿圈闪一次 | 引用 · 回放 · 再次派发 |
| 失败 | `exitCode ≠ 0` 或 runner 抛错 | 抖一下 + 垂眼 | 回放 · 重试（同参数新运行） |
| 已中止 | 用户取消 / 中止 / 会话关闭；**不算失败**，不注入 followUp | 闭眼灰化 | 回放 |

## 输入框 `@` 派发（S9，面板表单的键盘版）

在输入框**消息开头**键入 `@`，@ 菜单先列本会话可用的子智能体（头像 + 名称 + 描述 + 来源角标），再列项目文件；两组共用一个 ↑↓ 下标。选中子智能体后它成为行首一枚不可拆分的胶囊，其后的正文即任务，`Enter` 按胶囊走**直接派发**——与面板表单的单任务派发完全等价（`subagents:dispatch`，同一条 `runSubagent` 路径），不经主模型、不占 followUp 排队位；工作目录 = 会话 cwd，必需工具不填，followUp 默认开。派发成功后草稿清空、输入框上方给一行反馈，聊天里出现同一张运行卡；被后端拒绝时用发送错误条显示原因（重试 = 再派发一次），胶囊 / 引用 / 正文整份回填。

| 规则 | 行为 |
| --- | --- |
| 只在消息开头 | `@` 前有任何文本（`看下 @scout`）都只补全文件——避免误伤正文里的邮箱 / 提及；已有 @ 文件胶囊时文本仍算开头 |
| 与 `/` 互斥 | 有 slash 胶囊时 `@` 只补全文件；有子智能体胶囊时正文里的 `/` 不弹命令菜单 |
| 单任务 | 已有子智能体胶囊后 `@` 只补全文件；多任务 / 必需工具 / 阶段契约 / 换目录仍走面板表单 |
| 会话边界 | 草稿会话、只读会话不提供子智能体候选（与面板「先发送一条消息创建会话」一致），此时 `@` 与以前完全相同 |
| 项目级定义 | 受信任项目里的项目级定义每次派发都要勾选信任 → 选中后转到面板表单并预选该 agent；未信任项目的项目级定义列出但置灰 |
| 撤销 | `Esc`、空文本 `Backspace` / `Delete`、胶囊上的 × 都整枚撤销并把 `@name ` 拼回文本开头（与 slash 胶囊同一恢复语义），菜单不立刻重弹 |
| 图片 | 派发没有图片通道：有图时提示移除图片或撤掉胶囊改发主模型，不发送 |
| 拼装序 | 与普通发送一致：引用块（blockquote）→ `@path` 文件引用 → 正文；子智能体自己有 `read`，`@path` 保留为纯文本引用 |

## 结果如何进入主模型

- **followUp 勾选（默认）**：完成时后端 `session.sendCustomMessage({ customType: "drone-subagent-result", content: <摘要>, details: { run } }, { triggerTurn: true, deliverAs: 主模型忙 ? "followUp" : undefined })`。主模型空闲立即开一轮（结果作为本轮消息），忙碌则排 followUp 队列，本轮结束后进入；对应的 `message_end` 让面板 / 结果卡显示「已进入上下文」。主模型可见的只是摘要文本（状态 · 任务 · 结论 · 子会话文件），不是整份记录。
- **未勾选**：结果只落一条 custom **entry**（`drone-subagent-result`，模型不可见），结果卡留在聊天里，用户按「引用」把 ≤ 20 行摘要 + 子会话文件作为 blockquote 塞进输入框，自己决定发不发。
- 失败 / 中止：同样只落 entry，不打扰主模型。

派发本身也落一条 custom entry（`drone-subagent-dispatch`，模型不可见），重开会话仍能解释「这个子智能体是谁派发的」；`toSessionMessages` 回放时把派发记录建成一行子代理卡，结果记录原地更新同一 run，未到终态且已不在进程内的运行按「已中止」显示。

> 为什么派发条目不是 custom **message**：pi 的 `convertToLlm` 会把所有 custom message 转成 user 消息喂给模型，做不到「持久化但对模型不可见」；custom entry 只进会话文件不进上下文，正好满足系统条目的要求。

## 权限与信任

- 子会话的所有确认都经父会话的 `PermissionGate`（同一个审批坞、同一份项目记忆、同一份审计日志）。面板只做归因：`RunScopedGate` 记录「此刻挂在 gate 上的请求 id 属于哪个 run」（`pendingApprovalIds`），审批坞据此显示「来自子智能体 X」胶囊和「查看该运行」，运行卡显示「等待审批」。决策链路本身没有改动。
- 项目级定义：未信任项目里可见但 `trusted=false`（不可派发，后端也拒绝）；信任项目里每次派发都要勾选「我信任本项目的 .pi/agents/ 定义」（对应工具的 `confirmProjectAgents`），勾选只对本次派发有效，不写入信任文件。
- 知识专家（`PROTECTED_KNOWLEDGE_AGENTS`）不出现在列表里，也不能派发（走 `research_delegate_knowledge`）。
- 只读会话（子会话检视）不能派发；关闭父会话会中止其全部未完成运行。
- 子会话内 `subagent` 工具不可用（现有 `applySubagentMutex` / runner 过滤），避免递归派发。

## 代码位置

| 层 | 文件 |
| --- | --- |
| shared | `packages/shared/src/subagent.ts`（`SubagentPanelRun` / `SubagentPanelAgent` / `SubagentDispatchInput` / custom 类型常量 / 记录解析）；`session.ts`（`SubagentRunEvent`）；`transcript/reducer.ts`（`subagent_run` 原地更新派发行、结果 `message_end` → 已进入上下文）；`ipc.ts`（`subagents:list/dispatch/abort/runs`、`SUBAGENT_INVOKE_METHODS`） |
| backend | `tools/subagent/panel.ts`（`SubagentPanelService`：校验 / 登记 / 调度 / 归因 / 结果入会话）；`pi-backend.ts`（`listSessionSubagents` / `dispatchSubagents` / `abortSubagentRun` / `listSubagentRuns`；`emitEvent` 里 `observe`；`getSessionMessages` 并回面板记录）；`session/messages.ts`（回放）；`lan/sanitize.ts`（`subagent_run` 白名单 + 剥本地路径） |
| desktop main | `main/ipc/subagents.ts`（四条通道 1:1 透传） |
| renderer | `stores/subagents.ts`；`panel/SubagentsPane.tsx` + `subagents-form.ts`（校验 / 阶段契约 / 引用文本纯函数）；`composer/at-subagents.ts`（S9 纯逻辑：候选条件 / 名称模糊过滤 / 菜单合并 / 任务拼装 / 胶囊回填）+ `composer/AtMenu.tsx`（子智能体组 + 文件组）+ `composer/SubagentChip.tsx` + `use-at-completion.ts` / `use-slash-menu.ts` / `use-composer-send.ts`（胶囊 → 直接派发分支）+ `stores/drafts.ts`（`subagent` 字段）；`chat/SubagentAvatar.tsx` + `subagent-avatar.ts`（djb2 定色 h0–h7、角标 D/U/P、`data-state` 表情）；`chat/SubagentResultCard.tsx`；`chat/SubagentRunCard.tsx`（面板运行的状态 / 派发系统条目）；`chat/InlineSubagentTranscript.tsx`（从运行卡拆出，面板与聊天共用）；`session/ApprovalDock.tsx`（来源胶囊 + 查看该运行）；`panel/ContextPanel.tsx`（页签 + 徽标琥珀态）；`styles/subagents.css` |
| 测试 | backend `test/subagent-panel.test.ts`（状态机 / followUp 路径 / 取消与中止 / 归因 / 校验拒绝 / 回放）；renderer `subagent-avatar.test.ts`（哈希稳定性、状态映射）、`subagents-form.test.ts`（表单校验、阶段契约、槽位、引用）、`stores/subagents.test.ts`、`stores/transcript-subagent-run.test.ts`（派发行原地更新）、`subagents-pane.test.tsx`（七种状态渲染 / 边界空态）、`composer/at-subagents.test.ts`（S9 候选条件 / 过滤 / 拼装）、`composer/use-composer-send.test.ts`（胶囊 → 派发而非 prompt、空任务 / 图片 / 草稿会话拦截、失败回填）；冒烟 `node scripts/check-subagents-ui.mjs`（Electron 隔离界面：派发 → 运行 → 审批归因 → 完成结果卡 → 中止 → 输入框 `@` 选择器（菜单 / 胶囊 / 撤销 / `/` 互斥 / Enter 派发）→ 英文文案，截图落 fixture 目录） |

## 头像规范（S0）

- 形象 = 圆角方块 + 两只白色眼睛（无人机脸）；底色 = `djb2(name) % 8` 选 `h0–h7`（同名任何时刻同色；8 色板避开红 / 琥珀 / 绿状态色）；角标 D / U / P = 内置 / 用户 / 项目。
- 尺寸：聊天 28px（lg）/ 面板 20px（md）/ 行内 15px（sm）。
- 表情 = 状态（`data-state`）：idle 缓慢呼吸 + 偶尔眨眼 · running 快呼吸 + 紫光 + 扫视 · waiting 抬眼 + 琥珀圈 · queued 半阖眼徘徊 · done 眯眼笑 + 绿圈闪一次 · error 抖一下 + 垂眼低饱和 · aborted 闭眼灰化静止。纯 CSS（`translate` / `scale` / `box-shadow`），`prefers-reduced-motion: reduce` 时全部静止。
- 改哈希算法会让已有用户的头像换色——单测钉住了 `scout / lit-reviewer / data-checker / wiki-curator` 的参考色槽。

## 待定决策的落地

| 问题 | 结论 |
| --- | --- |
| 聊天里留系统条目？ | 留：custom entry 持久化 + 头像 + 可折叠，模型不可见 |
| 结果进入主模型的默认方式 | 默认 followUp 摘要（表单可关）；关掉则只留结果卡，用户手动「引用」 |
| 「插入到输入框」保底路径 | 保留为次要按钮 |
| 中止语义 | 子会话 abort → 父会话得到「已中止」结果，不算失败，不注入 followUp |
| 超槽位 | 排队（复用运行槽队列），运行列表里可取消 |
| 项目级 agent 信任勾选 | 每次派发都勾，会话内不记忆 |
| 页签 | 「子智能体」在「产物」之后，`PanelTab = "subagents"` |
| S9 `@` 选择器 | 作为 PR 4 单独交付：`@` 只在消息开头生效、与 `/` 互斥、单任务、项目级定义转面板勾选信任 |
| S9 `@` 选择器 | 未并入本 PR（单独排期） |
