# OmicOS 六个 PR 实现证据

本文件记录每个 PR 的代码门禁和验收状态；只有真实启动的会话或真实安装包证据才标记为 PASS。

## PR1：新文献雷达与连接器

状态：代码实现完成；真实会话验收待执行。

- 新增 `arxiv` 与 `semantic-scholar` 只读连接器，加入默认 registry，资料页连接器开关自动可见且默认启用。
- Semantic Scholar 支持无 key 公共接口、可选 host 配置 API key、推荐查询；HTTP 429 保留为 retryable 失败。
- arXiv 使用 submittedDate 倒序 Atom 检索，保留作者、提交时间和 arXiv id。
- 每日雷达读取活跃课题，限制每课题 2 条、总计 12 条查询；检索 OpenAlex、PubMed、Europe PMC、arXiv、Semantic Scholar，合并最近 7 天命中并按 DOI → arXiv id → 标题去重，最多持久化 50 条。
- `DailyDiscoveryState.radar` 已接入 JsonStore、Knowledge IPC 和知识库主页“新文献”分区；打开、入库、忽略动作已接线，入库使用 `captureResearchResource` 生成项目内的来源元数据记录。
- 单测覆盖连接器解析、429 retryable、每日雷达无新笔记运行、查询去重和临时失败不计当天运行。

已运行：

- `npx vitest run packages/backend/test/daily-discovery.test.ts packages/research/test/connectors.test.ts`：46 tests passed（含 integration mirror）。
- `npm run typecheck`：通过。
- `npx biome check`：相关文件通过。

待补真实证据：绑定测试 Vault 后运行一次雷达，确认返回最近 7 天论文、入库记录出现在知识库，并在同日重复运行不重复推送；同时验证设置中关闭全部雷达连接器时的诊断结果。

## PR2：引用跳转到 PDF 原文页码

状态：代码实现完成；真实会话验收待执行。

- PDF worker 按页输出 `[[page:N]]` 边界，允许受控扩大读取页数，并刷新 checked-in compiled artifact 与 manifest。
- `research_read_source` 从实际读取文本解析页码范围；来源回执和 citations 记录 `page_start/page_end/pages`，仅在读到页时生成 `#page=N`。
- Markdown 资源链接保留 fragment；预览宿主把 `page=N` 传给 PDF viewer，越界回到第 1 页并显示双语提示。
- 当前边界：`@gyoungwe/pi-research` 直接搜索的是 Markdown/文本来源；原始 `.pdf` 必须先由宿主 PDF worker 转成带 `[[page:N]]` 的来源记录，插件本身不会直接枚举或解析 PDF 文件夹。PR4 技能的“项目内 PDF 文件夹”正向验收也因此需要先确认宿主预处理路径，不能把现有 loader 结果当作完成证明。

已运行：

- `npx vitest run packages/pi-research/src/evidence-loop.test.ts packages/desktop/src/renderer/src/components/preview/preview-registry.test.ts packages/desktop/src/renderer/src/components/preview/viewers/viewers.test.tsx`：13 tests passed（含 integration mirror）。
- `npm run typecheck`：通过。
- `npx biome check`：相关文件通过。

待补真实证据：真实会话读取包含第五页的 PDF，点击带页码引用确认预览直接落到目标页，并记录越界回退行为。

## PR3：新会话首页上下文卡片

状态：代码实现完成；真实安装包验收待执行。

- 新会话首页在有数据时显示最多三个活跃课题、今日新想法和新文献雷达；没有 Vault 或对应数据时不渲染这些上下文卡片。
- 课题按钮把“继续课题：<标题>”写入现有 composer draft 并聚焦输入框；今日发现和新文献按钮只读跳转到知识库。
- 复用现有 `getKnowledgeOverview`、`getKnowledgeTopics` 和 `getDailyDiscovery`，未新增写入 API。

已运行：

- `npx vitest run packages/desktop/src/renderer/src/components/chat/home-cards.test.ts`：4 tests passed。
- `npx biome check`：HomeCards 与双语文案通过。

待补真实证据：真实安装包新建对话显示三类卡片；无 Vault 的全新安装不显示空卡片。

## PR4：批量精读 → 证据矩阵

状态：技能与示例入口实现完成；真实会话验收待执行。

- 新增 `.pi/skills/literature-matrix/SKILL.md`，支持 Zotero 集合、DOI 列表和项目 PDF 文件夹；每批上限 12 篇，按 DOI → arXiv id → 标题/路径去重。
- 每篇论文由受限子代理调用 `research_read_source`，固定提取六个字段；只有当前读取回执中的 `[[page:N]]` 才能写入带页码结论，读不到原文统一标记“未读到原文”，禁止用摘要补全。
- 父会话输出 UTF-8 Markdown + CSV，并仅在存在实际原文读取回执时调用 `research_deposit_knowledge`；写入失败保留本地交付物并报告原因。
- `evidence-literature` 方向新增 `literature-matrix` 结构化入口元数据，未改变现有一方向一卡片的 UI 合同。

已运行：

- `npm run skills:check`：通过（nature 20/745、scientific 148/1806）。
- `npx vitest run packages/shared/src/example-tasks.test.ts packages/desktop/src/renderer/src/components/tasks/example-tasks.test.ts packages/backend/test/skill-acceptance-sdk.test.mjs`：34 tests passed（含 integration mirror）。
- `git diff --check`：通过。

待补真实证据：真实会话处理 5 篇论文（含 1 篇无法获取全文），确认矩阵五行、未读标记和 CSV 可由表格软件打开，并保留知识库沉淀回执。

## PR5：Paper2Agent 接入文档与 README 修正

状态：文档实现完成；真实会话验收待执行。

- 新增 [`docs/paper2agent.md`](../paper2agent.md)，说明 Paper2Agent 生成 MCP 服务器，提供 Pi `mcp.json` 的本地 stdio 与远程 URL 示例，并明确工具输出是交付物/线索，不是原文证据。
- `docs/INDEX.md`、README 中英文的连接器入口已链接该文档。
- README 中已移除已下线的鲸鱼娘桌宠截图和“内置两只”描述，保留通用聊天与设置演示。

已运行：

- `git diff --check`：通过。
- README、索引和配置示例的链接与 JSON 结构已人工核对。

待补真实证据：按文档在本机接入一个公开 Paper2Agent MCP 服务器，在会话中完成一次工具调用并保留截图；工具输出不得作为证据回执。

## PR6：PDF 解析质量评估

状态：评估脚本与本地结果完成；真实会话验收不适用，结论待用户决定是否进入下一轮集成。

- `fixtures/pdf-hard/manifest.json` 登记 10 篇 arXiv 开放获取论文、来源 URL、许可证和分类，覆盖双栏、公式密集、跨页表格、扫描版派生样本各至少 2 篇；参考文本与扫描派生说明一并保存。
- `scripts/eval-pdf-parsing.mjs` 可重跑当前 `pdf.js`，并在 `MINERU_BIN` 或 `GROBID_URL` 未配置时逐篇报告 `unavailable`；本轮没有安装或接入 MinerU/GROBID。
- [`docs/evals/pdf-parsing-2026-10-22.json`](../evals/pdf-parsing-2026-10-22.json) 记录正文字符召回、表格结构、公式可读性、参考文献计数和耗时；结论文档记录安装体积与本地/API 取舍。

已运行：

- `node scripts/eval-pdf-parsing.mjs --out /tmp/drone-pdf-eval.json --conclusion /tmp/drone-pdf-eval.md`：10/10 篇由 pdf.js 完成解析；MinerU、GROBID 各 10/10 条明确为 unavailable。
- `npx biome check scripts/eval-pdf-parsing.mjs`：通过。

限制：参考文本是可重跑的 `pdftotext` 对照代理，不等同人工逐页真值；表格和公式指标是启发式，需人工抽样后再决定集成。此 PR 不改变安装包或默认解析流程。

## 主线最终门禁

截至 `main` 的 `5bd1c3a6`，两仓库联动的主线验证已完成：

- `npm run lint`：通过（仅既有大文件大小警告）。
- `npm run typecheck`：通过，包含锁定的知识插件抓取/构建。
- `npm test`：通过；backend 231/231 文件、1896 tests，desktop 159/159、820 tests，其余 workspace 和脚本门禁均通过。
- `npm run build`：通过，生成 Desktop renderer 和 Pi 包产物。
- `npm run check:arch`：通过（0 baseline findings，宿主独立性通过）。
- `npm run check:plugin-api`：通过 migration/lifecycle（安装、升级、回滚、卸载 PASS）。
- `npm run skills:check` 与 `npm run check:ui-skill-acceptance`：通过；UI-01、SKILL-01 PASS。

真实 Vault/正式安装包证据仍按 handoff 保持待办：雷达实际运行与入库、带页码引用点击、首页三类卡片、5 篇证据矩阵和 Paper2Agent 公共服务器调用；这些不能由本地 fixture 或离线 loader 代替。

## 2026-10-22 实机抽检补充

使用当前构建包 `packages/desktop/dist/mac-arm64/Drone.app` 启动真实 Vault `/Users/gaoyangwei/Documents/Dronevault`：

- 知识库页显示 `ObsidianResearchVault`、100 篇笔记和已有 arXiv/LoRA 来源记录，证明当前构建包能读取真实 Vault 状态。
- 新建会话首页在当前 Vault 没有活跃课题、今日新想法和新文献雷达条目时，仅显示原有“研究 / 知识库 / 接力”卡片；上下文卡片没有以空状态出现，T3 的无数据路径通过。
- 真实会话尝试先后使用 `Gemini 3.8 Flash (Antigravity)` 和 `GPT-6.1 Sol`，均显示“模型请求失败：凭证无效”。因此本次没有把雷达运行、页码引用点击或五篇矩阵标成 PASS，也没有写入新的 Vault 结果。
- `/Applications/Drone.app` 仍是较早构建；正向安装包验收应在安装当前构建并恢复有效模型凭证后执行。
