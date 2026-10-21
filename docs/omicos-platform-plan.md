# OmicOS 文献雷达与阅读闭环计划

来源：[`claude/drone-omicos-handoff.md`](../claude/drone-omicos-handoff.md)，对照 Drone `main` 的差距分析。本文只安排 handoff 中的六个 PR，按顺序执行；每个 PR 单独提交、单独验收。

## 当前未完成项

- v3 T3 的真实安装包三页面验收尚未执行；代码级挂载、卸载和默认恢复测试已通过。
- v3 T4 的 `@gyoungwe/pi-analysis` host adapter 仍是已登记迁移例外，尚未完成完整迁移。
- PR1 已完成代码实现，真实会话验收待执行；PR2–PR6 尚未开始。本计划不把 fixture 或 loader 单独加载当作真实验收。

## 共同约束

- 复用现有连接器 registry、捕获流程、`JsonStore`、子代理和 `window.pi` host API，不新增安全门、确认流程或无需求的抽象层。
- 新增 IPC 必须同步 shared、preload、main IPC 和 backend；新增 UI 文案必须同时更新中英文词典。
- 外部检索和批量精读结果只是线索；只有 `research_read_source` 读到原文后，内容才能进入证据或作为引用。
- JSON 持久化统一使用 `JsonStore`。真实会话或真实安装包才可以标记验收 PASS。

## PR 顺序

### PR1：新文献雷达与 Semantic Scholar / arXiv 连接器（代码完成，真实验收待执行）

新增 `semantic-scholar` 和 `arxiv` 只读连接器，接入 `packages/research/src/connectors.ts` registry 和资料页逐项开关，默认开启；Semantic Scholar 支持无 key 工作、有 key 时从设置读取，429 必须作为 retryable 失败；本轮不做 bioRxiv/medRxiv。

每日发现读取活跃课题标题/实体和最近 30 天 Zotero DOI，按每课题最多 2 条、总计最多 12 条查询；从已启用的 OpenAlex、PubMed、Europe PMC、arXiv 和 Semantic Scholar 获取结果，按 DOI → arXiv id → 规范化标题去重，并与 Vault、Zotero 和已推送雷达项去重。最多保留 10 条，按命中课题数和推荐命中排序，不调用模型打分。

在 `DailyDiscoveryState` 增加最多 50 条的 `radar`，并在 `DailyIdeas.tsx` 增加“新文献”分组，复用 `captureResearchResource` 完成入库。`lastOutcome` 要区分无活跃课题、连接器全部关闭、没有新论文和找到 N 篇。

验收证据：去重、7 天窗口、查询上限、开关、429 单测；真实会话返回最近 7 天论文，入库后出现在知识库，同日再次运行不重复推送。

### PR2：引用跳转到 PDF 原文页码（代码完成，真实验收待执行）

让 `pdf-worker.ts` 按页保留文本边界，`research_read_source` 返回 `[[page:N]]` 并在来源回执记录页码范围；学术回答引用支持 `#page=N`，只有模型实际读到该页时才允许生成页码。

`Markdown.tsx` 解析页码，`PreviewRendererProps` 增加 `initialPage`，`PdfViewer` 打开时跳到目标页；越界回退第一页并提示，Vault 笔记引用保持原行为。

验收证据：页码解析、越界回退、pdf-worker 页边界单测；真实会话中点击引用直接落到 PDF 第五页之后的目标页。

### PR3：新会话首页上下文卡片（代码完成，真实验收待执行）

在 `HomeCards` 增加有数据才显示的三类卡片：最近 3 个活跃课题、每日发现中的新想法、新文献雷达中的新条目。继续课题通过输入框发送“继续课题：<标题>”，其他两项跳到知识库对应分组；无 Vault 或无数据时不渲染空卡片，不新增写入 API。

验收证据：真实安装包新建对话显示三张卡片；全新无 Vault 安装只显示原有卡片。

### PR4：批量精读 → 证据矩阵技能（代码完成，真实会话验收待执行）

新增 `.pi/skills/literature-matrix`。输入支持 Zotero 集合、DOI 列表或项目 PDF 文件夹；每篇论文由一个子代理调用 `research_read_source`，按固定字段提取研究问题、方法、数据/样本、带页码的主要结论、局限和与研究问题的关系；读不到原文必须标记“未读到原文”，不得用摘要补全。

父会话汇总 Markdown 与 CSV 到项目目录，并用 `research_deposit_knowledge` 存入知识库；每批最多 12 篇，超出时分批并告知用户。补充 `example-tasks.json` 的 `evidence-literature` 示例，技能需通过 `npm run skills:check` 和 SKILL-01。

验收证据：真实会话处理 5 篇论文（含 1 篇无法获取全文），得到 5 行矩阵，CSV 可被表格软件打开。

### PR5：Paper2Agent 接入文档与 README 修正

新增 `docs/paper2agent.md`，说明 Paper2Agent 生成 MCP 服务器，提供本地 stdio 和远程 URL 配置示例，明确其工具输出按交付物处理、不能直接作为证据。更新 `docs/INDEX.md` 和 README 中英文连接器入口。

同时删除或替换 README 中已下线的鲸鱼娘桌宠截图和“内置两只”描述。不新增预设，不写接入代码。

验收证据：按文档接入一个公开 Paper2Agent 服务器，在真实会话中调用一次工具并保留截图。

### PR6：PDF 解析质量评估

只做评估，不接入默认流程。准备 `fixtures/pdf-hard/` 的 10 篇开放获取论文，覆盖双栏、公式密集、跨页表格、扫描件各至少 2 篇并记录许可；新增 `scripts/eval-pdf-parsing.mjs`，比较 pdf.js、MinerU、GROBID 的正文字符召回、表格结构、公式可读性、参考文献抽取数和耗时。

结果写入 `docs/evals/pdf-parsing-<日期>.json`，另附结论文档，讨论是否值得作为可选后端、本地还是 API、以及安装体积。本轮不得把 MinerU 或 GROBID 加入安装包或默认流程。

验收证据：脚本可重跑、评估 JSON 完整、结论文档交由用户决定下一轮是否集成。

## 明确不做

本轮不做划词翻译、bioRxiv/medRxiv、远程 MCP 预设、宠物、手机端/网页同步、可编辑画布、语音输入、云端自进化，以及 B8/B8-2 云端协作。

## 交付顺序

每个 PR 完成后提交 PR 链接、CI 结果和对应证据；PR1 附真实雷达结果，PR6 附评估 JSON 与结论。六个 PR 完成后，再由 Claude 在 Mac 上做正式安装包验收：新建对话看首页卡片、运行雷达并入库、点击带页码引用、运行 5 篇论文证据矩阵。用户需要准备测试 Vault、若干本地 PDF 和模型 API。
