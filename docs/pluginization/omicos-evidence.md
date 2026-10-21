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

## PR2–PR6

尚未开始，按 [`docs/omicos-platform-plan.md`](../omicos-platform-plan.md) 的顺序执行。
