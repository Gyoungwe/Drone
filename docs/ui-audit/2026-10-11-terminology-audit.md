# Drone 客户端术语审计（2026-10-11）

## 审计目标

本次审计面向 Drone 的普通科研用户，而不是插件开发者、运行时维护者或 CI 操作者。目标是：

1. 保留协议、命令和文件字段的准确性；
2. 把出现在页面标题、按钮、状态标签和提示语中的内部工程术语换成可理解的科研工作语言；
3. 在第一次出现时给出简短解释，后续详情中再保留必要的技术名词；
4. 不改变 IPC、状态枚举、文件格式、命令名、API 字段或日志中的机器可读值。

## 扫描范围与方法

扫描了整个仓库中非 `node_modules` 的 TypeScript/TSX/JavaScript/JSON/Markdown 文本，并重点人工检查：

- `packages/desktop/src/renderer/src/i18n/zh.ts`
- `packages/desktop/src/renderer/src/i18n/en.ts`
- `packages/desktop/src/renderer/src/components/knowledge/copy.ts`
- `packages/desktop/src/renderer/src/components/knowledge/*`
- `packages/desktop/src/renderer/src/components/chat/*`
- `packages/desktop/src/renderer/src/components/panel/*`
- `packages/desktop/src/renderer/src/components/composer/*`
- `packages/desktop/src/renderer/src/components/settings/*`
- `packages/desktop/src/renderer/src/components/session/*`
- `packages/desktop/src/renderer/src/components/diff/*`

全仓库出现次数包含代码字段、类型、测试和文档，不能直接等同于页面上的文案；它们用于判断哪些内部词汇容易泄漏到 UI。UI 语言包的关键计数如下：

| 术语/词根 | 中文包 | English 包 | knowledge copy | 主要风险 |
|---|---:|---:|---:|---|
| 契约 / contract | 3 | 3 | 0 | 把任务要求说成法律或接口协议 |
| 门控 / gate | 2（“门”相关 6） | gate 9 | 1 | 读起来像 CI 或安全网关 |
| 回执 / receipt | 5 | receipt 4 | 4 | 后端回调术语，不像研究记录 |
| 产物 / artifact | 11 | artifact 14 | artifact 3 | 工程流水线语气，用户不知是输出文件还是研究结果 |
| provenance / 来源 | 来源 9 | provenance 5 | provenance 2、来源 18 | 同时存在“来源、溯源、provenance”，概念不统一 |
| scope / 作用范围 | scope 12 | scope 15 | scope 10 | 可能被理解为代码作用域 |
| runtime / 运行时 | runtime 3 | runtime 7 | runtime 1 | 启动故障提示对非开发者不友好 |
| host / 主机 | host 4 | host 11 | host 3 | “宿主”与“远程主机”混用 |
| worker / worker | 0 | 0 | worker 12 | 后台任务的实现名词漏到知识页 |
| binding / 绑定 | 绑定多处 | binding 多处 | binding 4 | “绑定”容易被理解为永久连接或账号绑定 |
| revision / 版本 | 0（键名及值外） | 0（键名及值外） | revision 1 | 知识库快照版本应与软件版本区分 |
| ETag / CAS | 代码和同步实现大量出现 | 同左 | 相关提示有 strong ETag | 云端版本保护机制不应直接成为按钮语言 |
| subagent / Skill / Provider / MCP | 多处保留 | 多处保留 | 多处保留 | 产品功能名和实现名混在同一层级 |

全仓库扫描还确认 `runtime`、`scope`、`host`、`binding`、`artifact`、`gate`、`contract`、`receipt` 等词在实现层大量出现；这些字段必须继续保留，不能做全局文本替换。替换边界必须是用户可见的 i18n 值、组件标题、按钮和提示。

## 总体翻译原则

### 1. 先说用户要做什么，再补充技术依据

按钮优先用动作：

- `Push` → `上传到云端`
- `Pull` → `从云端取回`
- `Rerun` → `重新运行`
- `Apply` → `应用这项修改`
- `Reconcile` → `重新核对`

技术词放在二级说明、详情折叠区或 tooltip 中：例如“上传到云端（Push）”。

### 2. 研究语境优先使用“记录、来源、成果、复核、版本”

这些词比“回执、产物、门控、契约、worker”更接近科研用户熟悉的工作流，也能表达可追溯性和不确定性。

### 3. 不把“已记录”翻成“已验证”

这是最重要的语义边界。`receipt`、`observed`、`saved`、`reviewed`、`verified` 必须分开：

| 内部状态 | 推荐中文 | 含义 |
|---|---|---|
| observed | 已观察 | 系统看到过该状态或文件 |
| saved / written | 已保存 / 已写入 | 内容已落盘 |
| reviewed | 已复核 | 人工或指定检查流程已经查看 |
| verified | 已核验 | 满足明确的核验条件 |
| unverified | 尚未核验 | 不能据此推断结论正确 |
| pending | 待处理 / 待复核 | 还没有完成下一步 |
| conflict | 版本冲突 | 两个版本不能自动覆盖 |

### 4. 协议名称保留，但第一次出现要说明

保留 `WebDAV`、`MCP`、`Zotero`、`Obsidian`、`SSH`、`Provider` 的正式名称。首次出现时附一句解释：

- `MCP` → `外部工具连接（MCP）`
- `Provider` → `模型服务（Provider）`
- `WebDAV` → `云端知识库（WebDAV）`
- `SSH` → `远程连接（SSH）`
- `Vault` → `知识库目录（Vault）`

后续页面可以只用“模型服务、云端知识库、知识库目录、远程连接”。

## 高优先级替换表

### A. 任务与过程面板

| 当前文案/键 | 文件 | 推荐中文 | 推荐英文 | 语义说明 |
|---|---|---|---|---|
| `panel.taskViewTitle`：任务契约 | `i18n/zh.ts` | 任务计划 | Task plan | 这是用户批准和跟踪的计划，不是 API contract |
| `subagents.stageNone`：不追加阶段契约 | `i18n/zh.ts` | 不添加阶段说明 | No extra stage note | 阶段提示是给用户看的说明 |
| `subagents.stageHint`：阶段契约会追加在末尾 | `i18n/zh.ts` | 阶段说明会附加在任务末尾 | A stage note will be added to the task | 保留行为，不保留工程隐喻 |
| `processLanes.taskGate`：任务门 | `i18n/zh.ts` | 任务检查 | Task check | “门”会让用户想到 CI gate |
| `processLanes.hostGate`：宿主门 | `i18n/zh.ts` | 系统检查 | System check | 这里不是浏览器宿主，也不是远程主机 |
| `processLanes.libGate`：文献门 | `i18n/zh.ts` | 文献检查 | Literature check | 说明是否满足文献来源要求 |
| `processLanes.openReconcile`：查看重算 | `i18n/zh.ts` | 查看核对结果 | View reconciliation | “重算”会误导为重新计算数值 |
| `processLanes.nodes.bound`：证据绑定 | `i18n/zh.ts` | 关联来源 | Source linked | 表示来源与本轮记录关联，不是永久绑定 |
| `processLanes.nodes.deposit`：知识沉淀 | `i18n/zh.ts` | 保存到知识库 | Save to knowledge base | “沉淀”可保留在说明文章，动作按钮应直接 |
| `processLanes.nodes.wiki`：Wiki 回执 | `i18n/zh.ts` | Wiki 记录 | Wiki record | 记录写入状态，不是支付回执 |
| `processLanes.nodes.zotero`：Zotero 回执 | `i18n/zh.ts` | Zotero 记录 | Zotero record | 同上 |
| `panel.processEmpty`：还没有运行记录 | `i18n/zh.ts` | 还没有执行记录 | No activity recorded yet | 与时间线和研究运行一致 |
| `panel.approvalPending`：有操作在等你确认 | `i18n/zh.ts` | 有操作等待确认 | An action is waiting for confirmation | “审批坞”见下表 |

建议将内部状态图的英文 `gate` 统一为 `check` 或 `review`。数据枚举仍保持 `taskGate` 等旧 key，以免破坏插件兼容。

### B. 输出、成果与可复现信息

| 当前文案/键 | 文件 | 推荐中文 | 推荐英文 | 语义说明 |
|---|---|---|---|---|
| `panel.tabs.artifacts`：产物 / Outputs | `i18n/*.ts` | 成果 | Research outputs | 研究用户看到的是结果文件、报告和笔记 |
| `panel.taskArtifacts`：任务产物 | `i18n/*.ts` | 任务成果 | Task outputs | 保留“输出”也可以，避免“产物”泛化 |
| `panel.artifactProvenance.title`：产物来源 | `i18n/*.ts` | 成果来源与复现信息 | Output origin & reproducibility | 一句话说清 provenance 的用途 |
| `artifactProvenance.expand`：展开来源 | `i18n/*.ts` | 查看生成信息 | Show how it was produced | “来源”太窄，因为包含代码、参数和环境 |
| `artifactProvenance.codeFingerprint`：代码指纹 | `i18n/*.ts` | 代码版本标识 | Code version | 指纹可放在详情字段，不作为主标题 |
| `artifactProvenance.environment`：环境摘要 | `i18n/*.ts` | 运行环境 | Run environment | 对用户更自然 |
| `artifactProvenance.container`：容器 | `i18n/*.ts` | 软件环境 | Software environment | 只有开发者需要时再显示 container digest |
| `artifactProvenance.parents`：父产物链 | `i18n/*.ts` | 前置成果 | Previous outputs | “父产物”是 DAG 内部术语 |
| `parentsTruncated`：父产物链已截断 | `i18n/*.ts` | 前置成果较多，仅展示最近 20 层 | More than 20 previous outputs; showing the latest 20 | 说明截断原因 |
| `superseded`：旧产物已标记 superseded | `i18n/*.ts` | 旧版本已由新结果替代 | The older result was superseded | 不把英文状态泄漏到中文 |
| `reproduced`：已复现：sha256 一致 | `i18n/*.ts` | 已复现：文件校验一致 | Reproduced: file checksums match | sha256 放在展开详情 |

### C. 知识库、Graph 与 WebDAV

| 当前文案/键 | 文件 | 推荐中文 | 推荐英文 | 语义说明 |
|---|---|---|---|---|
| `cloudTitle`：云端知识库（WebDAV） | `knowledge/copy.ts` | 云端知识库（WebDAV） | Cloud knowledge base (WebDAV) | 已经基本合适 |
| `cloudHint`：显式探测和单次读写 | `knowledge/copy.ts` | 手动检查并按次读写 | Manual checks and one-time reads/writes | “显式”是实现术语 |
| `cloudManualSyncNotice` | `knowledge/copy.ts` | WebDAV 需要手动同步：选择笔记、比较两端版本，再明确上传或取回。不会后台自动同步。 | WebDAV uses manual sync: choose a note, compare both versions, then upload or retrieve it. Nothing syncs in the background. | 把 Pull/Push 翻译成动作 |
| `cloudSyncStepHint`：选择 → 预览 → 执行 | `knowledge/copy.ts` | 选择 → 比较 → 确认 | Choose → compare → confirm | “执行”过于机械 |
| `cloudPush`：Push 到云端 | `knowledge/copy.ts` | 上传到云端（Push） | Upload to cloud (Push) | 危险动作需方向明确 |
| `cloudPull`：Pull 到本地 | `knowledge/copy.ts` | 从云端取回（Pull） | Retrieve from cloud (Pull) | 同上 |
| `cloudResolveLocal` | `knowledge/copy.ts` | 确认覆盖云端（使用本地版本） | Confirm overwrite cloud (use local version) | 冲突动作保留方向与覆盖影响，并在执行前二次确认 |
| `cloudResolveRemote` | `knowledge/copy.ts` | 确认覆盖本地（使用云端版本） | Confirm overwrite local (use cloud version) | 同上；预览 hash/强 ETag 变化会拒绝执行 |
| `cloudCompareConflict`：发现冲突 | `knowledge/copy.ts` | 版本不一致 | Versions differ | 先告诉用户事实，再在说明中写冲突 |
| `cloudSyncNeedsBinding`：绑定知识库 | `knowledge/copy.ts` | 先选择知识库 | Select a knowledge base first | 避免暗示不可逆绑定 |
| `bindingRevision` 在状态提示中 | `KnowledgeCloudSection.tsx` | 知识库版本 / 快照版本 | Knowledge-base revision / snapshot version | 内部 revision 字段保留，展示用“版本” |
| `ETag` / `strong ETag` | `KnowledgeCloudSection.tsx`、后端返回消息 | 云端版本标识（ETag）/ 严格版本校验 | Cloud version tag (ETag) / strict version check | 不放在主按钮；放在“详细信息” |
| `graphObservatoryLabel`：研究知识观测台 · 关系与证据 | `knowledge/copy.ts` | 研究知识观测台 · 关系与来源 | Research observatory · relations & sources | “证据”可保留，但来源更中性 |
| `graphNebula`：星云 | `knowledge/copy.ts` | 网络视图 | Network view | “星云”是设计比喻，不应与语义视图并列为技术模式 |
| `graphLegendShared`：共享桥接 | `knowledge/copy.ts` | 共享连接 | Shared connection | “桥接节点”可在 tooltip 解释 |
| `graphRelationDirectory`：目录/推断 | `knowledge/copy.ts` | 目录关系 / 推测关系 | Directory / inferred relation | 不能把 inferred 翻成事实 |
| `graphHealthDuplicates`：重复提示 | `knowledge/copy.ts` | 可能重复 | Possible duplicates | 更诚实地表达不确定性 |

### D. 模型、工具与设置

| 当前文案/键 | 文件 | 推荐中文 | 推荐英文 | 语义说明 |
|---|---|---|---|---|
| `Agent` 散落在标题/提示 | `i18n/*.ts`、RunInspector | 研究助手 / 智能体 | Research assistant / agent | 面向普通用户优先“研究助手”，高级设置可显示 agent |
| `Subagent` / 子智能体 | `i18n/*.ts`、panel | 协作助手 | Collaborating assistant | 比“子智能体”更像并行研究角色；保留命令和 API 中的 subagent |
| `Skill` / Skills | `i18n/*.ts` | 工具 / 研究工具 | Tools / research tools | `/skill` 命令和包名保持原样 |
| `Provider` | `i18n/*.ts` | 模型服务 | Model service | 设置页标题用“模型服务”，详情可写 Provider |
| `runtime` / 运行时 | `i18n/*.ts`、McpPanel | 运行组件 / 运行环境 | Runtime component / execution environment | “运行时未安装” → “所需运行组件未安装” |
| `schema` | `i18n/*.ts` | 工具说明 | Tool definitions | `schema footprint` → “工具说明占用” |
| `manifest` | 状态/错误信息 | 配置清单 | Configuration manifest | 仅在高级诊断中显示 |
| `slot` / 槽位 | `UiPluginsSection.tsx`、i18n | 组件位置 | Component position | 开发者模式可保留“插槽” |
| `compute` / 计算 | `panel`、settings | 远程计算 | Remote computing | 当前“计算”过于抽象 |
| `host` / 主机 | compute、SSH | 远程设备 | Remote device | `hostId`、SSH 地址等字段不改 |
| `worker` | `knowledge/copy.ts` | 后台任务 | Background task | 知识页不应展示 worker |
| `reconcile` | flow/process | 重新核对 | Reconcile / check again | “重算”错误暗示重新计算 |
| `scope` | skills、permissions、knowledge | 适用范围 / 授权范围 | Applies to / permission scope | 依据上下文选词，不做一个中文硬替换 |
| `token` | usage、composer、subagent | 模型用量（token） | Model usage (tokens) | 首次显示加括号，后续可简写“用量” |
| `MCP` | settings、knowledge | 外部工具连接（MCP） | External tool connection (MCP) | 协议名必须保留 |
| `Vault` | knowledge、diagnostics | 知识库目录 | Knowledge-base folder | 仅路径或 Obsidian 专有上下文显示 Vault |

### E. 硬编码文案

以下文本没有走语言包，优先修正：

| 文件/位置 | 当前文本 | 推荐做法 |
|---|---|---|
| `components/chat/RunInspector.tsx:215` | `Publication gate` | 新增 `runInspector.publicationCheck`，中文“发布前检查”，英文“Publication check” |
| `components/chat/RunInspector.tsx:223` | `Skill` | 使用 `skillsCatalog` 或 `runInspector.tool`，中文“使用的工具”，英文“Tool used” |
| `components/chat/RunInspector.tsx:235` | `receipts` | 中文“公开记录”，英文“public records” |
| `components/knowledge/KnowledgeCloudSection.tsx:293` | 动态 key 含 `Conflict` | 不影响内部 key；展示由 `cloudCompareConflict` 提供“版本不一致” |
| `components/knowledge/KnowledgeView.tsx` | `Obsidian` 作为孤立副标题 | 首次显示“Obsidian 知识库”或仅在设置页保留品牌名 |
| `components/settings/McpPanel.tsx` | runtime 状态直接进入 banner | 使用 `settings.mcp.runtimeMissing/runtimeStarting` 的用户语言，不显示 runtime |

## 页面级推荐术语

| 页面 | 页面主标题 | 主状态 | 关键动作 | 需要避免 |
|---|---|---|---|---|
| 聊天 / 会话 | 研究会话 | 进行中、等待确认、已完成 | 发送、停止、继续 | chain-of-thought、receipt、gate |
| 任务面板 | 任务计划 | 待确认、执行中、已完成 | 查看计划、确认、继续 | 任务契约、任务门 |
| 过程面板 | 执行记录 | 已观察、已复核、待处理 | 查看详情、重新核对 | 泳道、回执、重算 |
| 成果面板 | 研究成果 | 可复现、部分可复现、待复核 | 查看来源、重新运行 | 产物、父产物链、superseded |
| 知识首页 | 知识库 | 已连接、索引中、待处理 | 搜索、保存、维护 | binding、worker、deposit |
| 知识网络 | 研究观测台 | 已选择、可能重复、待复核 | 聚焦、打开来源、适应全部 | nebula、hops、bridge |
| WebDAV | 云端知识库 | 已连接、版本不一致、离线 | 检查连接、比较版本、上传、取回 | Push 到云端、Pull 到本地、strong ETag |
| Wiki 审核 | 知识修改审核 | 待审核、已应用、已拒绝 | 查看差异、应用修改、保留原文 | candidate、host checks |
| 语义设置 | 按含义搜索 | 已启用、仅关键词搜索 | 保存设置、测试服务、建立索引 | embedding、cosine、provider |
| 模型设置 | 模型服务 | 已配置、未配置、连接失败 | 登录、测试连接、隐藏模型 | Provider、runtime |
| 工具与技能 | 研究工具 | 已加载、按需加载、不可用 | 查看详情、启用、停用 | schema footprint、lazy |
| 权限 | 操作权限 | 自动执行、需要确认、已拒绝 | 允许一次、允许本次、查看记录 | 权限门控、strictest segment |
| 远程计算 | 远程设备与任务 | 在线、排队、运行中、失败 | 检查连接、提交任务、查看日志 | host、job、compute |

## 建议的实现方式

### 第一阶段：不改变 key，只改展示值

保留现有 key 和状态枚举，先修改 `zh.ts`、`en.ts` 和 `knowledge/copy.ts` 的展示文本。这样不会影响插件、测试和 IPC。

### 第二阶段：补齐遗漏的语言包

把 `RunInspector.tsx` 的 `Publication gate`、`Skill` 和英文 receipts 移入 i18n。检查所有 JSX 中的直写英文和中文，特别是知识、设置、运行记录和确认对话框。

### 第三阶段：分层显示技术细节

主界面只显示科研动作和状态；在“详情”中显示：

- revision / snapshot version；
- ETag；
- sha256；
- code version；
- container digest；
- workflow/module；
- MCP、Provider、Skill 的正式名称。

### 第四阶段：测试文案契约

增加语言包测试，至少检查：

- 中文 UI 不再出现“任务契约、任务门、宿主门、文献门、权限门控、阶段契约”；
- 面向用户的按钮不单独显示 `Push`、`Pull`、`Rerun`、`Apply`；
- WebDAV 的方向始终包含“云端/本地”；
- `verified`、`saved`、`reviewed`、`observed` 的中文不混用；
- 技术字段仍能在展开详情中读取；
- en/zh key 结构保持一致。

## 语义风险与不可替换项

以下内容不要做简单翻译替换：

1. `WebDAV`、`MCP`、`Zotero`、`Obsidian`、`SSH`、`Pi Coding Agent` 是正式名称；
2. `/obsidian-setup`、`/zotero-setup`、`/skill:*`、`mcp.json`、`permissions.json`、`.pi/agents/` 是命令或路径；
3. `revision`、`ETag`、`sha256`、`codeFingerprint` 等值用于并发保护和复现，不能删除；
4. `allow / ask / deny` 是权限配置的机器值，界面可解释但不能改成无法写回的中文；
5. “证据”在研究语境仍然有价值，应该把“证据门”改成“来源检查/证据状态”，而不是完全删除 evidence 概念；
6. “可复现”是科研质量指标，应保留；真正需要替换的是 artifact/provenance 的工程说法。

## 推荐优先级

### P0：用户首次使用就会看到

- 任务契约、阶段契约、任务门、宿主门、文献门；
- 权限门控、Publication gate；
- Push / Pull / Rerun / Apply；
- 产物、产物来源、父产物链、superseded；
- WebDAV 的版本冲突和“绑定知识库”；
- 运行时未安装、工具 schema、Provider 配置。

### P1：科研工作流中经常出现

- 回执、证据绑定、知识沉淀、worker、scope、reconcile；
- Vault、Subagent、Skill、MCP、host、compute；
- 语义检索、embedding、lexical FTS、模型用量 token。

### P2：高级设置和诊断中保留但加解释

- revision、ETag、sha256、code fingerprint、container digest、manifest、slot；
- 允许用户复制的命令、路径和 JSON 字段。

## 结论

Drone 当前不是术语数量太多，而是同一个用户动作同时使用了工程名、研究名和内部状态名。例如“产物来源 / provenance / 父产物链 / superseded”让用户进入了流水线实现，而“研究成果 / 生成信息 / 前置成果 / 旧版本已由新结果替代”能保留同样的可复现含义。

建议先按 P0 改语言包和两个硬编码组件，再进行白色科研风格 UI 的页面迁移。机器字段、命令和协议保留在详情区，主界面统一使用“研究问题—来源—方法—成果—复核—版本”这一组科研工作词汇。
