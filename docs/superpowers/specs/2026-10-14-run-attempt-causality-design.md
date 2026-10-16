# RunAttempt / causation lineage design

## Status

设计已确认，基于 Drone v0.32.0（`022d0eac`）重新核对后修订。C1-1 至 C1-6 已在集成分支实现；普通 session 以每次 `agent_start` 建立脱敏 attempt 根并注入 intent journal。完整仓库门禁仍需区分源码结果与本机监听/子进程环境限制。

## 当前代码基线

- `packages/shared/src/research-contracts.ts` 已提供 `VersionedRecord`、`parentRefs`、内容哈希、`DecisionProposal`、`Decision` 和 `RunAttempt`。`RunAttempt.id` 是现成的 attempt 身份；`unknown → queued` 已经是显式恢复边界。
- `packages/shared/src/execution.ts` 提供 `ExecutionReceipt` / `ComputeTaskBinding` schema，但 backend 的实际分析执行绑定是 `packages/backend/src/services/analysis-orchestration.ts` 中的 `AnalysisComputeBinding`。
- `packages/backend/src/session/intent-journal.ts` 在工具 effect 前同步写 start，之后写 end/output；`session-construction.ts` 为每次 `agent_start` 建立当前 attempt context，普通 session 的工具记录也带脱敏 lineage。
- `packages/backend/src/services/analysis-evidence.ts` 的 checkpoint ID 是内容寻址 hash，capsule 和 import/replay 都验证该 ID；lineage 不能改变既有 checkpoint ID。
- `packages/compute/src/types.ts` 的 `JobSpec`、`SubmissionRecord` 和 direct scheduler 已有幂等/未知态边界，但没有 attempt/cause 字段。

## 目标语义

### `runAttemptId`

`runAttemptId` 表示一次可恢复的执行尝试。`RunAttempt.id` 直接作为 canonical ID；新生成的 ID 使用 `run:` 前缀加 opaque UUID，旧 ID 原样保留。

- 同一 attempt 的 reconcile、恢复、checkpoint、review 不换 ID。
- 外部效果为 `unknown` 时只做 reconcile，不创建新 attempt。
- 只有确认可以安全重试时才创建新的子 attempt；父关系使用已有 `RunAttempt.parentRefs`，记录 `{ kind: "run-attempt", id, revision, contentHash }`，不新增重复的 `parentAttemptId` 字段。
- branch、重新授权后的新执行和 replay 都创建新 attempt；`attempt` 数字只表示序号。

### `eventId` / `causationId`

每个新产生的持久记录都有自己的 `eventId`；`causationId` 指向直接父记录的 `eventId`。已有事件日志的 `id` 可以作为其 `eventId` 投影，避免重复存储。

```ts
type CausalEnvelope = {
  schemaVersion: 1;
  eventId: string;
  causationId?: string;
  runAttemptId?: string;
};
```

`runAttemptId` 是相关性，不是权限；`causationId` 是因果关系，不是 `idempotencyKey`。lineage 不能授予权限、延长授权、刷新证据新鲜度或替代 proposal/decision hash。

## Hash、版本和兼容边界

这是本次复核后的关键调整：研究合同和 evidence checkpoint 都有内容寻址身份。

- `VersionedRecord.lineage` 是可选的 additive envelope；`computeResearchContractHash` 明确排除 lineage，现有 schema v1 记录无需批量重写。
- `DecisionProposal` / `Decision` 的业务内容 hash 不因补写 lineage 改变；现有 freshness、scope hash 和 proposal 引用检查继续有效。
- `EvidenceCheckpoint.lineage` 不进入 `checkpointId` 的 canonical body；旧 capsule、blob 和导入路径保持兼容。
- 旧 intent、receipt、checkpoint 缺少 lineage 时保留缺失或标记 partial/legacy，不依据时间、文件名或日志顺序猜测父子关系。

## 对象映射

| 对象 | 接入方式 | 保留的本地职责 |
| --- | --- | --- |
| `RunAttempt` | `VersionedRecord.lineage`；子 attempt 使用 `parentRefs` | `id`、状态机、`attempt`、决策引用、幂等键 |
| `DecisionProposal` / `Decision` | 增加可选 lineage；不进入业务 hash | proposal/decision 内容、scope、freshness |
| `AskDecisionProposal` / `AskDecision` | renderer-safe projection 增加可选 lineage | IPC 仍只传安全投影 |
| `AnalysisComputeBinding` | 持久化 `runAttemptId` 与 envelope | job/spec/adapter/workflow/method hash 绑定 |
| `ExecutionReceipt` / `ComputeTaskBinding` | shared schema 增加可选 envelope | `executionId`、`jobId`、remote ID、preflight |
| `JobSpec` / `SubmissionRecord` | compute 领域类型携带可选 envelope；direct runner 原样传播 | idempotency ledger、remote ID、unknown reconcile |
| intent journal | start/end/output 每条生成 event ID；end/output 的 cause 指向 start/上一记录 | `toolCallId`、args hash、replay policy、fsync 语义 |
| checkpoint / replay receipt | checkpoint lineage 从 analysis binding 继承；replay 新建 attempt | content-addressed bytes、环境/输出复现判断 |

## C1 实施计划

### C1-1：shared lineage contract

- [x] 新增 `packages/shared/src/causality.ts`：`CausalEnvelope`、安全 ID 校验、确定性子事件派生和 backend 可注入的 ID 生成接口。
- [x] 从 `packages/shared/src/index.ts` 导出该模块。
- [x] 更新 `research-contracts.ts` 的 `VersionedRecord`、proposal/decision/RunAttempt 类型和 hash 排除逻辑；验证 lineage 不能绕过 `assertResearchContract`。
- [x] 更新 `execution.ts`、`ask.ts`、`analysis-orchestration.ts` 的安全投影类型。
- [x] 增加 shared 测试：ID 校验、hash 稳定性、unknown 恢复仍保持 attempt、父 attempt 只通过 `parentRefs` 表达。

### C1-2：attempt 根与 backend binding

- [x] 在 `AnalysisTaskController.prepareCompute` 形成可执行 scope 时创建 `runAttemptId` 和根 event；将 envelope 写入 `AnalysisComputeBinding`。
- [x] `AnalysisOrchestrationService` 在 readiness、submit、review、reconcile 读取并保留同一 binding lineage。
- [x] provenance 携带 lineage；fork checkpoint 保持空的 execution binding，不能继承父 attempt。
- [x] 旧 ledger 缺字段时双读兼容；新写入全部带 lineage。

### C1-3：副作用、receipt 与 scheduler

- [x] `ExecutionReceipt` / `ComputeTaskBinding` schema 和 compute `JobSpec` / `SubmissionRecord` 增加 envelope。
- [x] `DirectRunner` 和 backend ComputeService 传播并投影 `runAttemptId` / `causationId`；事件已有 `id` 时将其作为 event ID。
- [x] 保持现有幂等约束：unknown 不盲重试，确认安全后才创建子 attempt。
- [x] 增加重复提交、锁丢失、远端 ID 恢复和 unknown reconcile 测试。

### C1-4：intent journal、checkpoint 与 replay

- [x] intent journal start 在 effect 前带 envelope fsync；end/output 生成新 event ID，并把 cause 指向同一调用的上一条记录。
- [x] `bindToolIntentJournal` 支持注入当前 causal context；普通 session 按每次 agent run 建立 attempt 根，未开始 run 的历史/内存会话仍兼容无 lineage。
- [x] checkpoint 从 analysis provenance 的 attempt lineage 派生，并从 checkpoint hash 输入中排除 lineage。
- [x] replay receipt 创建新的 `runAttemptId`，引用 checkpoint event；branch 不继承 execution binding、approval 或 review。

### C1-5：只读 lineage projection

- [x] 提供 backend/host 只读 projection：按 `runAttemptId` 聚合 binding、receipt、intent、checkpoint、replay；按 `eventId` 查询直接父关系。
- [ ] 如需 IPC，再同步 shared host-api → preload → main IPC → backend；首版只暴露脱敏 ID、状态和时间。
- [ ] 不暴露 intent 原文、会话正文、凭据、Vault 正文或私有结果。

### C1-6：迁移收尾与文档

- [x] 对旧 RunAttempt 直接采用 `id`；旧 receipt/checkpoint/intent 只做可证明映射，无法证明则保持 partial/legacy。
- [x] 完成 crash/restart、unknown reconcile、retry/branch、hash 兼容和 capsule import/replay 回归；legacy replay 始终创建新的 run attempt。
- [x] 更新 `docs/INDEX.md`、`docs/architecture-v2-tasks.md`；本轮未引入新的失败模式，无需追加 `docs/PITFALLS.md`。
- [ ] 实现完成后运行完整 DoD：源码 lint、typecheck、build、check:arch 已通过；完整测试仍有本机监听权限、子进程模块解析和外部 fixture 的环境失败，远程 `main` CI 保持绿色。

## 非目标

- 不合并 RunAttempt、ExecutionReceipt、intent journal、compute job 或 checkpoint 的账本。
- 不用 lineage 替代授权 scope、内容 hash、幂等键或远端 job ID。
- 不为了完整图谱推断历史父子关系。
- 不在第一阶段把完整 lineage 强行展示到 renderer。
