# Drone 第 9 项发布收口与第 10 项科研风格客户端升级计划

**版本基线：** v0.26.0 (`4cb28d32cd7af709f7e71917cceae636260393ef`)
**候选整合：** `codex/v0261-integration`，验证代码提交 `7c1d346`（文档整理提交随后追加）
**输入：** 1–6 本地改动、PR #113（知识网络观测台 + WebDAV 显式同步）、客户端静态交互审计
**范围：** 先把可审查的整合/发布闭环建立起来，再按科研工作台原则升级 renderer；本计划不自动创建 tag、合并远程 PR 或发布安装包。

## 一、第 9 项：发布治理、整合和收口

### 9.1 目标和不可变边界

1. 把 **源代码、生成产物、运行时检查、测试、打包资产、发布 tag** 绑定到同一个候选 commit。
2. 把 PR、main、release 三套门禁变成一份可版本化的 gate manifest，避免 PR113 这类“定向测试通过但 runtime 过期”再次进入合并队列。
3. 保留已发布的 v0.26.0，不移动 tag、不覆盖其 release asset；下一次只从完全验证的候选 commit 创建 v0.26.1。
4. 所有会写远端仓库、创建 tag、上传 asset、发布 draft 的动作继续由显式 review 触发。

### 9.2 收口阶段和出口条件

| 阶段 | 工作 | 必须留下的证据 | 出口条件 |
|---|---|---|---|
| G0 整合冻结 | 从 main + PR113 + 1–6 建立整合分支；锁定 package lock、Node 版本、源 commit | commit graph、changed-files、生成物 diff | 工作树干净；无未审查 secret/用户数据 |
| G1 生成物一致性 | `build:extensions -- --force`、`build:knowledge`、`build:research`、已有 tasks build；再运行各 `check:*` | manifest 输入哈希、产物文件列表和 SHA-256 | `check:extensions/knowledge/tasks/research` 全部通过 |
| G2 静态与单元门禁 | lint、全 workspace typecheck、architecture、plugin API、research packaging、全 `npm test` | 每个命令的 exit code、测试文件/数量、skip 原因 | 所有 required checks 绿；不能用定向测试替代整合测试 |
| G3 新增可靠性门禁 | durable session SIGKILL/restart/idempotency；WebDAV CAS 并发冲突；知识图谱布局/性能；图谱键盘/读屏 | 可重放 fixture、p95、revision/hash/ETag trace、a11y assertions | P1 性能/布局风险有修复证据；P2 有测试或书面接受期限 |
| G4 候选验证 | 更新 v0.26.1 validation record，使用同一 candidate SHA 在 Windows runner 执行完整序列 | candidate manifest、runner、时间、日志链接、资产预期清单 | Windows validation 全绿，且没有 stale generated resource |
| G5 多平台构建 | mac arm64/x64、Windows x64 构建；检查 required asset 名称、大小、SHA-256、更新器 metadata | 每个 asset 的平台、SHA-256、构建 commit、签名结果 | 全部 expected assets 生成且包内 Pi/MCP/knowledge runtime 自洽 |
| G6 草稿发布 | 只创建 draft release，核对 tag 指向 candidate SHA，上传资产并重新列举 | draft release URL、tag object SHA、asset listing | reviewer 核对 tag/asset/notes 完全一致 |
| G7 正式发布与回滚 | 由维护者将 draft 设为 published；若任一验证失败，关闭/隔离候选，不触碰 v0.26.0 | 发布结果、安装器 smoke、回滚说明 | 只有明确批准后才完成 publish |

### 9.3 CI 和 release workflow 的具体改造

**统一 gate manifest。** 新增一个版本化的 JSON/Markdown 清单，列出命令、适用阶段、预期产物、允许 skip 和证据格式。PR CI、main CI、release `validate` 都从同一清单生成 job；任何新增 runtime source 时，manifest check 失败并给出重建命令。

**把生成物检查放在测试之前。** `stage:pi-packages` 后先执行 `check:extensions`、`check:knowledge-runtime`、`check:tasks-runtime`、`check:research-runtime`，这样不会出现长时间单测通过后才发现 bundle 过期。PR required checks 必须包括 knowledge runtime，这正是 PR #113 漏掉的门禁。

**消除 release 与 main 的漂移。** 通过 reusable workflow 或共享脚本复用 lint/typecheck/arch/plugin/runtime/package/build 命令；每次变更 gate manifest 时要求 review release workflow。release 当前只构建 macOS arm64/x64 与 Windows x64，Linux 继续明确为不在 v0.26.x acceptance matrix 中，不能在文档中暗示 Linux 资产已发布。

**将 tag 创建移到验证之后。** `resolve` 目前可在 validate 之前创建并 push 版本 tag。改为：候选 commit 先完成 G0–G4；只有 validation 成功后，在受保护的 publish job 中创建或验证 tag，再进入 draft release。手动输入已存在 tag 时仍必须验证 tag SHA 与 candidate SHA 完全一致。

**资产完整性。** 构建 job 为每个 DMG/ZIP/EXE/blockmap/YAML 生成 SHA-256 清单；publish job 同时核对文件名、大小、hash、tag SHA 和 draft release asset listing。失败不使用 `--clobber` 覆盖不同 hash 的资产，改为报告冲突并停止。

**可观察性与恢复。** 每个候选都保存 `candidate.json`：source SHA、package version、Node/npm、gate manifest revision、生成物 manifest hashes、测试摘要、平台资产 hashes。失败阶段可从该文件恢复，而不是凭聊天记录推断已完成步骤。

### 9.4 PR #113 的合入前清单

- [x] WebDAV 4 项同步测试和语义模型 4 项测试通过。
- [x] 6 个扩展与知识 runtime 重新生成，并在整合分支通过 check。
- [x] research runtime 因知识模型依赖变更而重新生成并通过 check。
- [x] 完整 `npm test`、lint、typecheck、arch、plugin API、research packaging、Pi package、build、upgrade fixtures 通过。
- [ ] 将知识图谱建模限制在服务端候选上限，补 1k/2k/5k/10k 性能预算和 p95 记录。
- [ ] 修正超过 5 个主节点的布局出界，补 1、5、10、50 节点边界测试。
- [ ] 移除 SVG 原子 `role="img"` 对内部节点按钮的遮蔽风险，补 Enter/Space/focus/reduced-motion 测试。
- [ ] 将 WebDAV remote-overwrite 改为带期望 hash/签名的 compare-and-swap，补编辑器并发写回归。
- [ ] 在 PR required checks 中加入以上四类门禁，并重新运行整合 CI。

## 二、第 10 项：每个客户端页面、控件和行为的升级基线

### 10.1 统计口径

统计的是 JSX **控件站点**，不是运行时实例；会话、任务、模型、文件、节点、插件、产物列表会通过 `map()` 扩张。专门盘点文件已保存为：

- [核心客户端 UI 盘点](../../ui-audit/2026-10-11-core-client-ui-inventory.md)
- [设置、知识、WebDAV 与研究 UI 盘点](../../ui-audit/2026-10-11-settings-knowledge-ui-inventory.md)

| 范围 | 文件 | 原生 button | input | textarea | select | 共享 Button | 主要 DOM 事件 | 备注 |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| 核心 workbench/projects/session/composer/chat/panel/diff/tasks | 78 TSX | 136 | 20 | 3 | 4 | 33 | 213 | 不含 settings/knowledge/plugins 专用 JSX |
| settings + knowledge/research/WebDAV | 47 TSX | 80 | 36 | — | 12 | 104 | 266 DOM + 48 自定义回调 | 含 Graph 的 wheel/pointer/key 事件 |
| 共享基础组件、插件贡献和运行时列表 | 另计 | 由组件/数据扩张 | 由组件/数据扩张 | 由组件/数据扩张 | 由组件/数据扩张 | 由组件/数据扩张 | 由组件/数据扩张 | 不把静态站点误报成总按钮数 |

### 10.2 页面→事件→行为总表

下表给出每个客户端表面至少一个完整的“事件 → store/IPC → 状态/副作用”链路；附件报告逐控件列出按钮、输入、快捷键、拖放、禁用条件和错误恢复。

| 页面/表面 | 入口与控件 | 触发事件 | 行为和结果 |
|---|---|---|---|
| 应用壳/Workbench rail | 聊天、项目、知识、插件、设置、帮助按钮 | click、`aria-current` 更新 | `setView`、`closeKnowledge`、`settings.openWith`；插件卸载后回退 chat |
| 会话轨道 | tab、重命名输入、关闭、`+`、更新、右栏 | click、double-click、Enter/Esc/blur、drag/pointer/keyboard | switch/save tabs、`pi.setSessionName`、close、create draft、download/install update、reorder；失败回滚 toast |
| 项目/空间 | 搜索、添加/选择/删除项目、历史会话、新会话、复制诊断 | change、click、二次确认、clipboard | project store filter；`pickDirectory`、trust；加载 session bundle；`getAppInfo` + clipboard；删除需确认 |
| Composer | textarea、图片、文件拖放、引用、slash、@、模型/思考/权限 chip、发送/停止/队列 | Enter/Shift+Enter/Esc、paste、drop、click、上下键 | `pi.prompt/stop`、create session、`importDroppedFile`、draft images/quotes、slash/agent/file completion、model/permission state；无模型/只读/compact 时禁用 |
| Chat/message flow | 消息详情、tool call、task decision、route map、全文、子代理、错误 retry | click、toggle、retry、selection toolbar、scroll | transcript reducer；展开 args/output、`task-action`、panel focus、copy/open/retry/compact/settings；保留 draft 和运行状态 |
| Context panel | Tasks、Process、Changes、Artifacts、Subagents、Compute、资源 preview | tab click、expand、jump、rerun、copy/open | `getTodos/getProcess/listArtifacts/artifactProvenance/rerunArtifact`；nonce 聚焦；重跑进入异步事件状态机 |
| Diff/资源阅读器 | 文本/代码、图片、PDF、表格、序列、Markdown、标注、缩放 | click、wheel、keyboard、annotate、open external | `openPath/openExternal/saveFile`、resource parser、annotator；超大文件降级预览 |
| Approval/Ask/Trust | Allow/Reject、回答、Trust/Cancel、示例任务方向 | click、Enter/Esc、队列事件 | `respondApproval/respondAsk/respondTrust`；成功出队，失败保留请求；危险写入先确认 |
| Knowledge home/search | 查询、命中、打开 note、daily switch/run/decision、maintenance/reconcile | submit、click、switch、分页 | `searchKnowledge/getDailyDiscovery/updateDailyDiscovery/decideDailyIdea/getKnowledgeJobs/maintainKnowledge`；binding revision 失效时要求刷新 |
| Knowledge graph observatory | semantic/all、category/relation/isolate/duplicate、legend、zoom/fit、节点、drawer | click、wheel、pointer capture、Enter/Space/Escape、`+/-/0/F` | `getKnowledgeGraph(limit400)`；节点选择 `getKnowledgeNoteLinks`/open note；opacity filter、camera transform、incoming/outgoing drawer；显示 total/limit/health |
| WebDAV cloud workspace | endpoint/status、password、probe/init、query/results、local/remote preview、Pull/Push/conflict | submit、click、password change、resolution click | `getCloudStatus/probe/initialize/setPassword/searchKnowledge/readCloudNote/syncCloud`；manual-only，revision+hash+strong ETag，冲突明确选择 local Push 或 remote Pull |
| Knowledge flow/runs/topics | flow card、resume、run item、topic query/archive/resume、specialist mode/model selects | click、change、expand | `getKnowledgeOverview/getResearchRuns/getResearchRun/resumeKnowledgeCheck/archiveKnowledgeTopic/setKnowledgeSpecialistSettings`；仅展示 observed/unverified，不伪造 evidence |
| Reviews/model review | review list/pagination/source、preview、Apply/Reject、ack/auto/model/cancel | click、checkbox、select、cancel | `previewKnowledgeReview/decideKnowledgeReview/reviewKnowledgeWithModel`；token、expected hash/revision、stale/targetChanged 需重新 preview |
| Semantic management | enabled/provider/model/url/threshold/credential/remote consent、Save/Test/Index/Cancel | change、click、progress/cancel | `get/save/test/index/cancelKnowledgeSemantic`；显示 model/version、embedding、threshold、index revision、requestId |
| Zotero/Institutional | refresh/login/clear/test/install/MCP/key/group/local write | click、input、submit、external open | `getZoteroStatus/openInstitutionalLogin/clear.../test...`；secret 只在 backend，浏览器登录为显式外部副作用 |
| Note viewer | line navigation、review details、open target/source | click、keyboard | 读取固定 binding revision；显示来源与 revision，不能把远端未绑定正文当事实 |
| Inquiry/Artifacts | expand provenance、source session、Rerun、event updates | click、onRerunUpdated | `listArtifacts/artifactProvenance/rerunArtifact`；展示 sha256、code/workflow/container digest、parent chain、old/new diff |
| General/Appearance | theme/language、background、reduced motion、layout density | change、click | ui preferences/local persistence；升级统一 token、200% zoom、reduced-motion |
| Providers/Login | provider/model/base URL、login/logout、OAuth prompt | change、click、provider login event | `listProviders/saveProvider/login/logout`；`onProviderLoginEvent` 显示 promptId/status，不回显 secret |
| Skills/Workflow | skill enable/install/uninstall、workflow/catalog、reload | click、search、confirm | package admin、热重载、workflow menu；安装/启用是可审查副作用 |
| Permissions | permission rows、save/reset/probe/audit | change、click、confirm | `get/save/test/audit permissions`；显示命中规则、scope、mtime，危险写入统一确认 |
| MCP/Extensions/UI Plugins | server toggle/reload/config、extension install、plugin slot/contribution | click、change、external config | `getMcpStatus/reload/openMcpConfig/packages/uiPlugins`；scope、source、version、last event、slot conflict 可解释 |
| LAN | enable/disable、port/token/status、copy URL、session selector | click、clipboard、poll/event | `getLanStatus/setLanConfig`；只读观察，显示 last seen/remote access audit；减少固定轮询 |
| Compute | host add/test/health、job submit/cancel/log/terminal | click、input、select、confirm | `compute` contracts；host/job/run 关联，授权、预算、路径和远程副作用清晰 |
| About/diagnostics | version/update、open release/docs、export diagnostics | click、save dialog、external open | `getAppInfo/openExternal/saveFileDialog/getDiagnostics`；导出前显示脱敏清单，不含 session 正文/secret |

### 10.3 统一科研工作台视觉和交互契约

**信息架构。** 顶层四组固定为：

1. **研究状态**：Home、Graph、Runs、Artifacts/Inquiry。
2. **证据操作**：Reviews、Topics、Semantic、Zotero、WebDAV。
3. **运行配置**：Providers、MCP、Extensions、UI Plugins、Permissions、Compute。
4. **环境**：General、Appearance、LAN、About。

**状态模型。** 所有结果/同步/运行/审核状态共用 `observed / verified / pending / conflict / unavailable`；状态必须同时有文字和图标，不能只用颜色。每个状态卡显示 scope（user/project/session）、revision、更新时间、来源、hash/ETag/代码指纹（适用时）。

**Design tokens。** 抽取 `canvas/surface/surface-raised/border`、`observed/verified/pending/conflict/unavailable`、12 种科研对象类别色、`primary/secondary/quiet/danger` 动作层级；Graph、WebDAV、Review、Inquiry 共用 token。icon-only 控件必须有 tooltip、`aria-label` 和可触达命中区；保留高密度 12/13/14px 文字，但把关键证据字段使用 tabular/mono 字体。

**副作用边界。** `Push/Pull/Apply/Rerun/Delete/Clear/Install/Enable` 必须在按钮文案中写出方向、scope 和预计影响；确认卡展示旧/新 hash、revision、目标路径和操作者。`Save` 只用于无副作用的本地偏好，不再掩盖联网或覆盖文件。

**可复现性。** 筛选器、Graph 相机、query、选中 path、tab 和 revision 可复制为会话书签；图谱、WebDAV、Inquiry 的操作形成 timeline，能导出审计 JSON；模型审核展示 model/version/预算，重跑展示旧/新 sha256 与环境 digest。

**无障碍和性能。** 移除 Graph 外层原子 `role=img` 或提供同步可操作节点列表；Enter/Space/Escape、focus-visible、200% zoom、窄屏双栏折叠、`prefers-reduced-motion` 均有测试。Graph 400 节点必须交互流畅，超过限制显示 `showing 400 / total`，大 Vault 建模要在服务端先限候选并记录 p95。

## 三、实施顺序、责任和验收

### P0：基础契约和代表面板（先做）

- 抽取 `StatusBadge`、`ActionButton`、`ScopeHeader`、`ConfirmDialog`、`EvidenceCard`。
- 迁移 Graph、WebDAV、SettingsDialog 三个代表面板；统一 token、中文/英文文案、focus/keyboard/error/empty/loading/conflict 状态。
- 把 Graph 性能上限、布局边界、SVG a11y、WebDAV CAS 作为合入门禁，而不是留到视觉重构末尾。

**验收：** lint/typecheck；浅色/深色、中英文、窄屏、200% zoom、reduced-motion；WebDAV conflict 不能隐藏方向；Graph 节点可用键盘与读屏访问；无共享 Button 的 focus ring 回归。

### P1：科研证据工作台

- Knowledge Home/Graph/WebDAV/Reviews/Semantic/Topics 统一 `ScopeHeader + EvidenceCard + Timeline`。
- Inquiry/Artifacts/Research Runs 展示 provenance timeline、reproducibility badge、old/new hash、container/workflow digest。
- Providers/MCP/Extensions/Plugins/Permissions/Compute 显示 scope/source/version/last updated，并把安装、授权、远程连接作为明确副作用。

**验收：** 每个副作用有 contract test；事件 `onKnowledgeEvent/onMcpEvent/onProviderLoginEvent/onRerunUpdated` 能在 UI 中保留 source session、revision、时间；审计 JSON 可重放。

### P2：全客户端迁移和视觉回归

- 迁移聊天、Composer、项目、Diff、LAN、Zotero、Institutional、About；保持既有 IPC 链路，只换视觉和确认层。
- 统一 icon/button/dropdown/switch、危险色、loading/error/empty、i18n 术语表。
- 用 AST 生成静态交互 inventory JSON，每次 UI PR 对比新增/删除的事件与副作用。

**验收：** 浅/深/系统主题 × 中/英文 × loading/empty/error/conflict/disabled/长路径截图；键盘走查；400 节点和 200% 缩放；无 secret、session 正文泄露；完整 `npm test` 和 production build。

### 当前交付物

- [PR113 整合审查](../reports/2026-10-11-pr113-integration-review.md)
- [PR113 逐项审查](../reports/2026-10-11-pr113-review.md)
- [核心客户端交互清单](../../ui-audit/2026-10-11-core-client-ui-inventory.md)
- [设置/知识/WebDAV/研究交互清单](../../ui-audit/2026-10-11-settings-knowledge-ui-inventory.md)
- [v0.26.1 validation record](../../releases/v0.26.1-validation.md)
