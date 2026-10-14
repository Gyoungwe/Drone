# v0.32.0 P6 发布审阅与能力矩阵

**对应计划**：Drone Scientific Workbench Upgrade Plan v2：Evidence-Gated Evolution Architecture  
**批次**：P6 · 发布审阅：全量测试、架构检查、打包产物、许可证、技能锁定、升级夹具和远程 CI  
**审阅基线**：P5 UI/LAN 证据 PR #199 已合入 `main`（merge `2ca43994e5d2148050841ccb47fa8e3307959480`）；本审阅分支包含同一 P5 内容。  
**结论**：P6 审阅材料已完成，但发布条件仍有明确未完成项。本文件不把本地 fixture、UI 截图或受控 smoke 提升为真实科研结论。

## 门禁记录

| 门禁 | 结果 | 证据与边界 |
| --- | --- | --- |
| `npm run lint` | 通过 | 仅仓库既有 3 条 CSS specificity warning，无 error |
| `npm run typecheck` | 通过 | 所有 workspace 与 `.pi` checkJs 通过 |
| `npm test` | 通过 | backend 222/224 文件、1862 passed/13 skipped；desktop 142/142、763/763；其余 workspace 与根级测试通过 |
| `NODE_OPTIONS=--max-old-space-size=4096 npm run build` | 通过 | LAN web、Electron main/preload/renderer 构建完成 |
| `npm run check:arch` | 通过 | 0 baseline finding |
| `npm run test:upgrade` | 通过 | `orchestration-stress`、`hybrid-fixture`、`packaged-resources` 全部通过；需要已安装依赖 |
| `npm run test:research-packaging` | 通过 | 16 个离线许可证/收据/缓存测试通过 |
| `npm run check:plugin-api` | 通过 | host API projections up to date |
| `npm run check:extensions` | 有条件通过 | `build:extensions -- --force` 后本地映射检查通过；远程 CI #602 在干净 checkout 仍报告源/产物漂移，见“未完成项” |
| `npm run check:research-runtime` | 有条件通过 | 当前源重建后通过；重建结果是派生产物，不等于 A5 迁移完成 |
| `npm run check:tasks-runtime` | 通过 | runtime 与 compatibility artifacts up to date |
| `npm run check:pi-packages` | 通过 | `stage:pi-packages` 后 `pi-mcp-adapter@5.1.0` 已验证；staged 目录是本地构建产物，不入 PR |
| `npm run check:knowledge-runtime` | 未通过 | 重建后仍有 esbuild chunk 名称/manifest 漂移；远程 CI #602 同样失败。没有把这类派生文件漂移伪装成源码通过 |
| `npm run skills:check` | fail-closed | 当前环境没有受授权的 Nature/Scientific 资源包及 `.drone-pack.json`；不下载、不猜许可证、不把缺包标成通过 |

P4 的受控 RNA-seq smoke 只验证 fixture、attempt 隔离、输入/输出哈希、Nextflow receipt 和失败回执。真实目标主机、真实 FASTQ、Nextflow cache、MultiQC 生物学结果仍需要授权环境，因此不在本表中标成完成。

## 能力矩阵

| 能力域 | 当前已落地 | 证据等级 | 可支持的复用 | 尚未建立的事实 |
| --- | --- | --- | --- | --- |
| UI / LAN 观察 | 设置焦点循环、窄屏规则、图谱大图边界、子智能体分页、Run Inspector、LAN read-only | A：源码契约 + 14/14 定向测试 + P5 矩阵 | 可复用 UI 组件和只读投影契约 | 375/768/1024/1440 发布截图（B）；真实设备 LAN 走查（C） |
| 知识、记忆、进化复用 | KnowledgeSnapshot、experience/reuse 合同、显式审批与撤销边界 | A：shared/knowledge 测试与 P2 文档 | 可在满足 scope、freshness、approval、evidence 条件时提出复用候选 | 任何单条知识都不能因“已沉淀”自动变成已验证科学结论 |
| 技能与工具治理 | capability manifest、来源/版本/license/schema/权限/资源限制和环境 probe 门禁 | A：治理测试、许可证测试、manifest 文档 | 只把 ready 且已登记的版本送入既有授权与 compute preflight | 本 checkout 未安装外部研究 skill pack；发布前必须按锁定提交和许可证 basis 获取 |
| 分析编排与 bulk RNA-seq | adapter contract、readiness、设计/参考/重复数/授权门禁、receipt/lineage、受控 smoke | A：shared/backend/compute 测试；P4 fixture smoke | 可准备一个经门禁的分析计划和可重现 attempt | 未验证所有真实数据场景；未产生真实样本的 QC/DESeq2/生物学结论 |
| RunAttempt / causal lineage | additive `CausalEnvelope`、显式 event/causation/runAttempt projection、retry/branch/replay 边界 | A：shared/backend 回归与 P1–P4 记录 | 可审计单次 attempt 的因果链和 failure receipt | 普通会话入口尚未自动注入完整 causal context；projection 仍只读且没有新增 IPC |
| 证据与交付 | checkpoint、capsule、artifact hash、review/publication 状态机和 omission 清单 | A：shared/backend/desktop 测试 | 可在 review 通过后发布受限交付物 | 真实机构数据、目标主机和发布审批仍需实际授权与证据 |

## 未完成项和下一步

1. **生成物基线**：`check:extensions` 与 `check:knowledge-runtime` 在远程 CI #602 仍失败。需要单独的 artifact reproducibility 修复：固定构建输入/Node/esbuild 组合、清理 stale chunks、重建并审阅 manifest，再单独开 PR；不能在 P6 文档 PR 中盲目提交大批二进制/派生变化。
2. **技能包发布前置**：在有明确 license basis 的环境获取锁定的 Nature/Scientific/ARS 资源，运行 `npm run skills:check` 和 release preflight。缺少受授权资源时保持 fail-closed。
3. **UI B 档**：在发布环境按 P5 矩阵收集 375/768/1024/1440、浅色/深色/减动效截图和哈希；截图完成前不能写“全视口视觉验收完成”。
4. **真实科研 C 档**：在用户授权主机执行真实 bulk RNA-seq/Nextflow smoke，保存 manifest、环境 digest、QC、count table、trace 和失败/重试 receipt；不能用 fixture 代替真实数据。
5. **A5**：`.pi/lib` 架构迁移继续延期。本批次只审阅现有生成物状态，不删除兼容门面，不声称完成迁移。
6. **因果链入口**：普通会话入口的完整 causal context 自动注入仍是后续设计/实现任务；当前 projection 保持 backend/host 只读范围。

## 发布红线

- UI 状态、截图、fixture smoke 或模型文本不能设置 `scientificallyVerified`、QC、review 或 publication 状态。
- 未登记、未锁版本、无 schema/license/probe 或环境状态为 `unknown` 的能力不得提交执行。
- LAN `remoteControl=false` 时只能观察；只读 projection 不等于远程执行授权。
- 失败 attempt 不覆盖成功 attempt；retry 必须有新的 attempt、parentRefs 和 receipt。
- 未经用户批准不得把知识、记忆或进化候选自动写入受保护 Wiki、执行计划或发布产物。

P6 的输出是可复核的发布审阅和能力边界，未完成项必须在相应证据到位前保持打开。

