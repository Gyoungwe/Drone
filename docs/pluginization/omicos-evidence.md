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

状态：评估脚本与结果待完成。
