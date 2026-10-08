# 任务路由过程看板设计

## 目标与范围

这是一个只读的过程投影，用 Todos 项目看板的列式布局呈现当前会话中任务路由的推进位置。它不替代任务账本，也不新增任务状态、授权、验收或持久化；卡片只回答“这件任务现在由谁/什么节点处理、走到哪一步、为什么停住”。

看板以当前会话为边界，数据来自已有公开 transcript：`TurnRoute`（`packages/shared/src/turn-route.ts`）、`TaskView`/`WorkbenchTask`（`packages/shared/src/task-workbench.ts`）以及 `deriveProcessEvents`（`packages/shared/src/process-lanes/events.ts`）提取的工具、子智能体和研究回执。项目级跨会话汇总留给后续产品决策。

## 列与进入规则

列顺序固定为：

`todo → queued → planning → confirm → plan_reviewing → building → review → implement_reviewing → done → failed → closed`

| 列 | 进入条件 | 离开条件 |
| --- | --- | --- |
| `todo` | 有用户任务输入，但还没有有效 `TurnRoute` | 路由记录出现，或该输入被判定为 `status`/`read-only` |
| `queued` | 有有效路由，尚未出现任务契约或执行回执 | 开始建任务、等待确认或出现公开执行回执 |
| `planning` | 已有 `primary`/`stage`，任务仍在计划建立或准备 | 需要确认、进入计划审阅或开始执行 |
| `confirm` | `selectionRequired`、`authorizationRequired`，或原因码为 `task-authorization-required` | 用户确认、取消，或宿主明确拒绝 |
| `plan_reviewing` | `TaskView`/`TurnRoute.host` 表示计划或路由待审阅 | 审阅完成并开始执行，或转为失败/关闭 |
| `building` | `WorkbenchTask.state === "running"`，或存在公开工具/子智能体执行回执 | 进入过程复核、交付验收、失败或关闭 |
| `review` | 有公开结果待复核，例如回答检查、预算复核或过程回执确认 | 复核完成、进入人工验收、失败或关闭 |
| `implement_reviewing` | 有产出但存在 `TaskUserAction.kind === "review"` 的待处理动作 | 人工验收完成、失败或关闭 |
| `done` | 任务完成、所有里程碑已接受、无未决操作 | 只允许被后续新任务替代，不回拖旧卡 |
| `failed` | 宿主确认终止性失败，或任务明确不可恢复 | 只允许重新描述需求建立新卡 |
| `closed` | `cancelled` 或 `archived` | 终态 |

`blocked`/`error` 是卡片叠加标记，不是额外列。`TaskView.state === "blocked"`、工具失败、`reconcile-before-retry` 或未知副作用会保留卡片原阶段并显示原因；只有宿主确认不可恢复时才进入 `failed`。`planApproved` 只改变确认标记，不等于执行成功。

`status` 和 `read-only` 输入只更新既有卡片的最近活动，不创建新卡；`continuation` 保留原卡片和阶段，只有新的公开回执才能推进阶段。无有效 `TurnRoute` 时不得根据当前模型、技能库存或自然语言猜测分派。

## 卡片与操作

卡片固定显示四组信息：

1. **任务**：用户目标摘要、当前列、会话轮次和稳定的任务 id（若已建立）。
2. **路由/分派**：`TurnRoute.primary`、`stage`、`landing`、`intake`、能力标签；没有明确主节点时显示“未分派”，不虚构人员或模型负责人。
3. **过程**：最近公开工具/子智能体回执、`progressCount`、阶段调用数/总调用数、已接受/总里程碑数。
4. **异常**：`WorkbenchTask.reason`、`TurnRoute.host.reason`、工具失败码和等待动作；保留技术码并用现有 `explainTaskReason` 提供人类可读说明。

卡片只提供“查看过程”和“打开任务”两个导航动作，分别定位现有 `ProcessPane` 和 `TasksPane`。看板不支持拖拽换列、授权、重试、取消、提交文件或核对产物。

## 与现有任务系统的边界

- `TasksPane` 继续负责 todo 清单、授权提示、`DecisionsSection`、`TaskRow` 的里程碑/操作/产物详情；过程看板只读这些公开投影，不复制其详细内容。
- `ProcessPane` 与 `process-lanes` 继续是运行过程的事实投影；看板只把过程节点压缩成列卡片，不建立第二本过程账。
- 不新增 IPC、backend service、JSON 文件、任务状态枚举或 renderer 插件 API；草图中的 `data-stage` 只是将来接入时的显示契约。
- 不展示思维文本、产物正文、决策正文、审稿正文或知识沉淀详情；需要这些内容时通过现有任务/过程/产物入口查看。

