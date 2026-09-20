# 设计：六方向示例任务 · 子智能体会话内调用 UI · 权限设置页

> 状态：**待确认**（2026-09-20）。确认后按「分支 → 测试 → PR → 合并」分三个 PR 实现；其中 B（子智能体 UI）本轮只定设计，实现另起。
> 原则：不改核心契约就能扩展（`docs/extension-hooks.md`）、宿主掌握权限与证据（`docs/task-authorization.md`）、示例是导航与任务配置而不是新的正文（`docs/research-skill-consolidation.md` §五）。

## 0. 现状与复用点

| 能力 | 现有实现 | 本设计如何复用 |
| --- | --- | --- |
| 六个方向 / 阶段 / 命令 | `packages/shared/src/workflow-catalog.ts`：`WORKFLOW_DIRECTIONS`（planning · evidence · analysis · writing · presentation · engineering）、`WORKFLOW_STAGES`（每阶段 `commands` + `contract`）；输入框 `/` 菜单按「方向 → 阶段 → 命令」导航（`composer/SlashMenu.tsx`、`slash-filter.ts`）；设置页 `WorkflowOverview.tsx` | 示例任务按 `direction + stage` 建模，命令与 contract 直接引用阶段表，不复制文案 |
| 任务协议 | `.pi/lib/tasks/register.mjs`：`task_plan / task_status / task_wait / task_reconcile / task_evidence_restore`；验收种类 `file`、`human_review`（核心）+ `zotero_item`、`wiki_review`（扩展注册）；授权卡走 AskGate；右栏 `panel/TasksPane.tsx` | 示例只生成「带里程碑与验收要求的首条消息」，任务仍由模型经 `task_plan` 建立、由用户授权 |
| 发消息 | `composer/use-composer-send.ts` → `getPi().prompt(sessionId, content, images)` | 「一键发起」复用同一条路径，示例即一条预填消息 |
| 子智能体 | 后端 `tools/subagent/`：`discoverAgents`（builtin `scout` + 用户 / 项目 `agents/*.md`）、`makeSubagentTool`（single `{agent, task}` / parallel `{tasks[]}`，8 任务、并发 3、`required_tools` 校验、`confirmProjectAgents`）、`runSubagent`（隔离 `AgentSession`，权限桥接父会话 gate，会话文件落 `sessions-subagents/`）、`applySubagentMutex`；`.pi/extensions/workspace-config.mjs` `maxConcurrentSubagents` 1–3；`.pi/extensions/subagent-research.mjs` `research_subagent_policy` + `/research-subagents`；shared `subagent.ts` `extractSubagentRuns`；渲染 `chat/SubagentRunCard.tsx`（状态、`peekSubagentMessages` 只读回放、`supervisorRequest`、运行中可控）；设置 `providers/SubagentPanel.tsx`（模型） | 面板不新造运行时：列表用 `discoverAgents`，派发落到同一 `runSubagent`，运行卡复用 `SubagentRunCard` 数据 |
| 权限 | `~/.pi/agent/permissions.json` → `permissions/config.ts`（`parseConfig`、`mergeWithDefaults`、`createPermissionConfigLoader` 按 mtime+size 每次 tool_call 前重读）；`pattern.ts`（`PermissionAction = allow/ask/deny`，`PermissionRule = 动作 | {模式: 动作}`，键序即评估序、后命中生效；`evaluateRules`、`evaluateBashCommand`、`suggestPattern`）；`extension.ts` 求值链 deny → 临时区 → 多根边界读写分离 → 项目记忆 → ask；会话权限模式（default/fullAccess）为内存态，在输入框 `PermissionPicker` 切换；`audit.ts` fullAccess 审计 `permission-audit.jsonl`；设置 IPC 样式见 `desktop/src/main/ipc/settings.ts` | 设置页 = 该文件的可视化编辑器 + 用同一引擎做「命令试算」；保存即生效，无需新增热加载通道 |

既有设计决策保持不变：**D1** 会话权限模式是内存态、不落盘；**D7** `enabled` 不提供 UI 开关（仅手改文件）。

---

## A. 六方向示例任务（应用内内置）

### A.1 目标与边界

- 每个方向 **1 个**可一键发起的示例；点击后在**当前会话**发出一条结构化首条消息，模型据此调用 `task_plan`，用户在授权卡确认后才开始执行。示例不绕过任何授权、不预先创建任务、不写文件。
- 示例内容是数据（shared），渲染与发起在 desktop；文档 `docs/example-tasks.md` 同步说明如何新增示例。
- 不做：自动填充用户私有路径、自动选择模型、自动执行 bash。

### A.2 数据模型（`packages/shared/src/example-tasks.ts` + `example-tasks.json`）

```ts
interface ExampleTask {
  id: string;                         // e.g. "planning-hypotheses"
  direction: WorkflowDirection;       // 必须存在于 WORKFLOW_DIRECTIONS
  stages: string[];                   // 必须存在于 WORKFLOW_STAGES，且 direction 一致；首个阶段的第一条命令作为消息首行
  title: { zh: string; en: string };
  goal: { zh: string; en: string };   // 一句话目标（进入消息）
  inputs: Array<{ key: string; label: {zh;en}; placeholder: {zh;en}; required: boolean; kind: "text" | "path" | "doi" | "select"; options?: string[] }>;
  milestones: Array<{ title: {zh;en}; acceptance: { kind: "file" | "human_review" | "zotero_item" | "wiki_review"; hint?: string } }>;
  authorizations: Array<"task" | "zotero-write" | "external-delivery">;   // 只用于提示用户会遇到哪些确认
  artifacts: Array<{zh;en}>;          // 预期产物（提示用，不做验收）
  contractNotes?: {zh;en};            // 从阶段 contract 派生的边界提醒
}
```

校验（单元测试）：方向全覆盖且各恰 1 个；`stages`/命令在目录中存在；验收 `kind` ∈ 已知集合；`required` 输入无默认值。

### A.3 六个示例（初稿，实施时可微调文案）

> 修订（一次授权闭环）：实施后把五条 `human_review` 里程碑改成了交付文件（`scope.md`、`interpretation.md`、`revision-notes.md`、`delivery-check.md`、`handoff-check.md`），选「入 Zotero」时留空 DOI 的 `zotero_item` 作为授权卡上写明的「精读后写入的一篇」槽位，不再逐篇弹卡。现行契约以 `docs/example-tasks.md` 与 `packages/shared/src/example-tasks.json` 为准；下表保留为设计时的初稿。

| # | 方向 | 阶段（命令） | 用户输入 | 里程碑 → 验收 | 边界提醒 |
| --- | --- | --- | --- | --- | --- |
| 1 | 研究规划与设计 | `ideation`（`/skill:hypothesis-generation`）→ `methods` | 研究问题*，背景材料路径 | ① 问题澄清与边界 → `human_review`；② 竞争假设 + 判别证据清单 `hypotheses.md` → `file`；③ 实验设计草案 → `file` | 不声称已完成实验 |
| 2 | 文献证据与知识管理 | `search`（`/skill:nature-academic-search`）→ `reading` → `library` | 主题/关键词*，时间范围，是否入 Zotero | ① 检索范围与命中清单 → `file`；② 精读 2–3 篇的证据卡 → `file`；③（可选）文献进入 Zotero → `zotero_item` | 命中 ≠ 已读；Zotero 写入需单独同意 |
| 3 | 数据分析与专业计算 | `explore`（`/skill:exploratory-data-analysis`）→ `statistics` | 数据文件路径*，研究问题/分组变量* | ① 数据质量报告 → `file`；② 分析计划与检验结果 → `file`；③ 结果解读确认 → `human_review` | 只披露实际执行过的检查 |
| 4 | 论文写作与审校 | `writing`（`/skill:scientific-writing`）→ `review` | 章节*，素材/证据卡路径，目标期刊 | ① 章节初稿 → `file`；② 审校意见（证据受限）→ `file`；③ 用户确认修改 → `human_review` | 只完成所请求章节，不强制全流程 |
| 5 | 可视化与成果交付 | `figures`（`/skill:scientific-visualization`）→ `slides` | 结果/数据文件*，目标格式（pptx/pdf） | ① 真实数据图（含不确定性）→ `file`；② 汇报幻灯片 → `file`；③ 交付检查 → `human_review` | AI 示意图不是数据图 |
| 6 | 工程集成与协作 | `resources`（`/skill:get-available-resources`）→ `handoff` | 项目路径*，交接对象 | ① 计算资源清单（只盘点）→ `file`；② spec / plan / HANDOFF → `file`；③ 确认无安装、付费、外发 → `human_review` | 不安装、不预订资源、不外发 |

### A.4 入口与交互

1. **右栏「任务」页签空态**：「还没有任务 —— 从一个示例开始」+ 六张方向卡（图标 / 标题 / 一句话目标）。
2. **输入框 `/` 菜单方向层**：每个方向末尾追加「示例：<标题>」项（`slash-filter.ts` 的 `workflowMenuItems` 增加 `example` 项，与现有 `workflow:<direction>` 导航同源）。
3. 点击 → 轻量表单（Dialog）：输入项（必填校验、`path` 类型给「选择文件/文件夹」按钮）、里程碑预览（只读）、将遇到的确认（授权卡 / Zotero 写入）。按钮：「在当前会话发起」「仅复制消息」。
4. 发起 = 组装消息并调用与输入框相同的发送路径：

```text
/skill:hypothesis-generation
【示例任务 · 研究规划与设计 · 从研究问题到可判别假设】
目标：…
输入：研究问题=…；背景材料=…（未提供）
请先用 task_plan 建立任务并等待我的授权，再开始执行：
  1. 问题澄清与边界（验收：human_review）
  2. 竞争假设与判别证据清单 → hypotheses.md（验收：file）
  3. 实验设计草案 → design.md（验收：file）
边界：不声称已完成实验；阶段契约：Question, rival hypotheses, discriminating evidence…
```

5. 无活动会话 / 草稿会话：按钮改为「新建会话并发起」（复用现有 draft → session 流程）；发送中禁用。

### A.5 实施清单（PR 1）

- shared：`example-tasks.ts/json` + `example-tasks.test.ts`（覆盖/引用完整性）。
- desktop：`components/tasks/ExampleTaskCards.tsx`（空态卡片）、`ExampleTaskDialog.tsx`（表单 + 消息组装 `composeExampleTaskPrompt()` 纯函数 + 单测）、`slash-filter.ts` 示例项、i18n `zh.ts/en.ts`。
- docs：`docs/example-tasks.md`（六例说明、如何新增、消息模板）；`docs/INDEX.md` 加行；CHANGELOG `Unreleased`。
- 测试：vitest（shared 数据、prompt 组装、菜单项）、`scripts/check-task-delivery-ui.mjs` 风格的冒烟补一条「空态含 6 张示例卡」。
- 验收：六个方向各能发起一条消息；模型调用 `task_plan` 后出现授权卡；未授权时无文件写入；`npm run lint/typecheck/test` 绿。

---

## B. 子智能体「会话内专属调用」UI（本轮仅设计）

### B.1 目标

让用户在**当前会话**里直接看到可用子智能体、派发任务、监控与中止运行，而不必等主模型自己决定调用 `subagent` 工具。所有派发都绑定会话（`sessionId`），使用父会话的权限 gate、模型运行时与并发上限；离开会话即不可见。

### B.2 位置与结构

右栏新增页签 **「子智能体」**（`PanelTab`），核心渲染器实现（后端 `tools/subagent` 本就是核心能力；若日后要做成插件，需要先给 `DroneUI` 增加会话派发 API，见 B.7）。

```
┌ 子智能体 ─────────────────────────────────────────────┐
│ 可用（3）                         [刷新] [管理 agents/] │
│ ● scout        内置  只读侦察      read grep find ls webfetch │
│ ○ lit-reviewer 用户  文献精读      read webfetch  · 模型: gpt-… │
│ ○ data-checker 项目 ⚠ 未信任项目  read bash(只读链)          │
├─ 派发到本会话 ────────────────────────────────────────┤
│ 子智能体  [scout ▾]     方向/阶段提示 [文献证据 · 文献发现 ▾]│
│ 任务      ┌──────────────────────────────────────────┐ │
│           │ 阅读 docs/ 下与权限相关的文档，列出…      │ │
│           └──────────────────────────────────────────┘ │
│ 工作目录  [当前会话 cwd ▾]   必需工具 [read][grep][+]    │
│ [+ 添加并行任务]（最多 8，同时运行 ≤ 3）                  │
│                              [派发]  [插入到输入框]     │
├─ 本会话运行（2）────────────── 筛选 [运行中|全部] ───────┤
│ ▶ scout · "阅读 docs/…"  运行中 00:42  工具 7  [中止][展开] │
│ ✓ lit-reviewer · "精读 DOI…" 完成 3m12s  产物 2  [回放][引用]│
└──────────────────────────────────────────────────────┘
```

### B.3 派发机制（两种，推荐 ①）

| 方式 | 流程 | 优点 | 代价 |
| --- | --- | --- | --- |
| ① 直接派发（推荐） | 渲染器 → IPC `subagents.run({ sessionId, runs: [{agent, task, cwd?, required_tools?}] })` → 后端在父会话上下文调用 `runSubagent`（同 gate / traces / mutex / 并发槽）→ 结果作为 `custom` 消息（`drone-subagent-result`，含 `SubagentRunData`）追加进父会话，并按 `PiBackend.prompt` 的 followUp 队列语义在主模型空闲时进入上下文 | 确定性、可中止、结果可追溯、与工具调用同一审计口径 | 需要新增后端 API 与「主模型如何消费结果」的约定（默认：追加一条系统提示「子智能体 X 已完成，摘要…」，用户可点「引用」把摘要插入输入框） |
| ② 提示词派发 | 把表单组装成一条用户消息「请用 subagent 工具运行 …」发给主模型 | 零后端改动 | 主模型可能改写/拒绝；无法保证并发与参数 |

会话正在流式输出时：① 允许派发（子会话独立），但结果注入排队；UI 显示「等待主模型空闲后进入上下文」。

### B.4 权限与信任

- 子智能体只拥有其定义里的 `tools`；`required_tools` 只做校验，**不授予**工具或权限（与 `tool.ts` 一致）。
- 审批：子会话的确认请求仍进 `ApprovalDock`，条目前缀「scout ›」，并在运行卡上同步显示 `supervisorRequest`。
- 项目级 agent 在未信任项目中派发需勾选「我信任该项目的 agents/」（对应 `confirmProjectAgents`）；列表用 ⚠ 标出。
- 会话处于 fullAccess 模式时，子会话沿用同一模式并写审计（现有行为），面板顶部提示。
- 并发：受 `maxConcurrentSubagents`（工作区配置 1–3）与 `applySubagentMutex` 约束；超限时「派发」置灰并说明。

### B.5 数据流

```
discoverAgents(cwd, projectTrusted) ──IPC subagents.list──▶ 面板列表（缓存至 cwd/信任状态变化）
表单 ──IPC subagents.run──▶ runSubagent ×N ──事件（onEvent）──▶ transcript store（bySession[childId]）
                                   └─ 完成 ──▶ custom 消息进父会话 ──▶ SubagentRunCard / 面板运行列表（extractSubagentRuns）
中止 ──IPC subagents.abort(childSessionId)──▶ 子会话 abort ──▶ 状态 cancelled
```

运行列表的数据源与 `SubagentRunCard` 相同（transcript 中的 subagent 运行 + 实时 `bySession`），保证会话内卡片与面板一致；只读回放用现有 `peekSubagentMessages`。

### B.6 会话专属性

- 页签内容按 `activeSessionId` 切换；草稿会话显示「先发送一条消息创建会话」。
- 派发记录不跨会话展示；子会话文件仍落 `sessions-subagents/`（打开即只读，现状）。
- `/research-subagents` 命令与 `research_subagent_policy` 保持原语义；面板「策略」折叠区只读展示当前策略（最大并发、只读 MCP 访问）。

### B.7 后续可选

- 输入框 `@` 选择器：`@scout 任务…` 直接走 ①；菜单复用 SlashMenu 组件。
- 插件化：若要让 UI 插件贡献同类面板，需要在 `DroneUI` 增加 `session.dispatchSubagent()`（用户显式启用的插件才可用）。本轮不做。

### B.8 实施清单（PR 3，待批准后）

- backend：`tools/subagent/api.ts`（list/run/abort 的会话级封装，复用 runner）+ `pi-backend.ts` 门面方法 + 单测（并发上限、未信任项目拒绝、结果注入顺序）。
- desktop main：`ipc/subagents.ts`；preload 暴露；shared 事件类型补 `subagent-result`。
- renderer：`components/panel/SubagentsPane.tsx`（列表 / 表单 / 运行列表）、`stores/subagents.ts`、i18n、`stores/ui.ts` 新 `PanelTab`。
- docs：`docs/subagents-panel.md`；INDEX；CHANGELOG。
- 验收：在同一会话派发 2 个并行任务可见运行中 → 完成；中止生效；未信任项目 agent 需勾选；结果进入父会话且主模型可引用。

---

## C. 权限设置页（可视化编辑 `permissions.json`）

### C.1 目标与边界

- 设置对话框新增「权限」面板，编辑 **全局规则文件** `~/.pi/agent/permissions.json`；保存 = 原子写文件，后端按 mtime+size 在下一次工具调用前重读，因此**保存即生效、无需重启**。
- 不做：会话权限模式（仍在输入框 `PermissionPicker`，D1 内存态）；`enabled` 开关（D7）；子智能体专属权限（其工具集来自 agent 定义，见 B）。

### C.2 页面结构

```
┌ 权限 ──────────────────────────────────────────────────────────┐
│ 规则文件 ~/.pi/agent/permissions.json   保存后下一次工具调用即生效 │
│ ⚠ 文件中 enabled=false：权限门控已关闭（仅可手改文件恢复）        │  ← 仅在 false 时出现
├ 工作区边界 ────────────────────────────────────────────────────┤
│ 工作区外读取（read/ls/show_image）   [allow ▾]                    │
│ 工作区外写入（edit/write）           [ask ▾]                      │
│ 系统临时区（tmpdir ∪ /tmp）          [allow ▾]  可放松 ask，不可放松 deny │
│ 项目内编辑自动放行                   [✓]  关闭后 edit/write 走审批坞 │
├ 工具规则 ──────────────────────────────────────────────────────┤
│ *（未列出的工具）  [allow ▾]                                      │
│ read  [allow ▾]   edit [ask ▾]   write [ask ▾]   webfetch [allow ▾] │
│ bash  [模式表 ▸]  ─────────────────────────────────────────────  │
│   #  模式                动作      （键序即评估序，后命中生效）       │
│   1  *                   allow                                   │
│   2  sudo *              ask     [↑][↓][✕]                        │
│   3  git push*           ask                                      │
│   …                                                              │
│   🔒 *permissions.json*  ask     自保护规则，不能设为 allow        │
│   [+ 添加模式]   试算：[ git push --force origin main ] → 命中 #18 ask │
│ [+ 添加工具规则 ▾（已知工具 / 自定义名）]                            │
├ 高级 ─────────────────────────────────────────────────────────┤
│ 审计日志 permission-audit.jsonl（fullAccess 高危操作）最近 20 条 ▸   │
│ [打开文件位置] [恢复默认]                    [放弃更改] [保存]      │
└────────────────────────────────────────────────────────────────┘
```

### C.3 行为细节

- **加载**：`permissions.load` 返回 `{ path, exists, raw, effective, defaults, mtimeMs }`；页面编辑的是 `effective`（默认合并后的完整视图），保存时只写用户可见的字段（不写 `enabled`，保留文件里原值）。
- **模式表顺序**：以数组编辑，保存时按顺序写 JSON 对象（JS 保持插入序；键为纯数字的模式会被引擎重排——校验时禁止纯数字键）。
- **自保护**：`*permissions.json* / *workspaces.json* / *auth.json* / *trust.json*` 四条锁定为 `ask`（UI 禁止改为 allow，`permissions.save` 二次校验拒绝）。
- **临时区层级**：`temporary` 选择器旁说明「可覆盖 ask，永不覆盖 deny」，与 `tmp-zone` 逻辑一致。
- **试算**：输入命令 → IPC `permissions.evaluate({ tool: "bash", input: { command } })` 用 `evaluateBashCommand` 返回命中规则与最终动作（命令链取最严段），非 bash 工具用 `matchTextFor + evaluateRules`。
- **冲突保护**：保存携带加载时 `mtimeMs`，不一致则提示「文件已在外部修改」，可选择重新加载或覆盖；写入采用 `tmp + rename`，保留一份 `permissions.json.bak`。
- **恢复默认**：写入 `DEFAULT_PERMISSION_CONFIG` 中用户可见字段（保留 `enabled`）。
- **后端小修**：`parseConfig` 目前不读取文件里的 `autoApproveProjectEdits`（由「是否存在 edit/write 规则」推导）。为让开关可持久化，改为**显式布尔优先、推导兜底**；补单测。这是唯一的后端语义变更，其余为读接口。

### C.4 数据流与代码落点

```
SettingsDialog ─▶ PermissionsPanel ─▶ stores/permissions.ts ─IPC─▶ main/ipc/permissions.ts
                                                            └─▶ @drone/backend permissions（parseConfig / mergeWithDefaults / evaluate* / permissionConfigPath / permissionAuditPath）
                                          写文件 ──▶ ~/.pi/agent/permissions.json ──(mtime+size)──▶ createPermissionConfigLoader 下次 tool_call 生效
```

- backend：`permissions/config.ts` 导出 `parseConfig`、新增 `serializeConfig`（只输出用户可见字段）、`validateConfig`（自保护 / 动作枚举 / 纯数字键）；`autoApproveProjectEdits` 解析修正。
- desktop main：`ipc/permissions.ts`（load / save / evaluate / reset / openLocation / auditTail）。
- renderer：`components/settings/PermissionsPanel.tsx`（+ `PatternTable.tsx`）、`stores/permissions.ts`、i18n、`SettingsDialog` 导航项。
- docs：`docs/permissions-settings.md`（字段含义、评估链、试算说明）；INDEX；CHANGELOG。

### C.5 测试与验收（PR 2）

- backend 单测：`parseConfig` 读取显式布尔；`validateConfig` 拒绝放松自保护、拒绝非法动作与纯数字键；`serializeConfig` 往返稳定且不丢 `enabled`。
- renderer 单测：模式表排序/增删后序列化顺序正确；保存按钮在校验失败时禁用；试算结果渲染。
- 冒烟：`scripts/check-permissions-ui.mjs`（对齐现有 `check-*-ui.mjs`）。
- 手测：保存后不重启，下一条 `git push` 命令按新规则弹/不弹审批。

---

## D. 分期与 PR 拆分

| PR | 内容 | 依赖 | 预计改动 |
| --- | --- | --- | --- |
| PR 1 | A · 示例任务（shared 数据 + 空态卡 + `/` 菜单项 + 表单 + 文档 + 测试） | 无 | shared ≈ 2 文件，desktop ≈ 5 文件，docs 2 |
| PR 2 | C · 权限设置页（backend 解析修正 + IPC + 面板 + 文档 + 测试） | 无 | backend 2，desktop main 2，renderer ≈ 4，docs 2 |
| PR 3 | B · 子智能体面板（批准后） | B.3 决策 | backend 2，main 2，renderer ≈ 4，docs 2 |
| PR 4（可选） | 输入框 `@` 选择器 | PR 3 | renderer 2 |

每个 PR 独立可合并，遵循 Conventional Commits 与 squash 合并；CI（lint / typecheck / test / test:upgrade / build）绿后合并。

## E. 需要你确认的决策

1. **示例入口**：任务页签空态 + `/` 菜单方向层「示例」项（推荐）；是否还要在设置 `WorkflowOverview` 增加入口？
2. **子智能体派发方式**：直接派发（B.3 ①，推荐）还是提示词派发（②）？
3. **权限页高级区**：是否包含审计日志最近 20 条（只读）？
4. **后端语义变更**：接受 `autoApproveProjectEdits` 改为「显式布尔优先、推导兜底」？
5. **PR 顺序**：默认先 PR 1（示例）再 PR 2（权限页）；如需先做权限页请说明。
