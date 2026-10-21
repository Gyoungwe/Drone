# 下一轮迭代 · 文献雷达与阅读闭环（2026-10-22）

> 来源：Claude 对照 OmicOS RSI 发布文与 Drone main `bc7a33a`（v0.33.4）的差距分析（项目文档 `claude/drone-omicos-gap-analysis.md`）。按顺序做，每一项开一个 PR；完成标准沿用 `pluginization-ui-handoff.md` §2。**不要做本文以外的事。**

## 0. 规则（沿用 `next-iteration-handoff.md` §0，另加三条）
- 不新增安全门、确认流程或抽象层；复用现有的连接器 registry、捕获流程、`JsonStore`、子代理和 `window.pi` host API。
- 新增 IPC 四处同步；新增文案中英双字典；JSON 持久化一律走 `JsonStore`。
- 雷达和批量精读拿到的外部结果只是**线索**：没有经过 `research_read_source` 读原文，不得进入证据或被当作引用。
- 声明 PASS 的证据必须来自真实启动的会话或安装包；fixture 只能做 CI 回归。

## 1. 新文献雷达（并入每日发现）
**现状**：`packages/backend/src/services/daily-discovery.ts` 只对照知识库里新旧笔记，不看外部新论文。

**要做**：
1. 新增两个只读连接器，进入 `packages/research/src/connectors.ts` 的 registry，返回同一份 `ResearchConnectorSourceReceipt`：
   - `semantic-scholar`：检索 + 推荐接口（按种子论文找相关论文）。没有 API key 也要能用，有 key 时从设置读取；429 返回 retryable 失败。
   - `arxiv`：原生检索接口，按提交日期排序。bioRxiv/medRxiv 本轮**不做**。
   - 两个连接器都出现在资料页的逐项开关里，默认开启，关闭后雷达跳过它们。
2. 雷达查询：每天随每日发现运行一次。
   - 查询来源：主题记忆（`topic-memory`）中状态为活跃的课题标题和实体，以及最近 30 天在 Zotero 新增条目的 DOI（作为 Semantic Scholar 推荐的种子）。每个课题最多 2 条查询，总查询数上限 12。
   - 数据源：已启用的 OpenAlex、PubMed、Europe PMC、arXiv（按发表日期过滤最近 7 天），以及 Semantic Scholar 推荐。
   - 去重：按 DOI → arXiv id → 规范化标题，与 Vault 已有来源、Zotero 条目和之前推送过的雷达条目去重。
   - 每次最多保留 10 条，按"命中课题数 + 是否被推荐接口命中"排序。不调用模型打分。
3. 数据结构：在 `packages/shared/src/knowledge.ts` 的 `DailyDiscoveryState` 里新增 `radar: RadarPaper[]`（标题、作者、年份、DOI/locator、来源连接器、命中的课题 id 与标题、相关 Vault 笔记路径、发现时间、状态 `new | captured | dismissed`），上限 50 条，旧的滚出。
4. 界面：`packages/desktop/src/renderer/src/components/knowledge/DailyIdeas.tsx` 所在卡片新增"新文献"分组；每条显示标题、来源、"与课题 X 相关"，按钮为「入库」「忽略」「打开」。「入库」走现有 `captureResearchResource` 捕获流程，不新建写入路径。
5. 运行结果写入 `lastOutcome`，区分"没有活跃课题""连接器全部关闭""没有新论文""找到 N 篇"。

**验收**：
- 单元测试：去重（DOI/arXiv id/标题三级）、7 天窗口、查询上限、连接器关闭时跳过、429 不计为已运行。
- 真实会话：绑定一个有 2 个课题的测试 Vault，运行「现在看看」，至少返回 1 篇最近 7 天的论文；点「入库」后知识库出现对应来源记录；同一天再次运行不重复推送。

## 2. 点击引用跳到 PDF 原文页码
**现状**：回答里的链接由 `components/chat/Markdown.tsx` 处理，只能打开 Vault 笔记或本地文件；`PdfViewer.tsx` 总是从第 1 页开始，没有页码参数；读原文的结果不带页码。

**要做**：
1. `packages/tasks/src/runtime/pdf-worker.ts` 按页提取文本，`research_read_source` 读 PDF 时在返回内容中保留页边界（如 `[[page:12]]`），并在来源回执中记录被读到的页码范围。
2. 学术回答模式的引用格式增加可选页码：链接写成 `<本地路径或 Vault 链接>#page=12`。只在模型确实读到该页时才写页码，在 `session-engine/harness/context.ts` 的学术回答指引里说明。
3. `Markdown.tsx` 解析 `#page=N`；`PreviewRendererProps` 增加可选 `initialPage`；`PdfViewer` 打开时跳到该页。Vault 笔记引用不变。
4. 页码超出范围时打开第 1 页并给出提示，不报错。

**验收**：
- 单元测试：`#page=` 解析、越界回退、pdf-worker 页边界输出。
- 真实会话：用一篇本地 PDF 问一个答案在第 5 页以后的问题，学术模式回答中的引用点开后直接显示对应页。

## 3. 新会话首页带上下文
**现状**：`EmptyState.tsx` + `HomeCards.tsx` 只有通用卡片；恢复课题需要调用 `research_resume_topic`。

**要做**：在 `HomeCards` 中新增一行（数据都已存在，只做展示）：
1. **继续课题**：当前项目最近更新的 3 个活跃课题；点击后把「继续课题：<标题>」填入输入框并发送，由模型调用 `research_resume_topic`。
2. **今日发现**：每日发现里状态为 `new` 的想法数量和第一条标题，点击跳到知识库对应卡片。
3. **新文献**：第 1 项雷达中状态为 `new` 的数量和第一条标题，点击跳到知识库对应分组。
- 没有绑定 Vault、没有数据时，对应卡片不显示（不显示空卡片）。
- 新增的 host API 只读，不新增写入。

**验收**：真实安装包上，新建对话即可看到三张卡片；无 Vault 的全新安装只显示原有卡片。

## 4. 批量精读 → 证据矩阵
**要做**（不改子代理机制，只加技能和示例）：
1. 在 `.pi/skills/` 新增技能 `literature-matrix`：输入为一组论文（Zotero 集合、DOI 列表或项目内 PDF 文件夹）和一个研究问题。
   - 每篇论文交给一个子代理，用 `research_read_source` 读原文，按固定字段提取：研究问题、方法、数据/样本、主要结论（带页码）、局限、与研究问题的关系。读不到原文的论文标记"未读到原文"，不得凭摘要补全。
   - 父会话汇总成表格（Markdown + CSV 写到项目目录），并用 `research_deposit_knowledge` 把矩阵存入知识库。
   - 每批最多 12 篇；超过时分批并告知用户。
2. 在 `packages/shared/src/example-tasks.json` 的 `evidence-literature` 方向下补一个示例入口。
3. 技能需要通过 `npm run skills:check` 和 SKILL-01 验收。

**验收**：真实会话里对 5 篇论文（含 1 篇无法获取全文）跑通，得到 5 行矩阵，其中 1 行标记"未读到原文"；CSV 能用表格软件打开。

## 5. Paper2Agent 接入文档
**要做**：
1. 新增 `docs/paper2agent.md`：说明 Paper2Agent 生成的是 MCP 服务器，给出在 Drone 设置 → MCP 中添加的配置示例（本地 stdio 和远程 url 各一个），并说明其工具输出按"交付物"处理，不作为证据。
2. 在 `docs/INDEX.md` 和 README（中英）"连接器"部分各加一行链接。
3. 不加预设、不写代码。

**验收**：按文档在本机接入一个公开的 Paper2Agent 服务器，在会话中调用一次其工具并截图。

## 6. PDF 解析质量评估（只评估，不集成）
**要做**：
1. 选 10 篇难解析的 PDF 放进 `fixtures/pdf-hard/`（双栏、公式密集、跨页表格、扫描件各至少 2 篇；只用开放获取论文并记录许可）。
2. 写 `scripts/eval-pdf-parsing.mjs`：对比当前 pdf.js、MinerU、GROBID 三种解析的结果，指标为正文字符召回（对照人工校对的参考文本）、表格结构是否保留、公式是否可读、参考文献抽取条数、耗时。
3. 结果写进 `docs/evals/pdf-parsing-<日期>.json`，并附一页结论：是否值得作为可选后端、本地还是 API、安装体积。

**验收**：评估脚本可重跑；结论文档由用户决定是否进入下一轮集成。**本轮不得把 MinerU 或 GROBID 加入安装包或默认流程。**

## 7. 不做
- 划词翻译（本轮不排期）。
- bioRxiv/medRxiv 连接器、远程 MCP 预设（SciSpace、Elicit 等）。
- 宠物、手机端/网页同步、可编辑画布、语音输入、云端自进化。
- B8 / B8-2 云端协作。

## 8. 顺带修正
- README（中英）仍展示鲸鱼娘桌宠截图并写"内置两只"，但 10-20 已下线：删除或替换截图与描述，并入第 5 项的 PR。

## 9. 完成后交给用户
- 每个 PR 的链接和 CI 结果。
- 第 1 项附一次真实运行的雷达结果截图；第 6 项附评估 JSON 和结论。
- 然后由 Claude 在用户的 Mac 上做实机验证：安装正式包 → 新建对话看首页卡片 → 运行雷达并入库一篇 → 学术模式提问并点击带页码的引用 → 跑一次 5 篇论文的证据矩阵。需要用户准备测试 Vault（含 2 个课题）、几篇本地 PDF 和模型 API。
