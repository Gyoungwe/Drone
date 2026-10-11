# Drone 客户端设置、扩展、知识网络与科研工作台 UI 盘点

> 盘点基线：本地 `codex/v0261-validation`（设置/权限/MCP/Provider/LAN 代码）和 PR #113 head `18f9b48678ba0515aa334d2616ce242e9e215fea` 的知识网络/WebDAV 代码。PR #113 的实现文件以 `/tmp/pr113src_1791655111` 解包内容核对；生产代码未修改。
>
> 统计方法：对 `packages/desktop/src/renderer/src/components/settings/**/*.tsx`（23 个文件）和 PR #113 的 `components/knowledge/*.tsx`（24 个文件）统计静态 JSX 控件和事件属性。`map()`、条件渲染、插件贡献、知识条目和模型列表会在运行时生成多个实例，因此表中的数字是“源码交互位点”，不是某个项目的运行时按钮总数。

## 1. 统计总览

| 范围 | 文件 | 原生 `button` | `input` | `select` | `details/summary` | `Switch` | `Button` | 静态事件属性 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 设置、权限、Provider、MCP、扩展、插件、LAN | 23 | 56 | 17 | 7 | 5/5 | 9 | 18 | `onClick` 80、`onChange` 33、`onSubmit` 3、`onKeyDown` 3、`onToggle` 1、`onMouseLeave` 1 |
| 知识库、研究、WebDAV、审核、语义、主题、Zotero | 24 | 24 | 19 | 5 | 9/9 | 1 | 86 | `onClick` 108、`onChange` 24、`onSubmit` 3、`onKeyDown` 2、`onWheel` 1、`onPointer*` 5、`onFocus` 1、`onMouseLeave` 1 |
| **源码位点合计** | **47** | **80** | **36** | **12** | **14/14** | **10** | **104** | **266 个显式 DOM 事件属性** |

主要动态乘数：

- `SettingsDialog` 有 9 个普通分类、5 个高级分类；插件 `settings.panel` 贡献会按已启用插件动态增加分类。
- Provider、模型、MCP server、扩展、技能、权限规则、知识图节点/边/审核队列、研究运行、主题和产物均由数组 `map()` 生成。一个源码位点可以对应数百个实际开关或操作。
- Knowledge Graph 取最多 400 个节点；类别过滤器按图中出现的类别生成，不能用固定按钮总数替代。另有 48 个自定义交互回调属性（例如 `onCheckedChange/onClose/onComplete/onRows`），不计入上表 DOM 事件列；将两类合计则是 314 个 `on*` 属性位点。

## 2. 全局设置壳层与原生事件

### `SettingsDialog`（`components/settings/SettingsDialog.tsx:25-193`）

- **入口/布局**：固定遮罩 `role=dialog`，左导航、右内容双滚动；关闭按钮触发 `useSettingsStore.setOpen(false)`。
- **导航**：普通分类 `general / permissions / appearance / models / skills / mcp / zotero / extensions / about`（9）；高级分类 `knowledge / lan / uiPlugins / workflows / compute`（5）。点击只切换 Zustand `category`，不写业务数据。
- **插件导航**：`useUiPluginRegistry` 的 `settings.panel` 贡献在总开关开启时按插件动态追加；插件贡献包 `PluginBoundary`，崩溃只隔离该页面。
- **触发链**：打开 `setOpen/openWith` → `settings.refresh()`，并行拉取权限配置、上下文蒸发模式、channel-watch、LAN 状态、Provider、模型偏好、子代理和当前会话加载资源。渲染端只经 `getPi()/window.pi`，没有直接访问 Pi SDK。
- **原生/平台事件**：遮罩和按钮是 DOM 点击；面板内部有文件选择、外部链接、系统目录、诊断导出等 Electron IPC（见各页）。

### 当前视觉实现要点（源码证据）

- `shell.css:538-578` 的全屏知识视图使用 `var(--color-canvas)`、底部边框和 `color-mix(canvas,hover)`，主体滚动区 padding 16/18/40；关闭按钮为 8px radius、12px 字体、hover 背景。
- `shell.css:802-887` 的 Graph toolbar/zoom 命中区至少 32px，zoom 使用深蓝硬编码 `#0d1320/#101a2d/#526a9f` 与 `#dce7ff` 文本；类别过滤为 999px pill、7px 类别圆点。
- `shell.css:888-937` 对 active edge、node aura、selection halo 使用 1.8s/3.2s 动画；`shell.css:951-957` 在 `prefers-reduced-motion` 下关闭动画。升级应把硬编码颜色映射到 `--color-graph-*` token，并保留 reduced-motion 分支。
- 图谱 drawer 是 `opacity + translateX + pointer-events` 的隐现，窄屏（<760px）变为底部抽屉；这套响应式模式应复用到 WebDAV diff、审核详情和 Inquiry provenance，而不是另造弹窗。

### 设置页面行为矩阵

| 页面/源码 | 控件和循环位点 | 用户行为与状态 | IPC/API 链路和原生事件 |
|---|---|---|---|
| **通用** `GeneralPanel.tsx:20-106` | 语言 2 个按钮；上下文模式 2 个按钮；channel-watch `Switch`；SSH guard `<details>` | 语言立即切换 i18n；上下文 `evaporation/off` 立即乐观更新，失败回滚；channel-watch 同样乐观更新；SSH guard 只是说明展开，不执行操作 | `setLanguage`；`getPi().setContextManagerMode` / `setChannelWatchEnabled`；对应 `permissions` IPC 写配置。首次打开由 `getContextManagerConfig/getChannelWatchConfig` 加载。 |
| **外观** `AppearancePanel.tsx:27-121` | 主题 3 个按钮；背景选取、清除（条件）；背景 dim range；center orb `Switch` | 主题 `light/dark/system`；选择图片打开原生文件对话框并持久化，清除恢复默认；range 20–100% 连续更新遮罩；center orb 二态开关 | `useThemeStore.pickBackground/clearBackground/setBackgroundDim/setMode`（背景通过 Electron 文件选择/用户数据）；`useUiPreferencesStore.setCenterOrbEnabled`。 |
| **模型/Provider** `providers/ProvidersPanel.tsx`、`ProviderRow.tsx` | Provider/子代理 2-tab；后台 reviewer checkbox；网络刷新；Provider 数组行。每行测试、OAuth/API-key 登录、编辑、删除/移除凭证、模型总开关；展开模型列表后每个模型一个 `Switch` | 切 tab 只改本地；网络刷新绕过新鲜度窗口；测试显示成功模型或错误；模型隐藏支持全显/全隐/混合态，失败回滚；自定义 Provider 可删除；内置 Provider 编辑 base URL/key | `listProviders/getModelPrefs/listSubagents`；`listProviders({forceNetwork:true})`；`testProvider`；`saveApiKey/removeCredential/add/update/removeCustomProvider/setProviderBaseUrl`；`setModelHidden/setModelsHidden`；全部通过 `settings` IPC，并在变更后刷新 models。 |
| **Provider 编辑表单** `BuiltinProviderEditForm.tsx`、`CustomProviderForm.tsx`、`ModelRowsEditor.tsx` | 内置 base URL + password key；自定义 id/name/base URL/API/model 行/key；模型行增删、上下移、上下文/输出/思考/图像输入字段 | 表单校验后保存；取消不写入；secret 不显示；自定义模型可追加/删除、字段按行转共享类型 | `setProviderBaseUrl` 或 `addCustomProvider/updateCustomProvider`；保存成功关闭并刷新 Provider/模型选择器。 |
| **登录对话框** `LoginDialog.tsx`、`stores/provider-login.ts` | auth URL、device code、info links；select prompt 动态按钮；text/secret/manual_code 输入；取消/关闭 | 启动前先订阅登录事件；`auth_url` 自动打开浏览器一次，URL 可再次点击；device code 展示验证码；prompt 应答按 promptId 关联，secret 禁止空提交；取消调用 backend，错误保留对话框 | `onProviderLoginEvent`（`prompt/prompt-cancel` 与 `auth_url/device_code/progress/info`）；`startProviderLogin/respondProviderLogin/cancelProviderLogin/openExternal`；`SettingsLoginEvent` 由 main 转发。 |
| **技能/Tools** `SkillsPanel.tsx` | research-vault 管理按钮；关键词输入；方向/类别 2 个 select；类别组折叠按钮；每个技能 `<details>`；工具清单折叠 | 输入实时过滤；方向、类别联动过滤；组折叠只在无过滤时有效；技能详情显示来源、路径、描述；管理按钮跳知识库设置 | 资源来自 `getLoadedResources(activeSessionId)`；管理按钮 `useSettingsStore.openWith("knowledge")`。无真实会话显示空态。 |
| **工作流总览** `WorkflowOverview.tsx` | 六个方向卡（`WORKFLOW_DIRECTIONS.map`）；展开后阶段列表；“查看技能” | 点击方向仅展开/收起，不激活技能或执行流程；阶段解析当前已加载技能和命令；查看技能跳 Skills 分类 | 只读 `useSettingsStore.skills/capabilities` 与 shared 工作流定义；无 IPC 写操作。 |
| **权限** `PermissionsPanel.tsx`、`PatternTable.tsx` | 读/写/temporary/fallback 多个 action select；auto approve `Switch`；每个工具规则表（pattern input/action select/上移/下移/删除）；新增规则表单；试算 command + run；保存、丢弃、重载、恢复默认、审计、打开位置；`<details>` 冲突/确认 | 草稿与磁盘快照分离；mtime 冲突显示二次确认后强制覆盖；新增/删除/移动规则只改草稿；试算只执行同一规则求值，不执行命令；重置有确认；审计显示尾部 | `getPermissionSettings/savePermissionSettings/probePermission/readPermissionAuditTail/openPath`，全部 `permissions` IPC；文件写用 backend 原子 JsonStore，主进程提供 native open path。Enter 在规则/试算输入中触发。 |
| **MCP** `McpPanel.tsx` | 刷新；打开配置文件；内置 preset 列表（按 `MCP_PRESETS.map`）；setup 外部链接；server 列表动态 `Switch` | 刷新同时取 status/config；preset 添加后禁用并刷新；外部 setup 打开网页；server enable/disable 写配置并重新取状态；状态徽章 connected/failed/needs-auth/blocked/disabled | `getMcpStatus/getMcpConfig`；`addMcpPreset/setMcpServerEnabled/openMcpConfig/openExternal`；`onMcpEvent` 实时更新当前 cwd 的 server 状态。 |
| **扩展市场/已加载** `ExtensionsPanel.tsx`、`BrowseSection.tsx`、`LoadedSection.tsx`、`rows.tsx` | browse/loaded tab；搜索框（300ms 防抖）；类型 chips all/extension/skill/prompt/theme；目录包安装；分页；卸载二次确认；已加载扩展统计和错误 | 陈旧搜索响应以序号丢弃；subagent 包安装必须二次点击确认；卸载 hover 离开或 3 秒恢复；安装/卸载后刷新 settings 资源，非流式会话热 reload | `searchCatalog/installPackage/listConfiguredPackages/removePackage/getLoadedResources`；安装/卸载通过 `packages` IPC；打开项目/用户 package source 由 backend 决定。 |
| **UI 插件** `UiPluginsSection.tsx` | 总开关；每插件 enable/disable（第三方二次确认）、rebuild、打开目录；插件数组；争抢 slot 的 Dropdown（每个候选 + none） | 总开关关闭时保留配置但隐藏贡献；启用第三方需第二次点击，3 秒恢复；rebuild 显示 spinner；错误状态 invalid/build/load 分级；slot assignment 只在多个健康插件竞争时出现 | `uiPluginsGetConfig/uiPluginsList/uiPluginsSetEnabled/uiPluginsSetPluginEnabled/uiPluginsAssignSlot/uiPluginsRebuild/uiPluginsOpenDir`；main 重载 registry，设置页和各 Slot 以 loadNonce 隔离失败。 |
| **LAN 观察** `LanObserverPanel.tsx:7-107` | 总启用 `Switch`；remote-control `Switch`；只读 URL input；复制按钮；可选 QR 图片 | 开启服务后展示 port/clients；remote-control 独立开关；URL 复制成功文案 2 秒恢复；状态开启时每 5 秒刷新；无地址显示 noAddress | `lanGetStatus/lanSetEnabled/lanSetRemoteControl`；复制为浏览器 `navigator.clipboard.writeText`；服务端状态由 backend LAN server 提供，非实时 push。 |
| **Zotero** `ZoteroPanel.tsx`、`ZoteroWebApiSection.tsx`、`ZoteroLocalWriteSection.tsx` | MCP 开关；刷新；安装/启动/打开文档/打开下载；Web API key/group id 保存/清除；本地写授权/清除 | 读取 Zotero status；启用 MCP 后重新取状态；Web API key 仅输入/保存，不回显；local-write 是显式授权态 | `getZoteroStatus/setMcpServerEnabled/openExternal/startZoteroSetup`；`get/save/clearZoteroWebApi`；`get/authorize/clearZoteroLocalWrite`，密钥写 backend agentDir secret 文件。 |
| **知识库维护** `KnowledgePanel.tsx`（高级） | overview/reviews/maintenance/semantic/topics 5-tab；刷新；绑定路径输入、选择目录、预览、setup；review mode select；Wiki history details/undo；Semantic、Topics、Specialists、Research runs 子组件 | tab 只在有 binding 时开放；setup 先 preview，成功后显式启动；review strict/automatic 写维护动作；Wiki undo 要 `window.confirm` 且带 expectedHash；语义配置保存/测试/索引/取消；主题查询、archive、resume；专家模型/思考级别保存 | Knowledge host API 经 preload/main IPC；路径选择 `pickDirectory`，打开 Vault `openKnowledgeTarget`；维护 `maintainKnowledge`；审核、语义、主题、专家、研究运行分别见下节。 |
| **计算** `ComputePane.tsx`（高级入口） | host 列表 probe/terminal/submit example/remove；新增 host 表单；job select/cancel/log；terminal input/send；onboarding 检查 | host 保存/删除，probe 读健康；提交示例作业；终端按 Enter 写入；作业 cancel；引导步骤可点击检查 | `useComputeStore` 最终调用 compute host API；终端写入和远程 job 受授权/预算/主进程适配器门控；结果与 inquiry decision/artifact 记录联动。 |
| **关于** `AboutPanel.tsx` | 更新按钮（检查/下载/安装/手动 release）；源码仓库；诊断导出 | 根据 update phase 改变按钮文案；manual 更新打开 release；诊断 ZIP 保存成功/失败状态 | `getAppInfo/checkForUpdates/downloadUpdate/installUpdate/openExternal/saveFileDialog/getDiagnostics`；诊断序列化后写用户选择路径。 |

## 3. 知识网络、WebDAV、研究与 Inquiry 页面

### 3.1 Knowledge Home 与全屏视图

`KnowledgeView.tsx` 将知识库作为主区全屏视图，而不是传统 z-index 弹窗：

- 进入时若 store 无上下文，会以当前 cwd/session 打开 `reviews`；关闭按钮同时 `close()` 和 `setView("chat")`。
- 全局 `document.keydown` 监听 Escape；焦点在 input/textarea/contentEditable 时不关闭，审核弹窗打开时交给审核层处理。
- `KnowledgeHome.tsx` 首屏读取 overview，显示 Vault path、noteCount、pendingChanges、刷新、打开 Vault、管理（跳高级知识库设置）。
- Home 还包含搜索、每日发现、知识图谱、最近沉淀列表和待审核列表。最近条目按钮直接打开对应 note+revision，保证阅读基于已绑定 revision。

### 3.2 Knowledge Graph / Research Observatory（PR #113）

源码：`KnowledgeGraph.tsx:108-522`、`graph-layout.ts`。

**控件和行为**

1. **视图切换**：`语义视图/全部文件` 两个 `Button`，修改 `view` 并触发 `getKnowledgeGraph({revision, limit:400, view, mergeMirrors})`。
2. **镜像合并**：`mergeMirrors` checkbox；切换重新取图。
3. **关系过滤**：`all/link/directory` 三个动态固定按钮，筛边但不重新取图。
4. **类别过滤**：按数据中实际出现的 `paper/method/software/dataset/concept/entity/idea/claim/evidence/decision/question/wiki/other` 生成彩色 chips；点击同一类别取消过滤。图节点仍可点击。
5. **观测台相机**：`+`、`−`、`⌂`、`Fit` 四个按钮，scale 限制 65%–280%；fit 根据点包围盒计算相机。
6. **SVG 原生事件**：`wheel` 以指针为锚点缩放；左键 `pointerdown/move/up/cancel` 平移，使用 pointer capture；节点 `click/focus` 选择并加载 `getKnowledgeNoteLinks({path,revision})`；节点 `keydown` 支持 Enter/Space/Escape；全局 `keydown` 支持 `+/-/0/F/Escape`（输入框例外）。
7. **节点详情**：显示类别、path、degree、links/incoming/outgoing、isolated/duplicate 健康；关系项按钮切换选择；打开来源触发 `openKnowledgeNote`（读取 note + revision）。
8. **状态**：数据 loading/error/empty；最多 400 节点并显示 total/limit、孤立、重复指标；`nonce/indexKey` 用于索引后刷新。

**科学化升级保留点**：类别色板、关系过滤、节点健康指标和 revision 绑定是科研审计基础；应保留“语义/全部”双视图与显式合并镜像开关。建议增加图例可点击说明、筛选状态 URL/会话书签、节点选择的证据卡（来源、hash、最后 reconcile）、加载耗时/截断标记和大图降采样提示。图上的深蓝观测台背景可以保留，但控制按钮与图内信息需要统一 Design Token，避免暗色图和浅色设置像两个产品。

### 3.3 WebDAV 云端知识库与显式同步

源码：PR #113 `KnowledgeCloudSection.tsx:44-374`；共享类型 `shared/src/knowledge.ts:230-247, 588-610`；preload 映射 `desktop/src/preload/index.ts:66-106, 322-328`。

**连接与凭据**

- 状态初始化：`getKnowledgeCloudStatus()`。状态显示 endpoint/folder、`disabled/unchecked/offline/unauthorized/read-only/ready/error`。
- 密码输入（password、autocomplete off、maxLength 256）；提交调用 `setKnowledgeCloudPassword({password})`，清除只在 `passwordSource === "saved"` 时启用。环境变量 `DRONE_WEBDAV_PASSWORD` 优先且只显示来源提示，不回显密码。
- Probe/Initialize 按钮分别调用 `probeKnowledgeCloud()` / `initializeKnowledgeCloud()`；initialize 在 `status.initialized` 时禁用。失败通过 `role=alert` 展示。

**显式同步工作台**

1. **搜索**：在有 `bindingRevision` 时出现 query input + submit；调用 `searchKnowledge({cwd,bindingRevision,query,limit:8})`。结果按 path/title 列表，点击 hit 调 `preview(path)`。
2. **双边预览**：`preview` 并行调用本地 `readKnowledgeNote({cwd,path,startLine:1,revision})` 与远端 `readKnowledgeCloudNote({path})`。记录 local/remote/remoteMissing/remoteError；比较结果为 `same / conflict / local-only / remote-only / unavailable`。
3. **Pull/Push**：非 conflict 时，Push 只在有 localNote 时启用，Pull 只在有 remoteNote 时启用。调用 `syncKnowledgeCloud` 时携带本次预览的 local hash、remote hash 与强 ETag；冲突覆盖动作先确认，后端再次核对预览版本，完成后再次 preview。
4. **冲突决策**：conflict 时并排显示本地/远端最多 7000 字预览，提供“采用本地并 Push”（`resolution:"local"`）和“采用远端并 Pull”（`resolution:"remote"`）。没有隐式覆盖。
5. **结果**：显示 `KnowledgeCloudSyncResult.items[0].message` 或“同步完成/需要复核”；busy 期间所有危险操作禁用；无 binding 明确显示“需要绑定”。

**安全/原生边界**

- UI 无定时同步、无后台镜像，所有 WebDAV 网络请求都由 backend service + main IPC 触发；按钮是可审查的副作用边界。
- backend `webdav-sync` 使用 binding revision、强 ETag/条件写和冲突状态；WebDAV transport 不在首个请求发送 Basic 密码，等待服务端挑战后协商 Digest/Basic。密码不进入状态或 UI 事件。
- 科研升级应把每次 Pull/Push 记录为可导出的同步事件（path、local/remote hash、ETag、revision、操作者、时间、结果），并让“采用哪一侧”成为明确的研究决策，而不是普通保存按钮。

### 3.4 搜索、每日发现、流程与研究运行

| 页面/组件 | 控件/事件 | 行为与 IPC |
|---|---|---|
| `KnowledgeSearch.tsx` | query input + form submit + hit button | `searchKnowledge({cwd,bindingRevision,query})`；结果点击打开知识库 dialog 的 note/revision；空查询禁用提交。 |
| `DailyIdeas.tsx` | 自动发现 `Switch`；Run；每条 idea 打开/Save/Dismiss | `getDailyDiscovery`；`updateDailyDiscovery({enabled/run})`；`decideDailyIdea({id,action})`；操作后 revision 失效/刷新。 |
| `KnowledgeFlowCard.tsx` | 折叠标题；Open in Wiki；来源/产物 Open source；Maintenance/Resume | 读 `getKnowledgeOverview({cwd,sessionId})`；open source 显示 `KnowledgeNoteViewer` 或 ResourcePreview；blocked 状态 `resumeKnowledgeCheck(sessionId)`；specialist runs 仅展示 observed/unverified 回执。 |
| `ResearchRunsCard.tsx` | 运行条目按钮；details 展开；来源 path 按钮 | `getResearchRuns({cwd,project,limit:8})`；选择后 `getResearchRun({runId})`；来源打开 note preview。 |
| `KnowledgeMaintenance.tsx` | Reconcile；Refresh navigation（确认）；分页；打开笔记 | `getKnowledgeJobs`；`maintainKnowledge({action})`；刷新后 `invalidate`；分页 offset。 |
| `TopicManagement.tsx` | query、Load、Archive、Resume、异常 details | `getKnowledgeTopics({query})`；`archiveKnowledgeTopic`；resume 走当前 session prompt/flow，归属 project/cwd。 |
| `KnowledgeSpecialists.tsx` | mode select；每个专家 model/thinking select；Open model settings | `setKnowledgeSpecialistSettings`、`setSubagentModel`、`setSubagentThinking`；预算和 permitted/read-local 状态只读显示。 |

### 3.5 审核与模型审核

- `WikiReviewPanel`：加载待审核列表（每页 12）、分页、选条目；`previewKnowledgeReview` 生成 token；来源按钮打开 note viewer；过期/targetChanged/stale 强制重新 preview；checkbox/决策按钮执行 `decideKnowledgeReview({token,decision})`。Apply/Reject 的区别明确显示，写入受 expected hash/revision 保护。
- `WikiReviewDialog`：收到 `onKnowledgeEvent` 的 `open-review` 时弹出；Later 放回队列，Reject/Apply 提交 token；Esc 只由审核层处理，避免误关闭主视图。
- `WikiModelReview`：展开“用模型审核”表单；ack checkbox 和 auto checkbox；review 按钮调用 `reviewKnowledgeWithModel`，运行中可 cancel；结果展示来源、审计与 details，模型选用来源 session 的 project/cwd。
- `KnowledgeUiRoot`：订阅 `getPi().onKnowledgeEvent`：`invalidate` 250ms 合并，`open-review` 定位 cwd/session/id，其他 flow/notice 写 store；notice 6.5s 自动消失，错误不自动消失，可手动关闭。

### 3.6 语义索引、主题、Institutional、Zotero、Note Viewer

- `SemanticManagement`：provider select、enabled、base URL/model、minSimilarity、credentialEnv、remoteConsent 共 7 个输入/开关；Save、Test provider、Start index、Cancel index。链路 `get/save/test/index/cancelKnowledgeSemantic`，index 具有 requestId，取消只取消当前任务。科研风格应展示模型版本、embedding 维度、阈值、索引 revision 和“远程同意”审计。
- `InstitutionalAccessSection`：刷新状态、打开登录、清除 session、test URL + test。调用 `getInstitutionalStatus/openInstitutionalLogin/clearInstitutionalSession/testInstitutionalAccess`；外部机构登录是系统浏览器跳转，凭证不入 renderer。
- `ZoteroPanel` / Web API / Local Write：状态刷新、MCP enable、安装/启动、下载/文档链接；Web API key/group id 保存和清除；本地写入授权/清除。链路 `getZoteroStatus/setMcpServerEnabled/get-save-clearZoteroWebApi/get-authorize-clearZoteroLocalWrite`，均由 backend 保管密钥。
- `KnowledgeNoteViewer`：加载 note，Human review details，前后行跳转，Open target；读取固定 binding revision，不能把未绑定的远端文本直接当事实。

### 3.7 Inquiry 产物与可复现性（`ArtifactsPane.tsx`）

虽然位于 `components/panel`，它是科研结果的实际工作台入口：

- 挂载时 `listArtifacts(cwd)` 取 `purpose === "deliverable"` 的产物，按记录渲染 provenance cards；`onRerunUpdated` 订阅异步重跑事件。
- 每个产物卡 Expand/Collapse 调 `artifactProvenance(record.id,cwd)`，展示 reproducibility 三态、attempt 参数、代码 fingerprint、workflow/modules、container digests、command summary、environment、parent chain；可点击 `sourceSessionId` 切换会话。
- remote + reproducible 才显示 Rerun；调用 `rerunArtifact` 返回 submitted/running/reproduced/superseded/failed。收到 `InquiryRerunUpdatedEvent` 后更新状态，superseded 刷新 artifact list。
- 链路：renderer `getPi()` → preload `InquiryContract`（`InquiryArtifacts/InquiryArtifactProvenance/InquiryRerunArtifact`）→ main `registerInquiryIpc` → backend InquiryService。事件为 `InquiryRerunUpdatedEvent`。建议把“重跑”明确标成副作用，并在 UI 显示新旧 sha256、差异摘要和使用的环境指纹。

## 4. 原生/跨进程事件清单

| 事件或 API | 触发页面 | 目的、当前行为、升级要求 |
|---|---|---|
| `onKnowledgeEvent` | KnowledgeUiRoot | `invalidate/open-review/flow/notice`；当前 invalidate 250ms 合并。升级：在通知和图谱上显示事件时间、来源 session、revision。 |
| `onMcpEvent` | McpPanel | 按 cwd 更新 server status；升级：显示最近事件、重连次数和认证需要。 |
| `onProviderLoginEvent` | Provider LoginDialog/store | auth_url/device_code/prompt/progress/info；升级：把 OAuth/API-key/浏览器跳转明确区分，记录 promptId 状态而不记录 secret。 |
| `onRerunUpdated` | ArtifactsPane | 重跑状态异步更新；升级：展示 job id、差异和 hash 变化并可复制 provenance。 |
| `document.keydown` | KnowledgeView、KnowledgeGraph | Escape 关闭/取消选择，图谱 +/−/0/F；升级：帮助浮层列出快捷键、焦点可见、避免与全局 composer 冲突。 |
| SVG `wheel/pointer*` | KnowledgeGraph | 缩放/平移，pointer capture；升级：触摸/键盘平移等价、`prefers-reduced-motion`。 |
| `setInterval(5000)` | LAN Observer | 开启后刷新状态；升级：改为 main 推送或退到 15–30 秒可配置轮询，并显示 last seen。 |
| `navigator.clipboard` | LAN Observer | 复制访问 URL；升级：clipboard 失败时提供可选择文本和状态提示。 |
| Electron `openExternal` | Provider 登录、MCP preset、Zotero、Institutional、About、Knowledge | 系统浏览器打开 OAuth、文档、release、Zotero；升级：统一“即将离开 Drone”确认/审计标识。 |
| Electron `pickDirectory/openKnowledgeTarget` | KnowledgePanel | 选择/打开 Vault；升级：预览中显示 realpath、权限、样本文件数和 revision。 |
| Electron `openMcpConfig/openPath` | MCP、权限 | 打开配置文件/目录；升级：显示文件来源（user/project）和只读边界。 |
| Electron `saveFileDialog/getDiagnostics` | About | 诊断 ZIP 导出；升级：导出前显示脱敏清单/版本/平台，不包含 session 正文和 secret。 |

## 5. 现有 UI 风格评估

### 可以保留的基础

1. 设置页使用低饱和中性色、紧凑行、`text-[11–13px]` 层级，适合高密度科研工具；不要整体改成营销式大卡片。
2. 现有状态 badge、loading spinner、`role=alert/status`、`aria-pressed/expanded` 和二次确认模式已经覆盖很多危险行为。
3. 图谱深蓝观测台、节点类别色、关系过滤和健康指标形成了可识别的“研究观测”语义。
4. WebDAV 显式 Pull/Push、冲突双栏和 revision/ETag 保护符合科研写作的可追溯边界，应作为全客户端副作用交互的标准。

### 当前不一致或风险

- 设置页多用 `bg-hover` soft 卡和浅色 border；图谱使用硬编码深蓝 token；知识维护、Zotero、MCP、Compute 的层级和危险色没有统一。
- `window.confirm` 仍用于 Wiki undo，而其他危险操作多采用二次按钮；应统一可审计确认组件。
- 同一“刷新”动作有图标无文字、文字按钮、spin 文案三种形态；network/API 状态缺少 last updated 和请求耗时。
- `Button`、原生 `button`、`Switch`、链接样式混用；图谱类别按钮、MCP preset、Provider icon action 的焦点/hover 对比度未形成统一规范。
- 动态列表多数只显示名称、路径、数字，缺少 provenance 的四元组：来源、版本/修订、更新时间、可信/待复核状态。
- knowledge copy 中部分 WebDAV 和 graph 文案独立于桌面 i18n，升级时需维护中英文和术语表一致性。

## 6. 科研工作台风格升级方案（建议分阶段）

### 6.1 设计原则与信息架构

1. **观测优先**：每个页面第一行显示对象、scope（user/project/session）、当前 revision、同步/索引状态和最近更新时间。
2. **证据优先**：每个结果或状态都能展开来源（path、hash、ETag、代码指纹、模型版本、操作者）；“已观察”“待复核”“已验证”“冲突”使用统一四态。
3. **副作用有边界**：写文件、联网、安装包、重跑、启用远控都使用明确动词、作用域和确认；禁止以“保存”掩盖 Push/Apply/Rerun。
4. **渐进披露**：默认显示结论和关键计数；详情、规则、原始响应、审计日志放 disclosure，避免 400 节点/数百模型淹没主线。
5. **可复现交互**：筛选、图谱相机、搜索 query、tab、选中路径可以复制为链接/会话书签，回到同一 revision 可重现。

建议主导航改成四组：**研究状态**（Home、Graph、Runs、Artifacts/Inquiry）；**证据操作**（Reviews、Topics、Semantic、Zotero、WebDAV）；**运行配置**（Providers、MCP、Extensions、Plugins、Permissions、Compute）；**环境**（General、Appearance、LAN、About）。设置弹窗仍可保留，但知识库和产物可拥有主区宽版工作台。

### 6.2 Design Tokens

- **背景/层级**：`canvas`（#f6f7fb / dark #0b1220）、`surface`、`surface-raised`、`border-subtle`、`border-strong`；图谱使用同一套 dark token 的 graph 变体，而不是组件内硬编码颜色。
- **语义色**：`observed` 蓝、`verified` 绿、`pending` 琥珀、`conflict` 红、`unavailable` 灰；每种同时有图标/文字，不能只靠颜色。
- **科学对象色**：paper/method/software/dataset/concept/claim/evidence/decision/question 使用色盲友好的 12 色，图例、badge、详情卡共用 CSS variables；颜色只表达对象类别，不表达可信度。
- **文字**：UI 采用 12/13/14 px 三档，数据使用 tabular numerals 和 mono；正文/摘要不再用过多 `text-[11px]`，确保阅读和缩放。
- **动作层级**：primary（Apply/Push/Rerun）、secondary（Refresh/Preview）、quiet（Open path）、danger（Reject/Delete/Clear）；icon-only 必须 Tooltip + aria-label + 44px 触控命中区。

### 6.3 页面改造优先级

| 阶段 | 页面 | 改造交付 |
|---|---|---|
| P0（先统一基础） | SettingsDialog、Button/Switch、ConfirmDialog、StatusBadge | 统一 token、焦点环、键盘导航、确认/错误/空态、i18n key；将 `window.confirm` 替换为可显示副作用 scope/hash 的确认卡。 |
| P0 | Knowledge Home/Graph/WebDAV | 研究 scope + revision header；Graph legend/filter drawer/性能提示；WebDAV 双栏 diff、hash/ETag/revision、Pull/Push 审计回执；显式同步保持手动。 |
| P1 | Reviews/ModelReview/Semantic/Topics | 审核队列列出来源、风险、targetChanged；模型审核显示 model/version/预算；语义索引显示 provider/threshold/index revision/progress；主题显示生命周期。 |
| P1 | Artifacts/Inquiry/Research Runs | 产物 provenance timeline、reproducibility badge、重跑副作用确认、旧/新 sha256 与差异；Run 卡展示环境和容器 digest。 |
| P1 | Providers/MCP/Extensions/UI Plugins | 统一 scope（user/project/session）、最后刷新时间、版本/来源；安装/启用/远控均有风险标签；MCP status 事件时间线；插件 slot 冲突可解释。 |
| P2 | Permissions/Compute/LAN/Zotero/Institutional | 权限规则模拟器支持“输入→判定→命中规则”解释；Compute host/job/terminal 按实验 run 关联；LAN 显示端口/地址/远控审计；Zotero/Institutional 显示授权时效与密钥来源。 |
| P2 | Appearance/About/General | 暗/亮主题 token 对齐，诊断导出脱敏预览；快捷键和 reduced motion；上下文蒸发/channel-watch 显示影响范围和最近变更。 |

### 6.4 典型科研页面线框行为

**知识网络观测页**

- 顶栏：`Project / Vault / revision 42 / last reconciled / coverage`。
- 左侧 filters：semantic/all、category、relation、isolate/duplicate、search；过滤器显示结果计数和“恢复默认”。
- 中央 graph：缩放/适配/键盘操作；选中节点右侧证据卡显示 path、content type、degree、hash、incoming/outgoing、最近审核。
- 下方 timeline：索引、审核、WebDAV Pull/Push、研究运行按时间排列，所有副作用可展开查看。

**WebDAV 同步卡**

- 状态行：`ready · endpoint · folder · credential source · last probe`。
- 选择笔记后双栏 local/remote；顶端显示 local hash / remote hash / ETag / revision。
- 相同只显示“已一致”；local-only/remote-only 给单向按钮；conflict 显示差异并要求“采用本地 Push/采用远端 Pull”，确认卡写明覆盖方向。
- 回执：items、HTTP 状态、hash 变化、ETag、新 revision、可复制审计 JSON；永远没有后台自动同步。

**产物/Inquiry 卡**

- 首行：artifact path、status（pending-review/valid/superseded）、sha256 截断值、来源 session。
- 展开：attempt、parameters、code fingerprint、workflow/modules、container digests、parent chain、environment。
- Rerun 前确认：预计执行位置、输入 artifact、预算、输出路径；完成后显示旧/新 hash 和差异，收到 `onRerunUpdated` 时保留 timeline。

### 6.5 无障碍、性能与测试门槛

- 所有 icon-only、图谱节点、颜色 badge 都有文本等价物；键盘可到达并有可见 focus；`aria-pressed/expanded/selected` 与真实状态一致。
- 维持 reduced-motion：关闭 graph glow、spinner 降级；支持 200% UI 缩放和窄屏下双栏变纵向。
- Graph 400 节点时保证首屏交互；超过阈值采用 canvas/WebGL 或分层抽样，显示“当前显示 400/total”；把布局耗时和 API latency 放到 debug disclosure。
- 每个副作用写 UI contract 测试：WebDAV conflict 不能隐藏 Push/Pull 方向；权限 mtime 冲突不能无确认覆盖；Provider login promptId 不错配；Inquiry rerun 状态事件不丢失。
- 视觉回归覆盖浅/深/系统主题、中英文、空/加载/错误/冲突/disabled/超长路径、键盘和 reduced-motion。

## 7. 推荐实施顺序和验收证据

1. 先抽取 token + `StatusBadge/ActionButton/ConfirmDialog/ScopeHeader`，改 SettingsDialog、WebDAV、Graph 三个代表面板；确保 lint/typecheck 先绿。
2. 再做 WebDAV/Graph/Inquiry 的可追溯卡和事件 timeline；新增纯函数测试验证状态机，不调用真实 WebDAV 或模型。
3. 接着迁移 Providers/MCP/Extensions/Plugins/Permissions/Compute/LAN，保持每项现有 IPC 通道不变，只替换 renderer 视觉和确认层。
4. 最后迁移知识审核、语义、主题、Zotero 和诊断导出，补中英文术语表与 accessibility smoke。
5. 验收包应包含：静态交互清单 JSON、页面状态矩阵、截图（中英文×浅深主题）、WebDAV conflict 录屏/trace、Graph 400-node latency、Inquiry rerun event trace、无障碍键盘走查。

本盘点没有改生产代码；下一步可由 root 将其与 PR #113 集成审查及第 9 项发布治理计划合并，作为第 10 项 UI 升级的基线。
