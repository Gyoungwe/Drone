# OmicOS 六个 PR 实现证据

本文件记录每个 PR 的代码门禁和验收状态；只有真实启动的会话或真实安装包证据才标记为 PASS。

## PR1：新文献雷达与连接器

状态：代码实现完成；真实构建包雷达验收部分通过。

- 新增 `arxiv` 与 `semantic-scholar` 只读连接器，加入默认 registry，资料页连接器开关自动可见且默认启用。
- Semantic Scholar 支持无 key 公共接口、可选 host 配置 API key、推荐查询；HTTP 429 保留为 retryable 失败。
- arXiv 使用 submittedDate 倒序 Atom 检索，保留作者、提交时间和 arXiv id。
- 每日雷达读取活跃课题，限制每课题 2 条、总计 12 条查询；检索 OpenAlex、PubMed、Europe PMC、arXiv、Semantic Scholar，合并最近 7 天命中并按 DOI → arXiv id → 标题去重，最多持久化 50 条。
- `DailyDiscoveryState.radar` 已接入 JsonStore、Knowledge IPC 和知识库主页“新文献”分区；打开、入库、忽略动作已接线，入库使用 `captureResearchResource` 生成项目内的来源元数据记录。
- 单测覆盖连接器解析、429 retryable、每日雷达无新笔记运行、查询去重、部分连接器成功和临时失败不计当天运行。

已运行：

- `npx vitest run packages/backend/test/daily-discovery.test.ts packages/research/test/connectors.test.ts`：48 tests passed（含 integration mirror）；覆盖 Vault 标题仅有、命中带 DOI 时的标题回退去重。
- `npm run typecheck`：通过。
- `npx biome check`：相关文件通过。

真实构建包证据（2026-10-22）：在临时 Vault `/tmp/drone-omicos-live-20261022` 中绑定两个活跃课题，打开知识库页的“现在运行”，页面显示“新文献”分区和真实返回的 Europe PMC、arXiv 条目，通知显示发现 10 篇近期文献；再次运行后已有条目没有重复，新增结果仍按 DOI/arXiv id/标题合并。OpenAlex 与 Semantic Scholar 在该临时环境因公共端点 HTTP 429 暂停，arXiv、PubMed、Europe PMC 继续启用；因此连接器代码和 arXiv 真实命中通过，Semantic Scholar 真实 Drone 会话仍待有效 API key 或限流解除后补验。

## PR2：引用跳转到 PDF 原文页码

状态：代码实现完成；真实会话页码引用验收通过。

- PDF worker 按页输出 `[[page:N]]` 边界，允许受控扩大读取页数，并刷新 checked-in compiled artifact 与 manifest。
- `research_read_source` 从实际读取文本解析页码范围；来源回执和 citations 记录 `page_start/page_end/pages`，仅在读到页时生成 `#page=N`。
- Markdown 资源链接保留 fragment；预览宿主把 `page=N` 传给 PDF viewer，越界回到第 1 页并显示双语提示。
- `@gyoungwe/pi-research` 已补直接 PDF 桥接：`research_search_sources` 会发现项目目录中的 `.pdf`，使用随包的 pdf.js 生成带 `[[page:N]]` 的文本；`research_read_source` 的回执记录实际页码范围，引用 URI 保留相对 PDF 路径。宿主 `pdf-worker.ts` 路径仍保留用于其他任务运行时。

已运行：

- `npx vitest run packages/pi-research/src/evidence-loop.test.ts packages/desktop/src/renderer/src/components/preview/preview-registry.test.ts packages/desktop/src/renderer/src/components/preview/viewers/viewers.test.tsx`：13 tests passed（含 integration mirror）。
- `node scripts/smoke-pi-research.mjs`：直接源码包与 `npm pack` 解包均发现并读取 PDF，回执包含 `page_start/page_end` 和 `[[page:1]]`。
- `npm run check:pi-research`、`npm run check:arch`、`npm run check:public-plugin-host`：通过。
- `npm run typecheck`：通过。
- `npx biome check`：相关文件通过。

真实会话证据（2026-10-22）：使用当前构建包和 DeepSeek V4.1 Flash 读取临时项目 `papers/dhx16-monograph.pdf`；会话输出 `[p.5] 全基因组挖掘方法学体系（Genome-Wide Mining Methodology）`，并给出 PDF 文件链接。点击该链接打开内置 PDF 预览，连续翻页后显示“第 5 / 8 页”，证明文件引用可打开且页码导航落到被引用页。该会话还记录了二进制 PDF 不能直接由 `research_read_source` 索引，先用只读 `pdftotext -f 5 -l 5` 生成页证据再读取；因此页码来源可核对。越界回退路径仍由单测覆盖，未在本轮重复人工操作。

## PR3：新会话首页上下文卡片

状态：代码实现完成；真实安装包无数据路径和正向三类卡片均通过。

- 新会话首页在有数据时显示最多三个活跃课题、今日新想法和新文献雷达；没有 Vault 或对应数据时不渲染这些上下文卡片。
- 课题按钮把“继续课题：<标题>”写入现有 composer draft 并聚焦输入框；今日发现和新文献按钮只读跳转到知识库。
- 复用现有 `getKnowledgeOverview`、`getKnowledgeTopics` 和 `getDailyDiscovery`，未新增写入 API。

已运行：

- `npx vitest run packages/desktop/src/renderer/src/components/chat/home-cards.test.ts`：4 tests passed。
- `npx biome check`：HomeCards 与双语文案通过。

- 当前构建包真实临时 Vault 验收：知识库页已挂载“新想法 / 新文献”每日发现分区；新建会话在无新想法时仍不显示空上下文卡片。

真实会话证据（2026-10-22）：在当前目录包和 DeepSeek 临时验收项目中写入两条活跃主题、一条 `status=new` 的今日发现和一条 `status=new` 的雷达条目，重启并重新打开新会话首页后真实 UI 显示“活跃课题 / Cell atlas、Genome editing”“今日发现：跨模态验证”和“新文献 / Real OmicOS literature signal”三类上下文卡片。无 Vault 的全新安装不显示空卡片的负向路径也已通过。

## PR4：批量精读 → 证据矩阵

状态：技能与示例入口实现完成；真实会话五行矩阵核对和知识库沉淀回执通过。

- 新增 `.pi/skills/literature-matrix/SKILL.md`，支持 Zotero 集合、DOI 列表和项目 PDF 文件夹；每批上限 12 篇，按 DOI → arXiv id → 标题/路径去重。
- 每篇论文由受限子代理调用 `research_read_source`，固定提取六个字段；只有当前读取回执中的 `[[page:N]]` 才能写入带页码结论，读不到原文统一标记“未读到原文”，禁止用摘要补全。
- 父会话输出 UTF-8 Markdown + CSV，并仅在存在实际原文读取回执时调用 `research_deposit_knowledge`；写入失败保留本地交付物并报告原因。
- `evidence-literature` 方向新增 `literature-matrix` 结构化入口元数据，未改变现有一方向一卡片的 UI 合同。

已运行：

- `npm run skills:check`：通过（nature 20/745、scientific 148/1806）。
- `npx vitest run packages/shared/src/example-tasks.test.ts packages/desktop/src/renderer/src/components/tasks/example-tasks.test.ts packages/backend/test/skill-acceptance-sdk.test.mjs`：34 tests passed（含 integration mirror）。
- `git diff --check`：通过。

真实会话证据（2026-10-22）：五篇 PDF 的逐页文本生成后，`literature-matrix.md` 与 `literature-matrix.csv` 更新为 5 行、8 列字段、每篇带 `[p.1]` 原文结论；DeepSeek 真实会话读取两个文件并确认结构、页码和非骨架内容。修正临时 Vault 的 `/tmp` 与 `/private/tmp` 绑定路径后，重新调用 `research_deposit_knowledge` 成功，回执写入 `/private/tmp/drone-omicos-deepseek-20261022/Projects/omicos-acceptance/Evidence/omicos.md`，`type=evidence`、`project=omicos-acceptance`、`unresolvedSources=[]`。回执明确 `scientificallyVerified:false`，表示这是证据整理沉淀而非科学核验；该限制符合技能门禁，不阻止本 PR 的“读取→矩阵→沉淀”验收通过。

## PR5：Paper2Agent 接入文档与 README 修正

状态：文档实现完成；真实会话完成服务器发现，工具调用被宿主审批门禁拦截。

- 新增 [`docs/paper2agent.md`](../paper2agent.md)，说明 Paper2Agent 生成 MCP 服务器，提供 Pi `mcp.json` 的本地 stdio 与远程 URL 示例，并明确工具输出是交付物/线索，不是原文证据。
- `docs/INDEX.md`、README 中英文的连接器入口已链接该文档。
- README 中已移除已下线的鲸鱼娘桌宠截图和“内置两只”描述，保留通用聊天与设置演示。

已运行：

- `git diff --check`：通过。
- README、索引和配置示例的链接与 JSON 结构已人工核对。
- 宿主回执回归：`npm test` 中的 `mcp-adapter-bundle-sdk.test.ts` 和
  `mcp-enabled-adapter-sdk.test.ts` 使用真实 `DefaultResourceLoader`、真实会话和内置
  `pi-mcp-adapter`，通过本地 stdio fixture 发现工具并执行 `mcp` 代理，返回内容包含
  `echo:hi`；这证明 Drone 本地 MCP 执行/回执链路可用，但不替代公开 Paper2Agent
  端点的真实安装包验收。

真实会话证据（2026-10-22）：在真实安装的 Drone（`/Applications/Drone.app`）中接入 `https://Paper2Agent-alphagenome-mcp.hf.space/mcp`，刷新后真实 UI 显示 `paper2agent-remote` 已探测 22 个工具。第一次会话按宿主要求调用 `task_plan`，人工批准后确实生成了 `mcp__paper2agent_remote.create_genomic_interval` 调用；宿主没有收到回执，把它记为 `started/unknown`，模型随后被幂等门禁阻止重放。第二次会话使用已发现的正确 schema（`chromosome`, `start`, `end`, `strand`, `name`, `out_prefix`），再次批准 `task_plan` 后仍没有回执，任务进入 `reconcile-before-retry`，最终真实 UI 报告“没有任何 MCP 回执”。因此服务器发现和审批流程通过，但 Drone 宿主内的工具执行/回执闭环仍未通过，PR5 不标 PASS。

2026-10-22 外部连通性探测：按文档使用公开的 AlphaGenome Paper2Agent MCP 地址完成协议初始化和工具清单探测；公开端点可访问，但直接请求在未建立完整会话头时返回参数错误。该探测不能替代 Drone 真实会话证据。最终阻塞点是宿主运行时的 MCP 调用回执未返回，而不是把外部 curl 结果冒充成调用 PASS。

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

截至 `main` 的 `c5959275`，两仓库联动的主线验证已完成；本轮修复后的门禁结果如下：

- `npm run lint`：通过（仅既有大文件大小警告）。
- `npm run typecheck`：通过，包含锁定的知识插件抓取/构建。
- `npm test`：通过；backend 231/231 文件、1898 tests，desktop 159/159、820 tests，其余 workspace 和脚本门禁均通过。
- `npm run build`：通过，生成 Desktop renderer 和 Pi 包产物。
- `npm run check:arch`：通过（0 baseline findings，宿主独立性通过）。
- `npm run check:plugin-api`：通过 migration/lifecycle（安装、升级、回滚、卸载 PASS）。
- `npm run skills:check` 与 `npm run check:ui-skill-acceptance`：通过；UI-01、SKILL-01 PASS。

- 本轮修复后：`npm run lint`、`npm run typecheck`、`npm test`、`npm run build`、`npm run check:arch`、`npm run check:plugin-api -- --migration --lifecycle`、`npm run skills:check` 和 `npm run check:ui-skill-acceptance` 均通过。

真实 Vault/正式安装包仍有一项待办：PR5 Paper2Agent 工具实际执行并取得回执。当前证据已覆盖安装、发现、task_plan 批准、实际调用发起和未知结果保护，但没有可核对的 MCP 回执，不能标记 PASS。PR2 页码引用点击、PR3 三类首页卡片和 PR4 五行矩阵沉淀已通过；临时 Vault 的真实雷达运行与去重证据已补充在 PR1 段落中。

## 2026-10-22 实机抽检补充

使用当前构建包 `packages/desktop/dist/mac-arm64/Drone.app` 启动真实 Vault `/Users/gaoyangwei/Documents/Dronevault`：

- 知识库页显示 `ObsidianResearchVault`、100 篇笔记和已有 arXiv/LoRA 来源记录，证明当前构建包能读取真实 Vault 状态。
- 新建会话首页在当前 Vault 没有活跃课题、今日新想法和新文献雷达条目时，仅显示原有“研究 / 知识库 / 接力”卡片；上下文卡片没有以空状态出现，T3 的无数据路径通过。
- 重新打包后的当前 `packages/desktop/dist/mac-arm64/Drone.app` 在真实连接器页列出并启用了 `arXiv`、`Semantic Scholar`。标准 `npm run dist` 因本机 `cpu-features` 缺失 `buildcheck.gypi` 在原生重编译阶段失败，使用 `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --dir --config.npmRebuild=false` 生成了可启动的未签名目录包，源码 registry 因而得到真实 app 证据。
- PDF 桥接修复后的最新目录包再次启动成功；真实连接器页仍显示 `arXiv`、`Semantic Scholar`，插件页显示 `@gyoungwe/pi-research` 内置且已启用。
- 真实会话先后尝试 `Gemini 3.8 Flash (Antigravity)` 和 `GPT-6.1 Sol`，均显示“模型请求失败：凭证无效”；随后使用 DeepSeek V4.1 Flash 成功完成简单回答、PDF 页码引用、文件预览、三类首页卡片和矩阵沉淀。Paper2Agent 实际调用仍被宿主审批门禁拦截，PR1 正式 Vault 雷达仍保持部分通过状态。
- `/Applications/Drone.app` 仍是较早构建；正向签名/安装包验收应在安装当前构建并恢复有效模型凭证后执行。
