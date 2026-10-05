# Drone 上下文管理与 Agent Harness 升级设计

## 状态

本文件记录对 OpenScience 的架构解读和 Drone 的升级结果。上下文合同、真实 SDK 分支恢复、模型族/科学/回复提示词分层、受控 recall、失败重定向、交付物/预算观察和 worker attempt 追踪已经实现；后续只根据真实 trace 样本决定是否增加更细的 review 或 unattended 单元。

## 目标

Drone 已经有上下文蒸发、任务工作台、证据日志、知识扩展和子代理运行器，但这些能力分别挂在不同的 hook 和运行路径上。本设计把它们收拢到一个薄的 harness seam，使长会话、压缩恢复、交付物验收和子代理回收都拥有一致的外部状态。

升级重点不是复制 OpenScience 的全部 runtime，也不是增加固定的 planner/critic/checker 链路，而是让模型始终得到一份短、稳定、可验证的工作协议：

```text
识别目标和交付物
  -> 读取环境、规范和证据
  -> 选择工具和方法
  -> 保存中间事实、产物和失败原因
  -> 机械检查交付物和验收条件
  -> 继续、阻塞或结束
  -> 按回复契约报告结果
```

这条链引导的是可观察的工作过程，不要求模型暴露私有思维链。模型的上下文负责理解当前动作，runtime/harness 负责保存事实、执行边界和完成条件。

## OpenScience 如何引导模型思考和回复

### 1. 用分层 prompt 组装工作协议

OpenScience 不依赖一段单一的“大 system prompt”，而是把提示分成相互独立的层：

1. **模型族 header**：根据 provider/model 选择基础行为模板。
2. **科学工作约束**：要求先检查来源和文件，再作结论；重要数字必须由测量结果或来源支持；不覆盖原始数据；记录假设、参数和不确定性。
3. **response contract**：要求先给答案或结果，使用清晰的 Markdown 结构，避免重复，不把过程长度当成价值。
4. **agent/domain prompt**：主 agent、plan、explore、specialist 各自声明职责和权限。
5. **environment block**：当前项目、工作目录、会话、访问模式、日期、模型知识截止时间、结果目录和连接文件夹。
6. **skill index**：只提供技能目录和匹配提示，技能正文按需加载，不把整个技能库预装进上下文。
7. **tool contract**：工具的名称、参数 schema、权限和可见性由 runtime 决定。

这样模型收到的不是“请聪明地完成任务”，而是一个可执行的协议：在哪里工作、能做什么、哪些事实必须验证、哪些结果必须交付、回答应该如何组织。

### 2. 把“思考步骤”变成外部动作和状态

OpenScience 的科学提示词实际上把推理拆成一组可以观察和校验的动作：

- `Inspect before assuming`：先读输入、README、schema 和自检器。
- `Evidence before claim`：重要结论需要来源、测量值、脚本结果或明确的未知标记。
- `Deliverables before finish`：先识别用户点名的文件、格式、字段、单位、命名和约束。
- `Preserve work`：失败时保留中间产物和部分结果，不用“无法完成”替代已经得到的事实。
- `Acceptance before completion`：在最终回复前，对文件存在性、非空、解析、占位符、NaN/Inf、重复 ID 以及用户指定的测试命令进行机械检查。
- `Report limitations`：没有证据覆盖的范围要明确写出，不能把局部验证扩大成普遍结论。

这些规则不等价于要求模型输出逐步思维。模型只需要输出工具调用、中间结果和最终结论；“有没有先检查”“文件是否存在”“测试是否通过”由工具结果和 harness 记录。

### 3. 在上下文压缩时改变记忆形态，而不是简单截断

OpenScience 把 compaction 当成一次 handoff：

- 根用户请求和最新请求保持原文，避免目标在摘要中漂移；
- 旧工作转为结构化 handoff，包含 `Objective`、`Done/verified`、`In progress`、`Blocked/open`、`Delegated evidence`、`Next Move` 和 `Key Files & Artifacts`；
- 下一次模型调用只接收这个 handoff 和保留的近期尾部；
- handoff 明确禁止调用工具、回答其中的问题或引入新目标；
- 重复 compact 时更新已有 handoff，保留仍然成立的事实，移除过时细节。

因此，模型的“思考连续性”来自稳定的外部状态，而不是依赖完整 transcript 永久留在窗口中。Drone 当前的 compaction、todo reminder、task journal 和 evidence receipt 已经分别具备这些元素，但还缺少一个统一的 checkpoint 投影。

### 4. 用 harness 在 loop 边界上纠偏

OpenScience 的 harness unit 很小，每个 unit 只在它真正有信息的时刻介入：

- `loop.guard`：重复调用或连续失败时，给一次改变策略的重定向；再次触发则停止循环。
- `loop.before_finish`：在回合结束前检查交付物、验收命令、预算、无人值守策略和报告质量；发现明确缺口时追加一轮有界续跑。
- `tool` hooks：记录工具输入、输出、失败、权限和成本，把事实写入 trace。
- `worker` hooks：把子任务的 attempt、父子关系、产物和用量汇总到主任务。

关键点是“纠偏消息是状态驱动的”。例如交付物缺失时 harness 给模型一条缺失清单，模型再决定如何补齐；预算达到上限时 runtime 停止或提示，不让模型通过改写 prompt 自行扩大预算。

### 5. 最终回复由 response contract 和验收结果共同塑形

OpenScience 的最终回复约束很朴素，但与外部验收配合后效果明显：

- 先说结果或当前状态，再给必要解释；
- 使用标题、短段落和真正有并行关系的列表；
- 不重复概览、正文和结论；
- 引用文件、命令、数字和限制；
- 如果任务要求文件或测试，只有在文件和检查结果成立后才报告完成；
- 没有完成时报告已完成部分、阻塞原因和下一步，而不是泛泛道歉。

模型负责把事实组织成用户可读的答复，harness 负责防止“文字上完成、文件上未完成”。

### 6. 稳定合同、每轮姿态和动态状态是三种不同东西

对 OpenScience 当前实现更精确的描述是：

- `research` 和 `plan` 这两个主 agent 没有自己的 `agent.prompt`，通常使用模型族 header；`plan` 另外在每轮插入只读计划合同，所以它是“家族开头 + 每轮 plan contract”。
- `ml`、`biology`、`physics`、`chemistry`、`data`、`general` 等 specialist 有自己的 specialist prompt。非 Codex 路线下，这份 prompt 替代家族 header，但仍填入统一的 science contract 和领域技能索引。
- Codex 订阅路线把主 agent 的 prompt 放进 provider 的 `instructions`；worker 的 specialist contract 留在 conversation system context 中，从传输层避免同一份家族开头出现两次。
- effort、delegation、independence、plan/build 状态属于每轮姿态，不写死在家族 header。姿态通过 `<system-reminder>` 或等价的 system message 注入，并且权限模式始终优先。
- 预算、花费、研究状态和工具集合是动态事实。只有状态键改变时才追加持久的 harness message；相同提醒不重复追加。这样既让模型看到变化，也不让每一步都改写缓存前缀。

因此，Drone 的 prompt 设计也应分成三类：

1. **稳定合同**：模型族语气、科学/工程原则、回复格式和 agent 角色；
2. **每轮姿态**：努力程度、委托级别、独立性、plan/build 模式和当前阶段；
3. **变化状态**：预算、交付物缺口、证据状态、工具可见性、worker 结果和下一步。

把三者全部拼进一条不断变化的 system prompt，会同时增加上下文成本、破坏缓存并让模型难以分辨“长期规则”和“当前状态”。

## Drone 当前状态与缺口

Drone 已有的能力：

- `packages/backend/src/tools/context-evaporation`：按 token 预算做 snip/stub 和上下文事件；
- `packages/tasks/src/runtime/register.ts`：任务授权、状态、证据、自动续跑和 `context` 恢复；
- research/knowledge 扩展：研究证据和结果生命周期；
- `packages/backend/src/tools/subagent`：隔离子会话、权限 gate、并发槽、运行状态和结果回传；
- `SessionTraces`、Run Inspector 和 topic memory：保存运行、证据和跨会话导航信息。

缺口主要是组织方式：

1. 没有一个跨 context、task、research 和 subagent 的统一 checkpoint/ledger 契约。
2. 压缩后的可恢复状态分布在不同扩展中，根目标、交付物、证据、下一步和相关文件没有统一投影。
3. 已有任务续跑和子代理生命周期，但没有一个通用的 loop guard/before-finish 接口。
4. 工具 schema、能力包、技能和关键 prompt 的变化缺少统一 fingerprint，难以解释一次回复为什么与上一轮不同。
5. `todo`、证据和产物已经有保护逻辑，但缺少受控的历史 recall 来按引用恢复更早的工具结果。

## 已实现的升级

### A. Shared Harness Ledger

在 `packages/shared/src/harness` 定义不依赖 Pi SDK 的契约：

- `HarnessState`：objective、deliverables、findings、workState、nextMove、relevantFiles；
- `ContextCheckpoint`：checkpoint id、context epoch、来源引用、token 上限和更新时间；
- `HarnessEvent`：tool observation、evidence receipt、deliverable check、worker transition、compaction、continuation；
- `WorkerAttempt`：parent session、child session、attempt、status、usage、artifact/evidence refs；
- `ContractFingerprint`：model/provider、system/instructions hash、tool descriptions/schema、capabilities/skills 和 fingerprint。

Ledger 只保存 bounded navigation/state，不保存私有推理，不复制完整 transcript，也不替代 task/evidence/topic memory 的事实源。

### B. Session-engine Harness Adapter

在 `packages/backend/src/session-engine/harness` 提供 Pi SDK 适配层：

- `before_agent_start`：读取根请求，更新 objective/deliverables，生成有限的工作协议；
- `context`：生成 checkpoint 的增量投影，并交给现有 evaporation 做 token 预算；
- `tool_call/tool_result`：观察工具、失败、证据和产物，不改变现有权限语义；
- `session_compact`：保存 context epoch，恢复 checkpoint、todo、证据和交付物；
- `agent_end`：运行 harness units，决定完成、一次重定向、一次有界续跑或 blocked；
- session-engine 内提供薄的 `loop.guard` / `loop.before_finish` 适配接口。

### C. 最小 harness units

首版只接入四个单元：

- `redirect`：同一工具/阶段连续失败时最多重定向一次，第二次标记 blocked；
- `deliverables`：复用任务 acceptance，检查用户明确要求的文件和格式，最多两轮修复；
- `budget`：复用现有 task/specialist/subagent 预算，提供 50%/85% 提醒和硬停止；
- `workers`：把已有 subagent runner 的父子关系、attempt、usage、artifact/evidence refs 写进 parent trace。

contract fingerprint 和受控 recall 作为同一 seam 的基础能力提供，但不改变模型的权限和工具选择规则。

### D. Recall

增加一个边界明确的历史检索入口：

- 查询 compacted transcript、工具摘要、证据 receipt 和相关文件索引；
- 返回短片段、来源类型、message/tool id、文件路径和 hash；
- 默认按 session/project scope 限制，不返回 secrets、private reasoning 或大块日志；
- recall 结果不能直接生成 evidence，模型仍需重新读取当前来源并走现有 receipt 流程。

## 运行时数据流

```text
user request
  -> objective/deliverables extraction
  -> bounded prompt + environment + skills/tools
  -> model turn
  -> tool observations / evidence / artifacts / worker events
  -> checkpoint projection
  -> evaporation or compaction
  -> harness guard / acceptance / budget
  -> continue | blocked | final response
```

其中 prompt 的职责是告诉模型“当前要完成什么、能用什么、必须注意什么”；ledger 和 trace 的职责是保存“已经发生了什么、哪些证据成立、还缺什么”；harness 的职责是判断“现在能不能结束”。

## 实施边界

实现保持在 shared contracts 与 session-engine seam 内：复用现有 task/evidence/subagent/evaporation 实现，不搬运 OpenScience 的 provider、compute 或完整 server protocol。`context.ts`/`branch.ts` 负责真实 SDK entry 的恢复和 bounded checkpoint；`recall.ts` 提供只读历史导航；`guards.ts` 负责一次重定向和二次阻断；`delivery.ts` 复用 task acceptance 做 loop-boundary 观察；worker runner 把 attempt 写入父 trace。后续只根据真实 trace 样本决定是否增加 review、unattended 或更细的成本单元。

## 验收标准

- compact 后根目标、交付物、已确认事实、阻塞原因和下一步可以恢复；
- checkpoint 和 recall 输出有界，且带来源引用；
- todo、证据 receipt、交付物 acceptance 不会被普通蒸发裁掉；
- 重复失败只触发一次策略重定向，循环不会无限续跑；
- 交付物缺失时最终回复不能声称已完成；
- 子代理终态、用量、产物和证据引用能在主会话 trace 中回溯；
- contract fingerprint 能识别模型、工具 schema 或能力包变化；
- 不改变现有权限 gate、知识发布和 evidence receipt 语义；
- 通过 Drone 现有 typecheck、backend tests、architecture check 以及 context/subagent smoke tests。

## 参考

- [OpenScience README](https://github.com/synthetic-sciences/openscience)
- [OpenScience architecture](https://github.com/synthetic-sciences/openscience/blob/main/ARCHITECTURE.md)
- [Drone architecture index](../../INDEX.md)

## 单元开关与删除条件

Harness 单元默认全部开启。`harnessContext: false` 仍是向后兼容的总开关，会优先关闭全部单元；`harness` 可按单元覆盖。也可以用环境变量关闭单元，例如 `DRONE_HARNESS_DISABLE=guard,FamilyPrompt`（逗号分隔、大小写和空格不敏感），或用 `DRONE_HARNESS_DISABLE=all` 关闭全部；未知名称会被忽略并记录一次 warn。

| 单元 | 开关名 | 删除条件 |
|---|---|---|
| context | `harness.context` | SDK compaction 能恢复目标、交付物和下一步后删除 |
| recall | `harness.recall` | 现有会话/任务索引能覆盖历史导航且评测集不再需要受控 recall 后删除 |
| guard | `harness.guard` | Pi SDK 原生提供循环保护后删除 |
| delivery | `harness.delivery` | 任务 acceptance 在 loop boundary 已能稳定阻止未完成交付声明后删除 |
| familyPrompt | `harness.familyPrompt` | 关闭后评测集通过率不下降即删除 |
