# Drone 历史 PR 与架构升级审计

> 审计日期：2026-10-12  
> 仓库：[Gyoungwe/Drone](https://github.com/Gyoungwe/Drone)  
> 本地基线：`b96b619 feat(analysis): add adapter contracts and evidence lifecycle`

这份报告把仓库历史 PR、当前分支已经落地的能力，以及上一轮架构设计会话提出的下一阶段模型放在同一张图里。此轮只整理审计，不修改产品代码。

## 结论先行

历史 PR 已经形成六组能力：会话持久化、知识沉淀、科研与生信能力、任务与授权、架构/扩展性、平台与发版。继续逐个重做 PR 会重复实现，也会把状态和权限重新摊回 IPC 与 renderer。

建议把后续工作收敛为三条产品主线：

1. **知识沉淀流程**：研究来源 → `KnowledgeSnapshot` → 知识条目 → 证据等级 → 可复用索引 → 新任务引用。
2. **通用生信能力**：能力缺口 → agent 研究 → 候选 adapter/workflow → fixture 与科学验证 → 推荐版本 → 明确授权后执行。
3. **动态决策卡片**：上下文 → `DecisionProposal` → 方案比较 → 用户选择 → 独立授权 → 可审计执行。

三条主线由上一轮架构会话提出的 `ResearchCase` 串联：

```text
ResearchCase
├── AgentRun
├── KnowledgeSnapshot
├── CapabilityRequest / CapabilityVersion
├── DecisionProposal / Decision
└── Analysis
    ├── WorkflowBinding
    ├── RunAttempt
    ├── ArtifactVersion
    └── EvidenceCheckpoint / EvidenceCapsule
```

## PR 分组审计

### 1. 会话持久化、恢复与副作用安全

**主要 PR：** #20、#21、#35、#41、#42、#94、#106–#112。

**已经形成的基础：**

- 工具意图日志、safe/unsafe 重放分类和中断工具恢复。
- 长时工具部分输出节流刷盘。
- 排队消息持久化、`requestId` 去重和崩溃恢复。
- 版本化状态文档与迁移。
- 外部研究副作用幂等键、重复归档保护和冲突核对。
- 任务 checkpoint、失败熔断和未知状态处理。

**审计判断：** 这是当前系统最成熟的可靠性底座，#106–#112 是有顺序依赖的连续系列，应该作为已落地基础复用，不能重新拆成另一套 durable 状态系统。

**仍需收敛：** durable 记录、task ledger、analysis ledger 目前仍有不同语义。下一轮应让 `RunAttempt` 成为一次执行的统一投影，把 `unknown`、`delivery_failed`、`replay-failed` 作为可恢复状态，而不是各模块私有字符串。

### 2. 知识沉淀、研究证据与知识网络

**主要 PR：** #12–#17、#19、#26、#36、#44、#55、#59–#61、#66、#73–#74、#81–#82、#85、#88、#92、#96–#104、#110、#113。

**已经形成的基础：**

- 本地优先 Vault、项目身份解析、分类器、frontmatter 和来源回执。
- 研究发现、知识网络、出链/反链扩展和观测台式图谱。
- Zotero 独立入口、本地写入、收据发布和冲突核对。
- WebDAV 显式 Pull/Push、ETag、冲突与离线边界。
- 云端知识库设计、脱敏科研夹具和模拟用户测试报告。
- #110/#113 代表当前知识观测台和 WebDAV 工作区的最新产品方向。

**审计判断：** 知识库已有“能写入、能检索、能展示、能同步”的能力，但“沉淀为什么可信、什么时候可以复用、复用后是否过期”还没有成为一个独立流程。

**下一步缺口：**

- 引入 `KnowledgeSnapshot`，只记录本轮真正读取过的来源、版本、摘要和 receipt。
- 区分 `navigation-only`、`evidence-eligible`、`validated-capability`、`reproduced-capability` 四个复用等级。
- 增加来源新鲜度、方法版本和输入 manifest 匹配检查。
- 让新知识条目和 Analysis/Evidence checkpoint 互相引用，而不是只按项目或关键词检索。

### 3. 生信与科学计算能力

**主要 PR：** #36、#38–#39、#44–#45、#58、#62–#65、#76、#79–#80、#86、#89、#91、#93，以及本地提交 `b96b619`。

**已经形成的基础：**

- 生信能力路由和环境感知。
- 本地/远程环境登记、SSH/Nextflow 入口和大文件保护。
- 公共数据库只读检索。
- 系统发育树、多序列比对、交互式图和结果查看器。
- 当前分支新增 `AnalysisAdapter/Registry`、provenance、assembly QC、checkpoint/evidence capsule、import/replay。

**审计判断：** 当前已从“预置 Pasilla/RNA-seq 规则”迈向 adapter contract，但还没有完成“没有预置流程时由 agent 研究并生成推荐能力”的闭环。

**目标闭环：**

```text
CapabilityRequest
  → research sources / environment probe
  → CapabilitySpec
  → staged adapter/workflow candidate
  → static + fixture + scientific validation
  → validation evidence capsule
  → recommended capability
  → exact capabilityId@version
  → user authorization
  → RunAttempt
```

`recommended` 只能进入后续 Proposal，不能自动执行；只有精确版本、环境 readiness 和明确授权同时满足时才进入 Compute。

### 4. 任务、方案、审查与授权

**主要 PR：** #21–#24、#29–#32、#34–#37、#46–#48、#52–#56、#83、#95。

**已经形成的基础：**

- task plan、不可变绑定、预算、授权和任务过程看板。
- `ask_user` 已支持推荐值、理由、置信度、依据和自定义文字。
- 审查卡、决策账本、交付审查、任务路由和子智能体入口。

**审计判断：** 当前 `PlanProposal` 仍把 `defaultValue` 作为问题必填字段；这会把 agent 的推荐误解成固定答案。任务选择、普通澄清和高风险授权也没有完全分离。

**目标合同：**

```text
DecisionProposal
├── contextSnapshot
├── findings[]
├── candidates[]
│   ├── expectedBenefit
│   ├── tradeoffs
│   ├── resources
│   ├── risks
│   └── authorizationActions[]
├── recommendation?
├── questions[]
└── expiresAt
```

规则是：普通澄清可以没有推荐；有推荐必须同时有理由和依据；推荐不是默认提交值；远程写入、代码执行、依赖安装、破坏性编辑和发布必须单独请求明确授权。用户响应要保存 proposal hash、实际选择、备注和 authorization scope hash。

### 5. 架构深模块、扩展与 UI seam

**主要 PR：** #15、#27、#40、#45、#54、#75、#84、#96、#110。

**已经形成的基础：**

- optimistic update、统一 `INVOKE_ROUTES`、插件声明式 hooks、publication fail-closed。
- turn-route、任务过程看板、知识观测台和多入口 UI。

**审计判断：** 历史上已经多次做过深模块重构，但领域状态仍可能从 backend、IPC 和 renderer 各自投影。下一轮固定四个深模块 seam：

- `CapabilityRegistry`：能力版本、环境 readiness、候选验证和推荐。
- `DecisionProposal`：方案、问题、用户选择和授权动作。
- `EvidenceLedger`：artifact、checkpoint、capsule、branch、replay。
- `KnowledgeReuseIndex`：知识快照、证据等级、新鲜度和可复用命中。

renderer 只消费投影，不理解 backend 实体、executor callback、capsule bytes、credential 或未经授权的远程路径。

### 6. 平台、发版、测试与运营硬化

**主要 PR：** #1–#2、#18、#25、#28、#33、#43、#49–#51、#53、#57、#67–#72、#77–#78、#89–#90、#97–#105。

**已经形成的基础：**

- Linux/macOS/Windows 打包和发布矩阵。
- 大文件上传、Pi MCP 运行时 staging、Windows/SQLite 修复。
- 许可、发版前检查、模拟用户测试分类和脱敏科研夹具。
- WebDAV 认证顺序、空 usage stats、知识索引和 UI smoke 修复。

**审计判断：** 这些 PR 主要解决交付可靠性，不应与领域模型升级混在一个实现批次中。它们应作为每个主线完成后的硬化门：typecheck、build、lint、check:arch、fixture、desktop E2E 和敏感信息扫描。

## 当前分支与历史 PR 的整合关系

- 当前分支已经包含知识观测台/WebDAV 工作区的本地提交，以及 durable #106–#112 的历史基础。
- 本地 `b96b619` 已把 AnalysisAdapter/Registry、provenance、assembly QC、checkpoint/evidence capsule 和桌面 Evidence UI 接到一起。
- PR #113 是当前 GitHub 查询中唯一 open 的 PR，主题是 research observatory graph 与显式 WebDAV sync；本地已有对应方向的提交，应以当前工作树为准做差异核对，不再重复实现同一功能。
- 没有检索到 #3–#11 的 PR 条目；它们不作为本轮待办。
- 历史设计 PR（如 #95、#98、#99）应作为约束和验收来源，不直接当作新的代码分支重放。

## 推荐的整理升级顺序

### P0：建立统一合同，不改变现有用户路径

- 定义 `ResearchCase`、`KnowledgeSnapshot`、`CapabilityRequest`、`CapabilityVersion`、`DecisionProposal`、`Decision`、`RunAttempt`。
- 将旧 `PlanProposal`、`AnalysisContext`、durable 文档、Evidence checkpoint 映射到统一 hash、revision 和 parent refs。
- 明确迁移、过期、分支隔离和授权失效规则。

### P1：把知识沉淀做成可复用流程

- 研究来源产生 snapshot 和 receipt。
- 只有 evidence-eligible 以上的记录才能进入复用索引。
- 新任务引用知识时校验 assay、输入 manifest、方法/工具版本、reference/database release 和 evidence freshness。
- EvidencePane 从当前 Analysis 自动打开 checkpoint、branch 和 replay，不再要求用户手填 ID。

### P2：让未知生信流程生成推荐能力

- 未命中 Registry 时创建 capability gap，禁止直接提交计算。
- agent 只读研究工具文档、论文、输入输出格式、许可证、数据库 release 和环境要求。
- 在隔离 workspace 生成候选 adapter/workflow，执行静态、fixture、科学三类验证。
- 生成 validation capsule，并把结果标为 `recommended`；注册和启用仍然分开。

### P3：替换固定答案式提问

- `ask_user` 与 task plan、授权确认统一投影成 Proposal Card。
- 方案卡显示推荐、依据、收益、代价、风险、资源和副作用授权动作。
- 普通澄清不生成固定答案；用户可选择其他方案、输入自定义文字或要求 agent 继续解释。
- proposal、输入证据、预算、能力版本或 workflow hash 变化时，旧授权自动失效。

### P4：硬化与归档

- 每条主线完成后执行完整 workspace 验证和桌面 E2E。
- 为未知 assay、错误输入、缺失输出、环境变化、未知远程状态和 replay 不匹配补 fixture。
- 将重复入口、过时默认值、旧 UI 投影和无来源的历史字段标记为 deprecated，再分批删除。

## 本轮明确不做

- 不重放全部历史 PR。
- 不把旧 PR 的设计文档直接当作新的产品合同。
- 不在 Proposal 还没有统一前继续增加新的固定问题卡。
- 不把 `recommended` 能力直接注册为可执行能力。
- 不把 `.archify/` 生成物、远程凭据或测试服务器私有结果纳入代码提交。

## 建议验收指标

- 一个没有预置 adapter 的 assay 能走完“研究 → 候选 → 验证 → 推荐 → 授权 → 执行 → evidence capsule”。
- 知识条目能显示来源 receipt、证据等级、新鲜度和复用限制。
- 用户看到的是上下文方案比较，推荐不会自动变成提交值。
- 远程写入、安装、执行、破坏性编辑和发布均有独立授权记录。
- 重启后可从 ledger/event cursor 恢复，不重复提交未知副作用。
- `npm test`、`npm run typecheck`、`npm run build`、`npm run check:arch` 和桌面 E2E 在每个主线提交后都可复现。

