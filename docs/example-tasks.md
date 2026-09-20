# 六方向示例任务

> 设计来源：`docs/design-example-tasks-subagent-ui-permissions.md` §A。本文说明六个内置示例、入口与消息模板，以及如何新增/修改示例。

## 定位与边界

- 每个工作流方向（`WORKFLOW_DIRECTIONS`）**恰好一个**可一键发起的示例。示例是**导航与配置**，不是新的提示词体系：它只把用户带到正确的阶段命令，并给 `task_plan` 一份结构化的开场。
- 点击「发起」= 在当前会话发出**一条普通首条消息**（与输入框同一条发送路径：`ensureActiveSession()` → `getPi().prompt()`）。模型据此调用 `task_plan`，用户在授权卡确认后才开始执行。
- 示例**不会**：预先创建任务、写任何文件、自动执行命令、自动填充用户私有路径、自动选择模型。
- 只读会话（子代理产物检视）不显示示例卡，也不能发起。

## 六个示例

| id | 方向 | 阶段（首条命令） | 用户输入（* 必填） | 里程碑 → 验收 | 边界 |
| --- | --- | --- | --- | --- | --- |
| `planning-hypotheses` | 研究规划与设计 | ideation → methods（`/skill:hypothesis-generation`） | 研究问题*；背景材料路径 | 问题澄清与边界 → `human_review`；竞争假设与判别证据清单 → `file`（hypotheses.md）；实验设计草案 → `file`（design.md） | 不声称已完成任何实验 |
| `evidence-literature` | 文献证据与知识管理 | search → reading → library（`/skill:nature-academic-search`） | 主题/关键词*；时间范围；是否放入 Zotero（默认否） | 检索范围与命中清单 → `file`；精读 2–3 篇的证据卡 → `file`；（选「是」时）精读文献逐篇进入 Zotero → `zotero_item`（每篇一个里程碑，DOI 留空，精读写入后由宿主按回执绑定；写错可 `task_wait kind=rebind`） | 命中不等于已读；Zotero 写入需要单独同意 |
| `analysis-explore` | 数据分析与专业计算 | explore → statistics（`/skill:exploratory-data-analysis`） | 数据文件路径*；研究问题/分组变量* | 数据质量报告 → `file`；分析计划与检验结果 → `file`；结果解读确认 → `human_review` | 只披露实际执行过的检查 |
| `writing-section` | 论文写作与审校 | writing → review（`/skill:scientific-writing`） | 章节*；素材/证据卡路径；目标期刊 | 章节初稿 → `file`；审校意见（证据受限）→ `file`；用户确认修改 → `human_review` | 只完成所请求的章节，不强行走完整流程 |
| `presentation-figures` | 可视化与成果交付 | figures → slides（`/skill:scientific-visualization`） | 结果/数据文件*；目标格式（pptx/pdf，默认 pptx） | 真实数据图（含不确定性）→ `file`；汇报幻灯片 → `file`；交付检查 → `human_review` | AI 示意图不是数据图 |
| `engineering-handoff` | 工程集成与协作 | resources → handoff（`/skill:get-available-resources`） | 项目路径*；交接对象 | 计算资源清单（只盘点）→ `file`；spec / plan / HANDOFF → `file`；确认无安装、付费、外发 → `human_review` | 不安装、不预订资源、不外发 |

「将遇到的确认」按 `authorizations` 提示：`task`（任务授权卡）在每个示例都有；`zotero-write` 只在文献示例出现；`external-delivery` 预留给需要外发/推送的示例。

## 入口

1. **右栏「任务」页签空态**（`components/tasks/ExampleTaskCards.tsx`）：「还没有任务 —— 从一个示例开始」+ 六张卡（方向标签 / 标题 / 一句话目标）。
2. **输入框 `/` 菜单方向层**（`composer/slash-filter.ts` 的 `workflowMenuItems`）：每个方向的阶段行之后追加一行「示例：<标题>」。它复用该方向开场阶段解析出的真实命令；该 skill 未在当前会话注册时与阶段行一样置灰。
3. 两处都只打开 **示例对话框**（`components/tasks/ExampleTaskDialog.tsx`，状态在 `stores/example-tasks.ts`）：
   - 输入项：必填校验（点「发起」/「插入」时标红）、`path` 类输入给「选择文件 / 选择文件夹」按钮（IPC `file:pickPath`，只返回路径不读内容）、`select` 类给下拉；
   - 只读的里程碑预览（条件里程碑随输入变化，如「是否放入 Zotero」）与「将遇到的确认」；
   - 按钮：「复制消息」「取消」「插入到输入框」「在当前会话发起」；无活跃会话或草稿会话时主按钮变为「新建会话并发起」（复用 draft → session 流程）。发送中禁用。

## 消息模板

`composeExampleTaskPrompt(task, values, language)`（`packages/shared/src/example-tasks.ts`，纯函数，有单测）：

```text
/skill:hypothesis-generation 【示例任务 · 研究规划与设计 · 从研究问题到可判别假设】
目标：把一个研究问题澄清为若干竞争假设，列出能区分它们的证据，并给出实验设计草案。
输入：研究问题=…；背景材料路径=（未提供）
请先用 task_plan 建立任务并等待我的授权，再开始执行：
  1. 问题澄清与边界（验收：human_review）
  2. 竞争假设与判别证据清单 → hypotheses.md（验收：file）
  3. 实验设计草案 → design.md（验收：file）
边界：不声称已完成任何实验；阶段契约：Question, rival hypotheses, discriminating evidence; no claim of completed experiments.
```

注意首行是 `/<command> <标题>` **同一行**：SDK 的 `/skill:name args` 展开以第一个空格结束 skill 名，标题之后的所有内容作为参数传给 skill。英文界面使用同结构的英文标签。

## 如何新增或修改示例

1. 编辑 `packages/shared/src/example-tasks.json`，字段见 `ExampleTask`（`example-tasks.ts`）：
   - `direction` 必须是 `WORKFLOW_DIRECTIONS` 之一，且每个方向只能有一个示例；
   - `stages` 必须都存在于 `WORKFLOW_STAGES` 且属于同一方向；`command`（可省）必须是首个阶段 `commands` 之一，省略时取第一条；
   - `inputs[].kind` ∈ `text | path | doi | select`；`path` 可用 `pathKind`（`file | directory | any`）决定给哪种选择器；`required: true` 的输入不能有 `defaultValue`；
   - `milestones` 固定 3 条，`acceptance.kind` ∈ `file | human_review | zotero_item | wiki_review`（`hint` 是建议文件名）；`when: { input, equals }` 让某条里程碑只在输入取某值时出现；
   - `authorizations` 必含 `task`；`artifacts` 与 `contractNotes` 仅用于提示。
2. 运行 `npx vitest run -w packages/shared` 与 `-w packages/desktop`：`example-tasks.test.ts` 会校验以上约束，`components/tasks/example-tasks.test.ts` 会校验空态卡数量与对话框渲染。
3. 无需改 UI 代码：卡片、菜单项与对话框都从数据渲染；界面文案在 `i18n/zh.ts`、`en.ts` 的 `examples.*`。

## 相关测试

- `packages/shared/src/example-tasks.test.ts`：方向全覆盖且各恰一个、阶段/命令引用完整、验收与输入种类合法、必填无默认、消息模板（首行格式、条件里程碑、双语、不泄露路径）。
- `packages/desktop/src/renderer/src/components/tasks/example-tasks.test.ts`：空态六张卡、对话框输入/里程碑/确认渲染、无会话时主按钮文案、只读会话禁用。
- `packages/desktop/src/renderer/src/components/composer/workflow-menu.test.ts`：方向层末尾的示例行与阶段行同源解析、SDK 未注册时置灰。
