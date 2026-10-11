# OpenScience 与 Wisp Science：对 Drone 生信适配与可复现性的研究笔记

- 研究日期：2026-10-11
- 范围：仅使用一方产品文档、官方仓库/规范、标准组织页面和论文；不修改实现代码。
- 目标：比较 synthetic-sciences/openscience 与 xuzhougeng/wisp-science 的一方源码/文档，并映射到 Drone 的 `AnalysisAdapter`/Registry、assembly 适配器和 artifact/provenance 边界。
- 证据级别：以下产品行为均是官方文档或源码观察，**不是本机运行验证**。OpenScience 检索快照为 `a7b9fa3a8c1bd52a9a0c171de58bc14759a0f850`，Wisp 官方仓库快照为 `565deb134343dad98b9b231f7aba80b72a70655f`。父任务 REA 只确认本机 Wisp 为 v1.9.0、arm64 Mach-O（sha256 `61730c3a239b40dc6ed02b5091a11d1f4bc4990f5a6ebc2f0c69dfdc2ac5e9de`，Evidence `ev_60df3a393d7fa27330de315706f08859c3ed00a4a92dae03488caa442057048b`）；不能把 main 源码功能等同安装版功能。

## Wisp Science 的准确身份

**已确认的产品**是 `xuzhougeng/wisp-science` 开源项目，WISP 的含义是 “Workspace for Intelligent Scientific Practice”。官方 README 将它定义为“open-source, local-first AI research workbench”，可在同一项目中检索文献、运行 Python/R、查询约 80 个科学数据库并保存 figures、runs、decisions 和 drafts；仓库 About、README 和官网三处指向同一个项目。

- [官方 GitHub 仓库 About/README](https://github.com/xuzhougeng/wisp-science)：产品名、WISP 全称、Rust/Tauri 工作台定位、Python/R、MCP 生信数据库、SSH/WSL/GPU 运行环境、AGPL-3.0-only。
- [官方产品页](https://wispscience.com/?lang=en)：说明它是科研工作台而非新模型；本地运行分析、调用 Python/R/MCP，并把代码、文件和执行记录留在项目中。
- [官方 FAQ（同一产品页）](https://wispscience.com/?lang=en#faq)：明确“不是一个新模型”，而是可配置模型 API/本机 ACP Agent 周围的工作台。
- [官方软件引用信息](https://github.com/xuzhougeng/wisp-science#citation)：给出软件引用 `Xu, Zhou-Geng, Wisp Science: a local-first AI research workbench`，DOI `10.5281/zenodo.22009273`。

**版本说明。** 官网、README、Wiki 的展示版本并不一致（官网当前展示 v1.12.0；README 的引用块为 v1.5.0；Wiki 页面声明其文档对应 v0.23.0）。因此本笔记只认仓库/官网中稳定的产品身份，不把某个版本号当作 API 兼容承诺；接入时必须把 Wisp 版本、Skill commit 和运行环境版本写入运行回执。

## Wisp 对生信工作流、数据和可复现性的可验证做法

| 主题 | 官方资料中可直接验证的行为 | 对 Drone 的含义 |
|---|---|---|
| 分析模块 | `analysis-workflow` Skill 要求每个模块有 `scripts/`、`input/`、`output/figures/`、`output/tables/` 和 README；下游模块引用上游项目相对路径，不隐式复制/重命名；每个输出必须有唯一生产脚本或命令。 | Adapter 的输出声明应是可验证的路径/类型/哈希和生产步骤，而不是只有自然语言描述。 |
| 参数和软件版本 | 同一 Skill 要求 README 记录输入、阈值、随机种子、统计方法、Python/R 包、外部数据库 release/access date、Wisp/model/runtime metadata；未观测的版本写 `unavailable`，不猜测。 | Run provenance 应区分“已观测”与“推断”，缺失版本时显式 unknown，不能伪造可复现。 |
| 生信数据获取 | `public-data-access` Skill 先生成 provider-neutral `download-plan.json`，再校验 provider、accession、过滤条件、输出目录、传输限制；下载后生成 manifest，记录 URL/accession、release、字节数、校验和、工具版本，原始文件不可变。 | `AnalysisAdapter` 的输入准备应拆成可审阅的 acquisition plan 与已验证 manifest；传输成功不等于数据有效。 |
| 运行时与远程计算 | `probe-compute-environment` 要求先用 Probe 建立并持久化 ExecutionContext 能力；`gpu_summary:null` 按无 GPU 处理，`unprivileged` 按无 root 处理；发现 scheduler 就必须使用 scheduler。 | Registry 只登记能力声明，执行器在提交前复核快照；不可凭名称臆测 GPU、sudo、Python/R 或 scheduler。 |
| 运行卡与回执 | [Run cards](https://github.com/xuzhougeng/wisp-science/blob/565deb134343dad98b9b231f7aba80b72a70655f/docs/run-cards.md) 将 command、状态、输出、environment、Run ID 和结果审阅动作绑定；失败/取消/超时/失联也保留。 | 计算任务、传输任务和结果收集要各自有稳定 Run ID 与终态，不能只保留最后一段日志。 |
| 项目历程 | [Research journey](https://github.com/xuzhougeng/wisp-science/blob/565deb134343dad98b9b231f7aba80b72a70655f/docs/research-journey.md) 按准确 ArtifactVersion、生成 Run、登记输入、数据资产、文献和决策建立可回溯时间线；来源缺失明确显示“未记录”。 | Artifact 视图应链接到精确版本和生产 Run，而不是跟随 `latest` 指针。 |
| 研究模块的人机门 | `singlecell-qc` Skill 规定先检查输入/样本和指标，再由人确认阈值，过滤、去双联体和合并都必须经过确认，并保留可逆 checkpoint。 | Adapter 可输出“建议/待审”状态；科学决策和 destructive operation 继续走 Drone 的 readiness/review/authorization gate。 |
| 分析工作流 DAG | [Agent delegation](https://github.com/xuzhougeng/wisp-science/blob/565deb134343dad98b9b231f7aba80b72a70655f/docs/agent-delegation.md) 将 workflow 保存为 DAG，节点有依赖、能力、输出 schema、executor、budget；周期/失败分支和重试都持久化，依赖结果是显式协调通道。 | Analysis Registry 应登记版本化 DAG/contract，按 capability 与输入输出 schema 解析，而不是按 adapter 名称猜测。 |
| 证据与复核 | [Publication Evidence Workspace](https://github.com/xuzhougeng/wisp-science/blob/565deb134343dad98b9b231f7aba80b72a70655f/docs/publication-evidence.md) 将 ArtifactVersion、Run、输入、代码和环境 lineage 绑定到 manuscript item；冻结时保存精确版本、manifest hash；Capsule 用内容寻址快照生成确定性 ZIP，并对每个 blob 做 SHA-256 验证；clean workspace 重跑比较输出和环境 parity。 | Drone 的 delivery/review 应消费冻结的 artifact version + manifest/provenance 快照，不能从当前工作区文件回读替代历史输出。 |
| 开放与限制 | Wisp 的公开 Capsule 只复制 Public allowlisted bytes，Restricted/Private 依赖只留元数据和访问说明；敏感数据不是被强行公开。 | Open Science 目标要和访问控制并存：对 private genome/Hi-C 只发布 PID、hash、schema、许可和获取条件。 |

Wisp 的 `analysis-workflow` Skill 原文：<https://github.com/xuzhougeng/wisp-science/blob/565deb134343dad98b9b231f7aba80b72a70655f/skills/analysis-workflow/SKILL.md>；数据获取：<https://github.com/xuzhougeng/wisp-science/blob/565deb134343dad98b9b231f7aba80b72a70655f/skills/public-data-access/SKILL.md>；环境探测：<https://github.com/xuzhougeng/wisp-science/blob/565deb134343dad98b9b231f7aba80b72a70655f/skills/probe-compute-environment/SKILL.md>；单细胞 QC：<https://github.com/xuzhougeng/wisp-science/blob/565deb134343dad98b9b231f7aba80b72a70655f/skills/singlecell-qc/SKILL.md>。

## OpenScience 的产品机制与功能差距

这里的 **OpenScience** 特指 [synthetic-sciences/openscience](https://github.com/synthetic-sciences/openscience)，是 Apache-2.0 的科研 Agent 工作台，提供 desktop、browser 和 CLI；不是泛指“开放科学”。[官方 README](https://github.com/synthetic-sciences/openscience/blob/a7b9fa3a8c1bd52a9a0c171de58bc14759a0f850/README.md) 说明它用本地 shell/Python/R、科学连接器和 bounded workers 推进研究，支持 Modal、SSH、Slurm/PBS 长任务，但 Skill 存在不代表运行依赖已装。

| 可实现的迁移点 | OpenScience 一方机制 | Wisp 一方机制 | Drone 应补的具体合同/行为 |
|---|---|---|---|
| 可发现的适配器 | 科学工具目录区分 Ready、Not installed、Setup needed、Hosted only、Needs attention、Unavailable；Skill 只是方法，connector/tool 才管理凭据、分页、取消和结果。 | Skill frontmatter 有 domains/research_stages/evidence_types/outputs/side_effects，加载不授予执行权限。 | `AnalysisAdapterRegistry` 登记精确 adapter version、输入输出 schema、readiness policy、运行依赖和 side effects；列出的能力必须带 observed readiness，不能承诺不存在的环境。 |
| 可验证交付门 | Research contract 将 `artifact:<id>`/`artifact-path:<path>` 解析成 immutable Result version + SHA-256；`tool:<name>`/`tool-call:<id>` 解析成 terminal tool call + output hash；自由文本不能通过门。 | Publication evidence 绑定精确 ArtifactVersion，而非 latest；missing lineage 单独标记。 | `review()`/`deliver()` 只消费 Host 读取并校验的 artifact refs；模型写一句“done”不能完成任务；缺输出、格式损坏、版本变化必须 blocker。 |
| 分析运行与交付分离 | Job command finished 与 output delivery finished 分开，支持保留输出后 retry delivery，无需再运行昂贵计算。SSH/Modal 输入 plan hash 和文件 sha256 在提交/回收再验证。 | Run/harvest/input/output linkage 保留到精确版本。 | Runner `collect` 失败应保持 compute succeeded + delivery failed；实现可重试 harvest/collect，禁止自动重新提交 assembly。 |
| 环境和方法漂移 | 每次 assistant inference 的 harness manifest 记录模型/路由、prompt/instruction hash、排序后的工具 schema hash、retry/parent identity；trace replay 校验 composition、inference/tool attribution。 | 模块 README 记录脚本/source hash、runtime generation、软件/数据库版本；未观测字段标 unknown。 | `RunProvenance` 增加 adapter snapshot hash、tool-contract hash、环境 revision，保存 drift 维度；与科学数值验证分开，不暴露 prompt 正文。 |
| 任务推进与预算 | 多阶段 contract 的 continuation 基于 gates/artifact versions/jobs/kernels fingerprint；证据变动继续，停滞只做一次 focused repair，然后保留 partial/blocked；整个 session tree 的 model/tool/token/time/cost 预算原子计数。 | DAG attempt、能力、budget 和失败分支持久化；缺资源/版本变动使批准快照无效。 | AnalysisController 用持久化事件/Run terminal signal 续作；以 attempt 和 fingerprint 去重；避免重复计算、无限修复和重启后从头跑。 |
| 实验指标与失败记录 | per-project SQLite `study/idea/run/point/event` 表；Python tracker 用标记 stdout 记录 init/log/summary/finish/artifact；Driver 跟踪日志偏移、kill criteria、budget、终态并唤醒 session；ledger 派生生成而非反向解析。 | 项目历程准确链接 Run 与 artifact version，保留失败/取消/失联。 | Assembly 参数试验可记录 N50、BUSCO/污染/Hi-C 指标及 baseline/target/方向；先接现有 Inquiry/Compute 回执，避免另建未授权优化循环。 |

OpenScience 上述机制的具体证据：

- [科学工具状态与边界](https://github.com/synthetic-sciences/openscience/blob/a7b9fa3a8c1bd52a9a0c171de58bc14759a0f850/frontend/docs/src/content/openscience/scientific-tools.mdx)；[Skill runtime design](https://github.com/synthetic-sciences/openscience/blob/a7b9fa3a8c1bd52a9a0c171de58bc14759a0f850/docs/notes/skill-runtime-design.md)。
- [harness manifests 与 completion contract](https://github.com/synthetic-sciences/openscience/blob/a7b9fa3a8c1bd52a9a0c171de58bc14759a0f850/docs/notes/harness-manifests.md)：准确证据引用、Result lineage、进度 fingerprint、预算；[thin scientific runtime](https://github.com/synthetic-sciences/openscience/blob/a7b9fa3a8c1bd52a9a0c171de58bc14759a0f850/docs/notes/scientific-harness-design.md)：server 拥有 admission/identity/cancellation/recovery，client 不能从 HTTP 完成推断科学任务成功。
- [jobs/output recovery](https://github.com/synthetic-sciences/openscience/blob/a7b9fa3a8c1bd52a9a0c171de58bc14759a0f850/frontend/docs/src/content/openscience/jobs.mdx)；[SSH plan](https://github.com/synthetic-sciences/openscience/blob/a7b9fa3a8c1bd52a9a0c171de58bc14759a0f850/backend/cli/src/compute/ssh/plan.ts)；[SSH adapter 的 manifest/checksum 校验](https://github.com/synthetic-sciences/openscience/blob/a7b9fa3a8c1bd52a9a0c171de58bc14759a0f850/backend/cli/src/compute/ssh/adapter.ts)；[Modal upload plan](https://github.com/synthetic-sciences/openscience/blob/a7b9fa3a8c1bd52a9a0c171de58bc14759a0f850/backend/cli/src/compute/modal/plan.ts)。
- [experiments/studies 架构、tracker 与 Driver](https://github.com/synthetic-sciences/openscience/blob/a7b9fa3a8c1bd52a9a0c171de58bc14759a0f850/docs/notes/experiments-and-studies.md)。
- [data-analysis](https://github.com/synthetic-sciences/openscience/blob/a7b9fa3a8c1bd52a9a0c171de58bc14759a0f850/frontend/docs/src/content/openscience/data-analysis.mdx) 要求 organism/reference assembly/accession version/identifier type；[reproduction](https://github.com/synthetic-sciences/openscience/blob/a7b9fa3a8c1bd52a9a0c171de58bc14759a0f850/frontend/docs/src/content/openscience/reproduction.mdx) 要求源 revision、data split、配置/seed、environment/hardware、metric implementation、raw failures，并区分 exact/partial/unresolved。

**优先级建议（设计推断，不是对方原生 API）：** P0 先完成 AdapterRegistry 的类型化输入输出、readiness 和输出校验；P0 建立 assembly 独立 assay policy，恢复/collect 不触发重复提交；P1 将 artifact version + exact producing Run + 环境/adapter hash 接入现有 Inquiry；P1 加 immutable delivery snapshot 与可复现报告；P2 才考虑 Wisp Publication Capsule 和 OpenScience study metric 图表。这些产品并未证明一个可直接复用的标准 `AnalysisAdapter` API，建议借鉴合同和边界，继续由 Drone 自身 compute/authorization/JsonStore 组合根实现。

## 给 Drone 的可迁移设计建议（不改代码）

### 1. `AnalysisAdapter` 与 Registry

建议把适配器登记项设计成**可寻址、可验证的能力声明**，至少包含：

- `id`、`version`、`schemaVersion`、`source`/`license`、维护者与文档 URL；
- `domain`/`assay`、研究阶段、输入输出 `type`、可接受格式和最小元数据；
- `sideEffects`（read-only/network/project-write/code-execution/external-service）和所需 Capability；
- `workflowRef`（CWL/Nextflow/内部 DAG）、模块 commit、容器 digest、参数 schema；
- `evidenceTypes`、产物 schema、校验器、科学审查门和限制说明。

Registry 应只返回精确版本的 immutable snapshot，并拒绝未知 schema、循环 DAG、缺失输入输出、未解析容器 digest 或未声明副作用的适配器。这个结构同时吸收了 Wisp Skill 的 frontmatter（能力/研究阶段/证据类型/副作用）、Wisp Workflow 的 DAG/output contract 和 WorkflowHub/GA4GH 的注册与执行分层。不要让自然语言 adapter 名称决定工具或权限；能力和资源必须由 Registry policy 解析。

### 2. Assembly 适配器应独立建模

当前 Drone 已有 bulk RNA-seq 的 readiness policy；assembly（基因组组装、Hi-C 校正、结构/污染评估）应作为新 assay policy 注册，不要把 FASTA/Hi-C/BAM 塞进 RNA-seq 的输入枚举。建议 assembly adapter contract 至少分为：

- **输入对象**：assembly accession/version、contig/scaffold FASTA 与 index、Hi-C/HiFi/ONT/BAM/BAI（含 library/platform、样本/重复、reference build、坐标系）；每个文件都有 URI/PID、大小、sha256、许可/访问级别。
- **方法与环境**：工具/模块名与版本、workflow commit、OCI digest、参数/阈值、数据库/contaminant release、ExecutionContext（OS/arch/CPU/RAM/GPU/scheduler/container）；远程执行只消费已探测能力。
- **输出与验证**：校正后 assembly、AGP/assembly graph、scaffold/contig statistics、BUSCO/BlobToolKit/Hi-C contact map、QC report；每个输出绑定 producing step、Run ID、artifact version、checksum 和 QC 状态。
- **科学门**：reference mismatch、染色体/contig 命名变化、misjoin 候选、倒置/移动/删除等 destructive edits 在提交/发布前分别 pause/review；保留原 assembly 和每轮 patch/decision，使修正可逆。

这样可沿用 CWL/RO-Crate/PROV 的通用合同，同时容纳 assembly 特有的坐标和图结构；WorkflowHub 的 Workflow RO-Crate profile 可作为发布封装，Workflow Run Crate 可作为实际运行记录。不要把“流程执行成功”升级成“组装科学有效”；QC 和人工 review 仍是独立字段。

### 3. Artifact / provenance 的最小闭环

建议把 Drone 的现有 `ArtifactManifest`、`run-provenance` 和 deterministic RO-Crate 扩展为四层：

1. **内容层**：ArtifactVersion（稳定 ID、相对路径/URI、媒体类型、bytes、sha256、access level、created-at）；禁止 delivery 追随 `latest`。
2. **方法层**：Workflow/adapter version、spec hash、module commits、container digests、parameters、sample/design/reference IDs、database release、license。
3. **运行层**：Run ID、parent/dependency IDs、ExecutionContext revision、host/executor/scheduler、start/end/status/exit code、logs、input/output links、retry/attempt；失败、取消、失联也产生终态记录。
4. **证据层**：RO-Crate manifest（当前 Drone 已生成 1.1，建议保留兼容并规划 1.3）、W3C PROV/Workflow Run Crate 映射、QC/review/scientific verification 三态、限制和可公开/受限依赖说明；冻结后按 manifest hash 建立不可变 snapshot。

发布时可以暴露 Public 的元数据、代码、容器 digest、checksums 和可访问数据引用；Private assembly/Hi-C/BAM 只暴露 PID、hash、schema、许可和访问说明。公开 Capsule/RO-Crate 不应复制受限字节，也不应从当前工作区补齐缺失历史文件。clean-room replay 应在隔离目录、清理环境和精确输入/代码快照上运行，并把“可重执行”“已复现”“科学验证”分开显示。

### 4. 与 Drone 当前边界的对接点

- `@drone/compute` 已有 workflow spec hash、module commits、container digests、artifact manifest、远程 provenance 和 B7 deterministic RO-Crate；下一步重点是让 Adapter Registry 的声明能直接生成这些字段，而不维护第二套手写元数据。
- `@drone/shared` 的 readiness gate 应继续只判断输入/重复数/reference/授权等门禁；适配器特有 QC、统计和 assembly review 结果应由 adapter policy 提供，不把“ready”误称为科学正确。
- `@drone/inquiry`/research provenance 可以消费 `runProvenanceDeclarations`，但应保留 observed/verified/reproduced 三种状态和证据来源；Wisp 与 Open Science 均支持“可追溯但尚未复现”的中间状态。
- 适配器/Registry/RO-Crate schema 每次变更都要有 `schemaVersion`、migration/compatibility 说明和来源 URL；未知版本 fail closed。

## 结论与未确认项

- OpenScience 已确认为 synthetic-sciences/openscience；Wisp Science 已确认为 xuzhougeng/wisp-science。两者是一方工作台源码/文档证据，本机安装版能力必须由 REA/运行证据另行确认。
- 可直接迁移到 Drone 的核心是：能力声明与权限分离、版本化 DAG/输入输出 contract、先计划后获取、精确 ArtifactVersion、运行级 provenance、容器/环境指纹、受限数据引用和独立科学审查。
- 未确认项：没有确认两产品现有 `AnalysisAdapter` 公共标准接口，也没有确认本机 Wisp v1.9.0 已拥有 main 的全部 Capsule/Workflow 功能。实际接入前须对目标 release/commit 和具体 Skill 运行正反例验证。

## 附录：开放科学标准（补充互操作性依据）

这些是设计建议的标准背景，非 OpenScience 产品功能。

### 标准依据

以下不是“开放文件即可”的口号，而是可转成 Drone 合同字段和门禁的标准：

1. **FAIR 原则。** FAIR 原论文把 Findable、Accessible、Interoperable、Reusable 适用于数据以及产生数据的算法、工具和工作流；GO FAIR 的 F1–F4/A1–A2/I1–I3/R1–R1.3 可转成 PID、机器可读元数据、标准协议/词汇、许可证、溯源和社区标准检查表。来源：[Wilkinson et al., Scientific Data (2016)](https://doi.org/10.1038/sdata.2016.18)；[GO FAIR Principles](https://www.gofair.foundation/fair-principles)。
2. **开放封装。** RO-Crate 用 JSON-LD 图在 `ro-crate-metadata.json` 中描述根数据实体、文件、代码、工作流和上下文；官方长期版本为 1.3（兼容 1.2），并提供实现 MUST/SHOULD/MAY 的快速参考。来源：[RO-Crate specification](https://www.researchobject.org/ro-crate/specification.html)；[quick reference](https://www.researchobject.org/ro-crate/quick-reference)；[RO-Crate 论文](https://www.researchobject.org/2021-packaging-research-artefacts-with-ro-crate/manuscript.pdf)。
3. **工作流注册和运行封装。** WorkflowHub 用 CWL、RO-Crate、Bioschemas 和 GA4GH TRS 注册、版本化、发现并引用工作流；Workflow RO-Crate profile 要求主工作流实体、输入输出、许可证等元数据，Workflow Testing/Run Crate 可表达测试与执行 provenance。来源：[WorkflowHub](https://workflowhub.org/)；[维护指南](https://about.workflowhub.eu/docs/)；[Workflow RO-Crate profile 1.1](https://about.workflowhub.eu/Workflow-RO-Crate/1.1/)；[WorkflowHub 论文](https://arxiv.org/abs/2410.06941)。
4. **可移植工作流与执行 API。** CWL 是引擎/厂商中立的声明式工作流描述；GA4GH 云工作流栈分开定义 TRS（注册）、TES（批任务）、WES（整工作流）和 DRS（数据对象访问），WES 支持 CWL/WDL/Nextflow/Snakemake 等引擎。来源：[CWL features](https://www.commonwl.org/features/)；[CWL specification](https://www.commonwl.org/specification/)；[GA4GH Cloud Work Stream](https://ga4gh-cloud.github.io/)；[WES](https://www.ga4gh.org/product/workflow-execution-service-wes/)；[TES schemas](https://ga4gh.github.io/task-execution-schemas/)。
5. **生信工程实践。** nf-core 规范要求版本化、容器/Bioconda/BioContainers、最小测试数据、nf-test/CI、DOI/Zenodo、云兼容和同行评审，以降低硬件/软件环境导致的不可复现。来源：[nf-core pipeline guidelines](https://nf-co.re/docs/guidelines/pipelines/overview)；[nf-core introduction](https://nf-co.re/docs/usage/getting_started/introduction)；[nf-core 论文](https://www.nature.com/articles/s41587-020-0439-x)。
6. **分析实例和溯源。** BioCompute Object 记录 HTS/NGS 实例的参数、可执行程序版本、输入/输出测试数据、代理和元数据，并与执行环境解耦；W3C PROV 定义 Entity/Activity/Agent、派生、版本和跨系统交换。来源：[BioCompute Object introduction](https://docs.biocomputeobject.org/introduction/)；[W3C PROV overview](https://www.w3.org/TR/prov-overview/)。
7. **数据/软件治理。** RDA DMP Common Standard 支持机器可操作的数据管理计划交换；ELIXIR RDMkit/FAIR Cookbook 及 Software Management Plan 覆盖生命科学数据保存、敏感数据、软件版本、许可证和可持续性。来源：[RDA recommendations](https://www.rd-alliance.org/all-recommendations-outputs/)；[ELIXIR data-management guidelines](https://elixir-europe.org/what-we-offer/guidelines/data-management)；[ELIXIR Software Management Plans](https://elixir-europe.github.io/software-management-plans/)。
8. **“开放”不等于“无条件公开”。** 加拿大 FAIR readiness 指南明确 FAIR 数据可以受隐私、安全和法律约束，原则是尽可能开放、按需保护；这与 RO-Crate 的受限数据引用相容。来源：[Government of Canada FAIR readiness guidance](https://www.canada.ca/en/government/system/digital-government/digital-government-innovations/information-management/guidance-assessing-readiness-manage-data-according-findable-accessible-interoperable-reusable-principles.html)。
9. **社区可复现实践。** The Turing Way 以开放手册形式覆盖数据、代码、环境、许可、协作和持续集成，适合作为 Drone 面向用户的解释层，而非替代机器合同。来源：[The Turing Way](https://book.the-turing-way.org/)。
