# ClawsGO Science 与 Drone 真实任务复拆

日期：2026-10-14
范围：以同一个小菜蛾 DHX16 研究问题，观察 ClawsGO Science 的真实任务链，并在更新到 Drone v0.31.1 后重新跑 Drone 内置“研究规划与设计”示例。

## 证据边界

本记录把证据分为三层：

- **运行时观察**：通过 CUA 读取窗口、可访问性树、任务状态、工具行、文件路径和交付面板。
- **文件/进程核查**：读取 ClawsGO 任务工作目录、脚本、TSV 输出、进程命令行和 NCBI 状态；这些是本机可复核的外部状态。
- **静态 REA**：对 `/Applications/ClawsGO.app/Contents/Resources/app.asar` 做的 Electron/JavaScript 结构分析。静态图覆盖不完整，不能单独证明业务语义。

没有把模型叙述当作实验结果，也没有把计划文件当作已完成实验。

## 先纠正版本：Drone 已更新

用户指出本机没有更新到最新版本。复核得到：

- 更新前 `/Applications/Drone.app` 的 `CFBundleShortVersionString` 是 **0.26.2**。
- 官方 release 页面当前为 [Drone v0.31.1](https://github.com/Gyoungwe/Drone/releases/tag/v0.31.1)；源码工作树也对应 `v0.31.1-25-g48bf6679`。
- `npm run dist` 在研究技能包 release preflight 因缺失 `packages/desktop/resources/research-skills/nature/.drone-pack.json` 停止，未把这个失败误判为编译失败。
- 改用官方 `drone-mac-arm64.zip`，SHA-256 为 `df93db36bafa0e2aa8f731b591ab5a1293b0c3f5d9a1c552754ecb3446ed5666`。解压后的 app 为 arm64，两个版本字段都为 **0.31.1**。
- 旧 app 保留在 `/Applications/Drone.app.v0.26.2-backup-20261014`，便于回退；当前 `/Applications/Drone.app` 已是 0.31.1。

## Drone v0.31.1：同一示例任务的真实链路

研究问题：`小菜蛾 DHX16 是否通过 RNA 剪接调控影响发育和应激适应？`

实际操作顺序：

1. 启动更新后的 Drone，点击“新建会话”，打开“规划：从研究问题到可判别假设”。
2. 在示例表单填写研究问题，保持背景材料路径为空；表单声明只发出一条首条消息，不预先建任务或写文件。
3. 点击“新建会话并发起”。首条消息包含 `/skill:hypothesis-generation`、目标、三个里程碑和“不声称完成实验”的阶段契约。
4. Drone 先生成 `task_plan`，出现一次任务授权卡；同意后开始写入 `scope.md`。
5. **版本差异**：写完并预览 `scope.md` 后，0.31.1 又出现一次相同任务的授权卡；再次同意后才继续完成其余里程碑。这与示例文案“一次授权后自主完成”不一致，应作为回归问题跟踪。
6. 任务最终结束。任务面板显示：**交付已完成、已执行 9 步、已完成 3/3、耗时 4m 13s、29 次工具 / 18 次响应、1.02M tokens、84% cache**。

真实交付文件均写入 Dronevault：

- `scope.md`：界定 3–4 龄幼虫/蛹窗口、热胁迫与杀虫剂边界，以及同源保守性、RNAi 可达性、时间解耦、剪接检测分辨率等假定。
- `hypotheses.md`：五个竞争假设：特异性可变剪接、全局剪接机器瘫痪/NMD 毒性、dsRNA 脱靶或免疫伪影、非剪接直接调控、次生体质虚弱；包括双靶点、异构体拯救、催化失活突变体和 `DHX16 × Stress` 判别证据。
- `design.md`：`3 × 2` 完全随机区组析因设计，微型饲养盒为实验单元，RNA-seq/RT-PCR、GLMM、生存分析和功能拯救决策树。

文件内容明确写出这是实验前置方案，不包含任何已完成的湿实验结果；任务结束时仍提示知识库准备步骤未核验。0.31.1 界面还可直接观察到“深度思考 0.0s”、进行中阶段、已执行步骤和交付进度，这些是 UI 状态改进，不等于科学证据增加。

## ClawsGO Science：真实任务链与实际落点

运行应用为 `/Applications/ClawsGO.app`，窗口为 **ClawsGO Science**，显示模型 **ClawsGO 1.5 Lithium**，主机 **Mac-0b2d · 自动分配**。任务会话为 `app://bundle/chat/2be09774-66bb-4c11-963b-8f2fe29260c0`，项目工作目录为 `/Users/gaoyangwei/ClawsGO/project-20261013-1`。

发送的真实任务要求界定问题、提出竞争假设、区分文献证据/假设并形成可追溯文件，禁止声称完成实验。运行时观察到的动作包括：

- 先读取指令、列出项目目录、检查 LaTeX/PDF 与网络；曾询问两个会改变设计重点的问题，等待约 10 分钟未收到答复，随后按“机制为主、应用为辅”的默认定位继续。
- 执行多次聚合检索，覆盖 DHX16/Prp2、昆虫 RNAi、内含子保留/热胁迫、`Plutella xylostella` 可变剪接等主题。
- 真实调用 NCBI Gene，确认小菜蛾 DHX16 gene ID `105387316`；检查 tectonic 中文排版并生成 PDF；测试 UniProt 与 NCBI CD-Search 连通性。
- 写入并多次编辑 `analysis/01_fetch_sequences.py`，运行脚本获取五个物种的蛋白序列；随后写入 `analysis/02_ortholog_analysis.py`，执行真实的 BLOSUM62 全局比对。首轮前台 CD-Search 轮询达到单次工具时限后，任务改用可恢复的取回脚本继续追踪既有作业。

文件与数据核查：

- `analysis/logs/01_fetch_log.tsv` 记录小菜蛾 `XP_011556326.2`、果蝇 `Q9VIZ3`、人 `O60231`、小鼠 `Q921Y1`、酵母 `P20095` 及长度。
- `analysis/outputs/ortholog_identity.tsv` 已真实产出：

  | 比较对象 | 长度 | identity | similarity |
  |---|---:|---:|---:|
  | 果蝇 l(2)37Cb | 894 aa | 79.6% | 90.8% |
  | 人 DHX16 | 1041 aa | 65.8% | 84.5% |
  | 小鼠 Dhx16 | 1044 aa | 66.1% | 83.3% |
  | 酵母 Prp2 | 876 aa | 46.7% | 65.8% |

- 初次前台轮询在单次工具执行时限内未取回结果，记录产生的 NCBI `cdsid` 为 `QM3-qcdsearch-12D9BED96835D6CC-205C0C2D6241BC0D`；该状态是“前台未取回”，不是失败。服务端作业随后独立完成。
- 续作时 ClawsGO 只查询该既有 `cdsid`，得到 `#status 0 / success`，并落盘 `analysis/raw/cdsearch_QM3-qcdsearch-12D9BED96835D6CC-205C0C2D6241BC0D.txt`、`analysis/outputs/px_dhx16_domains.tsv`、`analysis/logs/04_cdsearch_provenance.tsv` 与 `analysis/04_cdsearch_fetch.py`。结果含特异性 `DEXHc_DHX16`（245–418，E=2.54955e-123）、HA2、Helicase_C 和 OB_NTP_bind 等命中。
- 续作补充 `analysis/05_map_catalytic_sites.py` 与 `analysis/outputs/catalytic_site_mapping.tsv`，将人源 G724/S552 映射到小菜蛾 G570/S398；并生成 `scope.md`、`evidence-ledger.md/.csv`（40 条互相对齐的记录）、`hypotheses.md`、`design.md`、`final-report.md/.pdf`、`README.md`、`provenance.md` 和 `manifest.tsv`。
- ClawsGO 任务最终显示 **已完成、6/6、8m46s、62 个步骤**；其交付前校验报告显示 19 个必需文件非空、12 项关键数字一致、CSV 与 Markdown 台账均为 40 条、7 份文档均含“未实施任何湿实验”声明。PDF 为 8 页、374 KB，中文文本可提取。

## 两个系统的行为对照

| 维度 | Drone v0.31.1 | ClawsGO Science |
|---|---|---|
| 任务入口 | 六方向示例卡 → 表单 → 单条 skill 消息 | 自由文本任务 → 项目/主机运行时 |
| 计划与授权 | `task_plan` 后有明确授权卡；本轮出现第二次授权回归 | 会问关键设计问题；超时后采用默认定位 |
| 真实执行 | 写入并验收 3 个 Markdown 里程碑 | 写脚本、编辑脚本、运行 Python、调用 NCBI/UniProt |
| 可验证输出 | 3/3 文件验收，任务完成 | 5 条序列、同源比对、CD-Search 原始/解析结果、位点映射、6 类研究交付 |
| 过程可见性 | 阶段、工具数、步骤、交付进度、思考计时 | 62 个步骤、命令耗时、脚本 diff、6/6 清单与交付面板 |
| 失败边界 | 知识库准备未核验但交付仍可结束 | 前台轮询受工具时限限制；复用 `cdsid` 后完成并记录该过程 |
| 科学结论边界 | 明确“不代表完成湿实验” | 只可报告 in-silico 序列证据，不能报告结构域或实验结论 |

## 当前可下的结论

1. **Drone 的任务骨架已经能被真实复跑**：示例输入 → 计划 → 授权 → 文件写入 → 验收闭环在 0.31.1 上成立，但“一次授权”契约存在重复授权回归。
2. **ClawsGO 的强项是开放式真实操作链**：它能把问题拆成检索、脚本、网络 API 和可复现计算，并在中途发现“取最长序列”的错误后改用 UniProt 规范序列；这些动作有文件和进程证据支撑。
3. **ClawsGO 本轮已完成研究前置交付**：它没有把第一次前台轮询超时当成最终失败，而是复用 `cdsid` 取回 `status=0` 结果，并完成问题边界、40 条证据台账、竞争假设、分层实验设计、Markdown/PDF 报告、README、provenance 和 manifest。独立文件复核与 `analysis/08_verify.py` 均通过。
4. **本轮没有任何湿实验结果**。Drone 的 Markdown 是设计，ClawsGO 的 TSV 是 in-silico 序列证据；两者都不能证明 DHX16 已被干预或改变发育/应激表型。

## REA 静态证据与限制

ClawsGO `app.asar` 的 REA 分析保留证据：

- 根分析：`ev_10398df92b42a8a92c3f676598e45c8d5660a4bbadddbfebc97a13a20ca4a883`
- 汇总视图：`ev_616727ed00ae37e37f6937b7e092b8dce0dd2f208df49c3e3017f775b03a627e`
- 模块视图：`ev_4327a2543e87ccf5c02147eadc733f2ece9dab3be2a62424a9533a699c3de16f`

摘要观察到 Electron 主进程、preload/context bridge、43 个 IPC operation 和 `dist-app/assets/chat-Gob318or.js`、`skills-DmQIscen.js` 等模块；由于包很大且语义图被截断，这些证据只用于确认架构形状，真实任务结论以运行时和文件证据为准。

## 完成后的剩余边界

- 交付仍然是研究前置材料：没有小菜蛾 DHX16 的直接功能实验（L1）或湿实验结果；序列与结构域结果只能支持同源身份和结构域架构，不能证明发育或应激因果。
- `scope.md`、`README.md` 与 `provenance.md` 保留了机制为主/应用为辅的默认定位，以及小菜蛾种群、RNAi 递送和未发表线索等待确认前提；这些前提需要在真正开做 T1 实验前确认。
- 仍需在 Drone 中复测一次授权卡，并单独核验知识库准备失败是否影响交付门禁；这与已完成的 ClawsGO CD-Search 追踪是两个独立问题。
