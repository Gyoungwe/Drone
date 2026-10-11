# Drone 客户端核心 UI 盘点（2026-10-11）

> 这是对 `packages/desktop/src/renderer/src` 中核心生产 renderer 的静态交互盘点，服务于第 10 项的 UI 升级设计。范围包括 App 路由、工作台导航、会话/项目、聊天流、Composer、右侧上下文面板、资源预览和权限/询问弹窗；知识库/设置/插件的专门控件由另外的盘点覆盖。

## 1. 口径和数量

盘点命令以 `packages/desktop/src/renderer/src/components/{workbench,projects,session,composer,chat,panel,diff,tasks}` 为范围，排除 `*.test.*`，对 JSX 原生标签和共享 `<Button>` 组件做静态计数。结果是**控件站点**而不是运行时按钮实例：`map()`、任务数、模型数、会话数、插件数会在运行时复制控件。

| 区域 | 生产 TSX 文件 | `<button>` | `<input>` | `<textarea>` | `<select>` | 共享 `<Button>` | 主要事件属性数* |
|---|---:|---:|---:|---:|---:|---:|---:|
| 工作台导航 | 1 | 5 | 0 | 0 | 0 | 0 | 5 |
| 项目页 | 6 | 12 | 1 | 0 | 0 | 0 | 13 |
| 会话/权限 | 5 | 8 | 2 | 0 | 0 | 10 | 22 |
| Composer | 14 | 23 | 1 | 1 | 0 | 0 | 31 |
| 聊天流 | 33 | 25 | 2 | 0 | 0 | 2 | 33 |
| 上下文面板 | 10 | 36 | 10 | 1 | 3 | 15 | 68 |
| Diff/资源预览 | 7 | 26 | 3 | 1 | 0 | 0 | 32 |
| 任务示例弹窗 | 2 | 1 | 1 | 0 | 1 | 6 | 9 |
| **合计** | **78** | **136** | **20** | **3** | **4** | **33** | **213** |

\* 事件属性统计包含 `onClick/onChange/onKeyDown/onDrop/onDragOver/onMouseEnter/onPaste`，也包含列表项和数据驱动行的重复站点；窗口级事件（`keydown/pointerdown/wheel/scroll/selectionchange`）另计。`<Button>` 共 33 个站点（会话/权限 10、聊天 2、面板 15、任务示例 6），组件最终渲染为原生按钮；升级时要按语义组件统计而不是只按 JSX 标签统计。

**运行时复制点**：会话标签、项目、历史会话、模型、思考档、权限档、slash 命令、`@` 文件/子智能体、消息图片、任务/里程碑、变更文件/轮次、子智能体运行、计算主机/作业、审批队列、Ask 题目选项、资源表格行均由数组映射产生。静态 136 个原生按钮站点（另有 33 个共享 Button）不能代表用户实际看到的按钮数。

计数可复现：`find packages/desktop/src/renderer/src/components/{workbench,projects,session,composer,chat,panel,diff,tasks} -name '*.tsx' ! -name '*.test.*'` 后对 `<button|input|textarea|select|Button` 与上述事件属性做字符串计数；这是审计基线，重构后应改用 TypeScript AST 计数以避免注释/字符串误报。

## 2. 应用壳与路由页面

`App.tsx` 是单页壳：`SessionTabBar → WorkbenchNav → 主视图 → ContextPanel`，设置、Ask、Trust、示例任务和 Toast 是 z-index 叠加层。`useUiStore.view` 的路由值为 `chat | projects | knowledge | plugin:*`。

| 页面/表面 | 进入方式 | 页面组成 | 事件与状态变化 |
|---|---|---|---|
| **聊天（chat）** | Rail「聊天」；点击会话 tab；发送后自动回 chat | `EmptyState` 或 `MessageList`；底部 `ApprovalDock`（无审批时 `Composer`）；右侧 `ContextPanel` | `setView("chat")`；会话切换写 `sessions.activeSessionId/cwd` 并 `saveTabs`；agent 运行边界自动开/收右栏；流式 transcript 只更新对应会话；Composer 最终走 `window.pi.prompt/stop/...` |
| **项目/空间（projects）** | Rail「项目」 | `SearchBar`、`ProjectSidebar`、`SessionPanel` | `projects.load` 拉历史；搜索只改 store；选择项目改 `selectedCwd`；新建是 renderer draft，首条消息才 `pi.createSession`；打开历史 `pi.getSessionMessages` 等 bundle |
| **知识库（knowledge）** | Rail「知识库」；产物页签入口 | `KnowledgeView`（知识盘点在另一份清单） | `knowledge.open({cwd,sessionId,tab})` 与 `view` 联动；知识页全屏，不叠右栏 |
| **插件全屏视图** | 插件注册 `UI_REGIONS.RailView` | `PluginEntryHost` | 插件入口点击 `closeKnowledge(); setView(entry.id)`；插件卸载后 effect 将失效 view 回退 chat |
| **右侧上下文面板** | 顶栏 PanelRight 按钮；运行自动展开；消息 chip 跳转 | `tasks/process/artifacts` 常驻，`subagents/compute` 按需；插件 `PanelTab` | `useUiStore.panelOpen/panelTab/processView/resourcePreview`；空闲开关持久化到 localStorage，运行中只临时开关；变更/资源/过程聚焦使用 nonce 防重复跳转 |
| **叠加弹窗** | 事件桥或按钮触发 | `AskDialog`、`TrustDialog`、`ExampleTaskDialog`、`SettingsDialog`、`Toaster` | App 维护 request 队列；应答成功才出队；失败留在 UI，避免 agent 等待状态丢失 |

## 3. 左侧工作台导航（`WorkbenchNav.tsx`）

固定 56px rail，按钮视觉为图标 + 文本（`workbench-nav-item`），active 用 `is-active` + `aria-current="page"`，底部设置/帮助/扩展采用同一控件族。

| 控件 | 当前行为（store → IPC/API） | 关键 UI 状态/边界 |
|---|---|---|
| 聊天 | `closeKnowledge(); setView("chat")` | active 与 `view` 单一来源；没有隐藏 local selected |
| 项目 | `closeKnowledge(); setView("projects")` | 项目页自己触发 `projects.load()` |
| 知识库 | `knowledge.open({cwd,sessionId,tab:"reviews"})` | 关闭旧知识页，主区全屏 |
| 每个插件 RailView | `closeKnowledge(); setView(plugin:id)` | 插件卸载/禁用后自动回退 chat |
| 扩展 | `settings.openWith("extensions")` | 走设置弹窗，不切主视图 |
| 设置 | `settings.openWith("general")` | 设置页签由 store 管理 |
| 帮助/About | `settings.openWith("about")` | 仍是设置弹窗中的 About surface |

## 4. 顶部会话轨道（`SessionTabBar.tsx`）

### 4.1 每个会话胶囊（数据驱动）

- **单击胶囊**：`sessions.switchSession(sessionId)`、`ui.setView("chat")`；会话读写 `saveTabs`，切到 chat 后 `markCompletionSeen`。
- **双击胶囊（真实、非只读、非 draft）**：内联 `TabRenameInput`；输入框 `Enter` 提交、`Esc` 取消、blur 提交。提交先 `sessions.updateSessionName` 乐观更新，再 `pi.setSessionName`；失败回滚并 `pushToast("error", "tabbar.renameFailed")`。
- **悬停关闭 ×**：阻止冒泡，调用 `sessions.closeSession`；真实会话 `pi.closeSession`，失败保留 tab 并 warning toast；draft 只从 renderer 内存删除。
- **状态视觉**：审批 amber、working ink/pulse、完成 green dot、只读子会话 accent；同名标题追加 `createdAt` 时间后缀。
- **拖拽排序**：PointerSensor 5px 激活，KeyboardSensor 支持 Space/左右键；`onDragEnd` → `sessions.reorderSessions`，重排数组并 `saveTabs`；拖拽中锁定水平轴、关闭窗口拖拽区、尊重 reduced-motion。

### 4.2 顶栏按钮/菜单

| 控件 | 行为 |
|---|---|
| 全部会话 List | 开关 `session-list-pop`；外点/Esc 关闭；列表项 `switchSession + setView("chat")`，列表标题/时间/状态点来自 sessions/transcript |
| `+` 新会话 | 有 cwd 时 `sessions.createDraftSession()`（先 `pi.ensureProjectTrust`，只建内存 draft），`setView("chat")`；无 cwd 按钮仍可见但 label 为 pick-project-first 并 no-op |
| 更新按钮 | update store `available → pi.downloadUpdate()`；manual 构建改 `pi.openExternal(repo/releases/tag/vX)`；downloading 显示环；downloaded → `pi.installUpdate()` 重启 |
| 右栏 PanelRight | `ui.togglePanel(agentActive)`；空闲态写 localStorage `drone.panel.idleOpen`；任务待用户/权限挂起时 amber 点；只在 chat view 渲染 |
| 滚轮 | tab 横向容器把垂直 wheel 转为 `scrollLeft`；非 passive listener，防止轨道纵向滚动 |

## 5. 项目页（`ProjectPage`）

### `SearchBar`

- 输入框一处：`projects.search`；`onChange → projects.setSearch`，实时过滤所选项目的会话名称/id。
- 搜索 placeholder 根据当前项目/日常空间动态拼接，空字符串不触 IPC。

### `ProjectSidebar`

- `+ 添加项目`：`projects.addProject()`，通常调用 native `pi.pickDirectory` 并写入 addedProjects；新项目信任请求由事件桥处理。
- 日常空间条目：`projects.select(dailyDir)`；内置、不可删除。
- 每个项目条目（数据驱动）：单击 `projects.select(cwd)`，右侧 `SessionPanel` 过滤到该 cwd。
- 项目删除 ×（两阶段）：第一次只在行内置 `confirming`，第二次 `projects.deleteProject(cwd)`；项目全部会话删除受 store 守卫；取消/鼠标离开状态由本地 state 清理。

### `SessionPanel` / `SessionRow`

- `新会话`：所选 cwd 存在时 `createDraftSession(selectedCwd); ui.setView("chat")`；无项目 disabled。
- 日期分组：today/yesterday/earlier 是纯投影，无额外事件。
- 历史会话行单击：`projects.openSession(session)`（拉 `getSessionMessages/getFollowUpMessages/getTodos/getPermissionMode` 等）成功后 `setView("chat")`。
- 复制诊断（hover）：`pi.getAppInfo` + platform + session 元数据组合，`navigator.clipboard.writeText`；成功短暂 Check，失败静默。
- 删除 ×：第一次确认，第二次 `projects.deleteSession(session)`；鼠标离开重置确认。

### `ProjectBranchPicker`（空态 Composer 下方）

- 项目 Dropdown：日常空间或已有 projects → `sessions.setDraftCwd(cwd)`，该 action 先 `pi.ensureProjectTrust`；“选择项目…” → `sessions.pickDirectory()`。
- 分支 Dropdown：启动/换 cwd 时 `pi.listGitBranches(cwd)`；选择非当前分支 → `pi.checkoutBranch(cwd, branch)`；失败显示行内 error。
- 真实会话隐藏此 picker，防止看似可切但实际绑定不可变；日常空间隐藏分支 picker。

## 6. Composer（`Composer.tsx`）

Composer 是聊天空态和已存在会话共用的输入区域，草稿按 session key 保存在 `drafts` store。核心交互如下。

| 控件/事件 | store → IPC/API 行为 | 状态与边界 |
|---|---|---|
| 文本 textarea | `drafts.updateDraft`；`onChange` 同时解析 `/` 和 `@` token；`onSelect` 更新 slash token | `Enter`（非 Shift/非 IME）发送；Shift+Enter 换行；readOnly/sending disabled；动态高度最多 200px |
| Enter/停止 | `useComposerSend.handleSend` → draft session 时 `sessions.createSession`，然后 `pi.prompt`; streaming 时发送 follow-up 或 `pi.stop`（Esc 也 stop） | compacting 禁发；无模型会打开 `settings.models`；error 留草稿并显示重试 |
| `+` 图片 | 隐藏 file input `image/* multiple`；FileReader base64 写 draft.images | 模型 `imageInput === false`、只读会话 disabled；Ctrl/Cmd+V 图片粘贴同一路径 |
| 图片缩略图/× | 单击 `setPreviewImage` 打开 `ImagePreviewOverlay`；× 从 draft.images 删除 | 预览浮层 Esc/关闭按钮收起 |
| 拖放区 | `dragover/dragleave/drop`；图片进 images；项目内文件转相对路径；项目外 `pi.importDroppedFile` 后写 attachments | 外部文件复制失败用 feedback；readOnly 直接 return；drop target 虚线 accent |
| `/` SlashMenu | `useSlashMenu` 过滤工作流/内置/skill/扩展；上下键移动、Enter 选择，Esc 恢复 token；pick 后胶囊或 `runSlashCommand` | 菜单外点关闭；specialized/advanced toggle；工作流 stage 选择；unsupported 项 disabled |
| `@` AtMenu | `useAtCompletion` 过滤项目文件/目录和子智能体；上下键/Enter 选择；文件变 attachments，agent 写 subagent draft | 未信任 agent disabled；needs_panel 将 `subagents.setDraftAgent` + `ui.openPanel("subagents")`；菜单可滚动跟随选中项 |
| 引用胶囊 | SelectionToolbar「添加到对话」写 `draft.quotes`；× 删除；空文本 Backspace/Esc 恢复 | 同文引用去重；引用在正文上方独占一行 |
| `/`、`@agent`、`@file` 胶囊 | × / Esc / 文首 Backspace 按近及远移除；子智能体移除时恢复 `@name ` 文本 | 通过 ResizeObserver 测量，空间不足改为上方独立行 |
| 模型 chip | `sessions.setCurrentModel(provider,id)`（按会话优先，通常持久设置并影响后续 prompt） | provider 分组，上弹菜单，外点/Esc 关闭，无配置显示 settings.providers.empty |
| 思考深度 chip | `sessions.setThinkingLevel(level)`，按模型支持级别过滤 | 当前模型不支持旧 level 时 clamp；菜单外点/Esc 关闭 |
| 权限 chip | `sessions.setSessionPermissionMode(sessionId, mode)`；fullAccess warn glyph；settings gate off 时 disabled + tooltip | default/strict/fullAccess 按会话隔离；只读会话视觉置灰 |
| ContextRing | 读 transcript/context-usage store，点击刷新或打开设置（具体行为在该组件） | 显示 token/上下文使用率；不改变消息文本 |
| QueueBar「取回」 | `send.handleRestoreQueue(focusTextarea)` 将首条 follow-up queue 放回草稿 | 只有 queue 非空显示；运行中仍允许排队 |
| SendErrorBar「重试」 | 重调用 `handleSend` | error 期间不丢 draft，toast/inline detail 告知 |

## 7. 聊天消息流与消息级行为

### 空态（`EmptyState`）和示例任务

- 空态把 `WordmarkConstruct`、居中 `Composer`、`ProjectBranchPicker` 组合在同一页面；没有真实会话时 Composer 的 draft key 是 `NEW_SESSION_DRAFT_KEY`。
- 任务页无内容时 `ExampleTaskCards` 以六个方向的 data-driven 卡片呈现；卡片只调用 `exampleTasks.open(id)`，不会创建任务或写文件。
- `ExampleTaskDialog` 的输入按任务定义生成：文本 input、select、文件/文件夹选择按钮分别更新本地 `values`；必填缺失在 launch/insert 时标红。`pickPath(file|directory)` 走 native IPC。
- 对话框按钮：复制 prompt → clipboard；取消/Esc → close；插入 → `drafts.updateDraft` + `COMPOSER_FOCUS_EVENT`；发起 → `ensureActiveSession`（必要时建会话）+ `pi.prompt`。只读/压缩/无 cwd 状态给 toast 或 disabled，不预先创建任务。

### `MessageList`

- `scroll` 监听决定 following；用户向上滚动释放跟随，回到底部恢复；流式/图片 ResizeObserver 在 following 时 pin bottom。
- 脱离跟随显示“回到底部”浮动按钮；点击 `pinToBottom(smooth/auto)`。
- `details/summary` 展开会暂停跟随，避免展开动画拉回底部。
- 每轮 `TurnFooter` 是文件、token、工具/响应统计的可操作摘要：文件 chip → `ui.setDiffFocus(sectionKey)` 打开过程/变更并定位文件；工具 chip → `ui.focusProcessTurn(turnIndex)` 打开过程泳道。

### 消息、工具、任务和子智能体控件

| 组件/控件 | 行为 |
|---|---|
| `CopyButton` | `navigator.clipboard.writeText(text)`；1.2 秒 Check 状态，失败静默 |
| `ForkButton` | 运行/压缩中 disabled；`sessions.forkSession({entryId/text})` 创建新 tab 并切换；只读会话隐藏 |
| `RecallButton` | `sessions.recallMessage({entryId/text/timestamp})`，后端回退到用户消息前并把 text/images 放回 draft；运行/压缩/只读 disabled |
| 用户/助手图片缩略图 | `ImagePreviewOverlay` 放大，overlay Esc/关闭按钮关闭 |
| 选中文字 Toolbar | `selectionchange/mouseup` 缓存 selection；“添加到对话”写 quotes 并广播 `COMPOSER_FOCUS_EVENT`；“在新会话继续”先 fork，再给新会话写 quote；只读隐藏、busy 时禁用 |
| `TaskRow` 继续 | `pi.prompt(sessionId, taskActionCommand(...,"progress"))`；busy/agentActive/no session disabled；显示错误 |
| `TaskDecisionCard` 完成/继续/结束 | `pi.prompt` 发送 acknowledge/“继续”/cancel 命令；三按钮受 task decision、busy、agentActive 门控；details 折叠 |
| `TaskArtifactLinks` / `MilestoneEvidence` / Markdown links | 跟随资源链接 `ui.openResourcePreview` 或外部资源处理；非法协议显示错误 |
| `ProcessBlock/MetaGroup/ToolCallCard` | 过程块/details 多为折叠纯展示；工具卡可跳 diff/resource；运行中状态由 transcript event bridge 驱动 |
| `ProcessBlock` 头部 | 运行中默认展开、结束自动收起；用户点击后锁定手动意图；`aria-expanded` 与 stage/tool/subagent 计数同步 |
| `TurnRouteCard` | 路线卡“导图/Map”与“全文/Details”两个 toggle；导图 lazy-load `RouteMindMap`，全文展示路线摘要/行；嵌入的 TaskDecisionCard 仍走同一 prompt 协议 |
| `SystemMessage` 压缩分界 | compaction done 有“摘要”按钮，点击展开/收起摘要；running/cancelled/error 是状态纯展示，error 使用 amber 提醒而不是 destructive red |
| `ToolCallCard` | 原生 `<details>` 摘要行展开完整 args/output；running 工具显示 shimmer/省略号，恢复摘要显示最多两行证据 |
| `ErrorNote` | `<details>` 展开错误详情；retry → `pi.retry(sessionId,cardId,lastUser.timestamp)` 并切回会话；compact → `pi.compact`；openSettings → `settings.openWith`；copyDetail → clipboard；retry 在 agent active/no prior user/recovery lock 时 disabled |
| `SubagentRunCard` | 展开/收起 transcript；reply 输入 Enter 或按钮 → `pi.replySubagentSupervisor`；guide 输入 Enter/按钮 → `pi.steerSubagent`；abort → store `abort`；view approval 广播 focus；done 可 cite（写 Composer 引用）、retry/redispatch（store `dispatch`） |
| `ModelWaitNote` | stop → `pi.stop(sessionId)`；等待模型期间显示中断入口 |
| `ErrorNote/RetryNote` | retry 按钮重试当前操作；错误文本与 remediation 保留 |

## 8. 右侧上下文面板

`ContextPanel` 固定宽度 372px，状态行显示 idle/working/done/attention；运行开始自动展开、结束恢复 idleOpen。页签按钮由 `visiblePanelTabs` 按本会话子智能体/计算条件动态生成。

### 页签和页签内 controls

| 页签/组件 | 控件和行为 | 数据源/副作用 |
|---|---|---|
| **任务 TasksPane** | `Process` 不在此；待审批提示为只读。TodoCard 进度纯展示；DecisionsSection `<details>` 展开，active 决策“撤销”、非 active “确认复核”，二者先打开 `AskDialog`，确认后 `pi.revoke/confirm`。TaskRow“继续”调用 `pi.prompt`。空态 ExampleTaskCards 打开 `ExampleTaskDialog`。 | `transcript.todos/messages/pendingPermissions`；projectId cwd → `pi.list(projectId)`；确认/撤销在 busy 时禁用 |
| **过程·泳道 ProcessPane** | `<select>` 切轮次；泳道节点的 `openTask/openReconcile` → `ui.openPanel("tasks")`；`details` 打开 receipts/paths/RunInspector。 | `deriveProcessLaneTurns`、inspectors、timings、usage 全从 transcript 投影；空态纯文本 |
| **过程·变更 ChangesPane** | BranchRow 下拉列出 git branches（只读，不切换）；“全部/最近一轮” segment；每个 `DiffFileCard` details 展开；文件/section chip 可跳 resource preview；插件 DiffSidebar region | `pi.listGitBranches(cwd)`；`ui.diffFocus/resourcePreview`; `deriveTurnChanges` |
| **产物 ArtifactsPane** | provenance 卡展开 `artifactProvenance`；“重跑”→`pi.rerunArtifact`，状态由 `onRerunUpdated` 事件更新；任务产物链接；“知识库”按钮 → `knowledge.open` | `pi.listArtifacts(cwd)` 仅 deliverable；sha256/attempts/环境/父链可审计 |
| **子智能体 SubagentsPane** | Available 刷新/打开 agent 目录；agent 行展开 tools/mcp/model/definition，Dispatch 填入表单；派发表单 agent/stage/cwd、选目录、follow-up/trust 勾选、添加任务、删除任务、requiredTools toggle、提交 dispatch、插入 Composer；运行筛选 active/all；run 卡 reply/guide/abort/view approval/cite/replay/retry/redispatch | `subagents` store `loadAgents/dispatch/abort/focusRun`；IPC `pi.pickDirectory/replySubagentSupervisor/steerSubagent`；校验 trust/tools/task，槽位/队列状态 |
| **计算 ComputePane** | refresh；host 行 probe/openTerminal/runExample/remove；新增 host alias/displayName/endpoint/user；job 点选、cancel；terminal 输入 Enter/send/close；日志加载；onboarding step check | `compute` store；远端 host/job/terminal IPC；workflow example 固定 `nf-core/rnaseq 3.18.0`，有 authState/状态色门控 |
| **插件页签** | 每个 plugin entry button；卸载后回退 tasks | PluginEntryHost |

## 9. 资源预览（`ResourceSidebar` 与 readers）

资源预览由消息链接、Diff chip 或知识产物打开，替换“过程·变更”内容；后退回 diff，右上角关闭面板。

- 头部：`返回变更` → `ui.showDiffSidebar`；标题；`打开外部` → `pi.openResourceExternal`；关闭 → `ui.setPanelOpen(false)`。
- 本地目标：effect → `pi.previewFile(target.href,target.cwd)`；Web URL 使用 sandboxed iframe；`obsidian/zotero/mailto` 等协议仅给外部打开按钮；非法链接提示。
- 文本工具栏：Preview/Source 切换；代码 viewer Wrap 开关；Copy 写系统剪贴板；复制失败 role=status。
- 图片工具栏：`zoom−/百分比/zoom+`（0.5–3 倍）；`FigureAnnotator` 进入标注、发 annotation/清空/删除；图片 decode 失败显示错误。
- 表格 reader：filter input（重置页码）、CSV/TSV 首行表头 checkbox、metadata details、上一页/下一页（每页 50 行）；sequence/tree/alignment reader 为 details/页码等只读导航。
- Markdown reader：内部链接 `onNavigate → openPreview`，外部/不支持协议显示 notice；HTML 预览在无脚本 CSP 文档中。

## 10. 权限、信任和询问弹窗

### ApprovalDock（权限审批）

审批卡与 Composer 同位互换。应答成功才调用 `transcript.resolvePermission` 移除请求；IPC 失败保留卡片和错误，防止 agent 永久等待但 UI 丢状态。

| 控件/快捷键 | API/状态 |
|---|---|
| 允许一次 / Enter | `pi.respondPermission(id,"allow")` |
| 拒绝 / Esc | `pi.respondPermission(id,"deny")` |
| 本项目总是允许 / A | `allowAlways` |
| 允许本次任务 / T | `allowRun` |
| 允许此目录 / D（有 suggestDir 才显示） | `allowDir` |
| 子智能体来源“查看该运行” | `ui.openPanel("subagents"); subagents.focusRun(runId)` |

### AskDialog

- 简单 yes/no 类 request：按 `orderedAskOptions` 直接按钮回答，危险选项 tone danger。
- 多问题 request：option 按钮单/多选、custom text input；`Cancel`、`Submit`。required 题未回答时 submit disabled；15 秒超时保留 error；连续 ask 清空 drafts、自动 focus 第一 input/button。
- 应答由 App `getPi().respondAsk(requestId,response)` 统一发送，成功才从 request 队列移除。

### TrustDialog

项目创建/切换前的 trust/deny 选项调用 App `getPi().respondTrust(requestId,index)`，队列保留数以 footer 告知；路径以可复制文本显示。

## 11. 事件与行为分类（升级时应逐项保留）

1. **导航**：`view/setView`, `knowledge.open`, `openPanel/setPanelTab`。
2. **会话生命周期**：draft → `createSession`; switch/reorder/rename/close; restore tabs; fork/recall。
3. **输入派发**：text/image/file/quote/slash/@; `prompt`, `stop`, queue restore; model/thinking/permission selection。
4. **运行控制**：approval answer, Ask/Trust answer, subagent dispatch/abort/steer/reply, compute submit/cancel/terminal。
5. **证据浏览**：diff focus, process turn focus, resource preview, artifact provenance/rerun, branch readout。
6. **视口与外设**：scroll following, wheel-to-horizontal, drag/drop, clipboard, native file picker, external opener, update/install。
7. **错误与恢复**：inline error + retry、toast、IPC fail 保留 pending、乐观更新回滚、非法资源协议 notice、失去 trust/permission 时禁用。

第 10 项升级应将每个行为记录成事件字典：`eventId / source surface / control label / keyboard equivalent / preconditions / store mutation / IPC method / optimistic state / success state / failure recovery / audit evidence`，并让日志只记录事件名、资源 id、耗时和状态码，不记录会话正文或 token。

## 12. UI 升级设计约束（供主计划引用）

- **科研观测三层**：工作台 rail（导航）→ 主区（论证/交互）→ 右栏（过程证据/审计）；同一事件只保留一个主控件，状态在对应层以 badge/色相/进度呈现。
- **证据优先级**：所有“继续、确认、重跑、外部打开”操作显示对象、来源、时间、版本/sha、可撤销性；复现结果与上次 artifact 以差异状态呈现。
- **语义色有限**：墨色=默认动作，accent=选中/研究对象，amber=需用户决策，green=完成/可复现，red=风险/失败；不要以颜色单独表达状态，配文字和 icon。
- **一致的控件契约**：按钮有 label/tooltip/disabled reason；下拉、弹窗、details 都支持 Escape、焦点回收、键盘等价；列表项 hover 动作提供可发现但不改变布局的操作层。
- **密度分档**：默认 760px 阅读列、右栏 372px 证据列保留；高密度表格/日志采用可折叠 metadata 和虚拟滚动；输入和审批维持大目标区（≥44 CSS px 交互目标）。
- **可追溯状态机**：draft、queued、running、waiting、done、error、superseded 是共享状态 token；按钮根据状态机决定 `visible/disabled/loading/retry`，避免“点击无反应”。
- **科学工作流模板**：输入（问题/数据/假设）→方法（模型/工具/参数）→执行（轮次/资源/权限）→证据（变更/产物/sha）→复核（decision/provenance）→结论（引用/导出）；将 Task/Process/Artifacts 页签映射到方法、执行、证据三段。

## 13. 当前视觉基线（升级前需保持的契约）

- **壳尺寸与层级**：rail 56px；聊天阅读列 max-width 760px；右栏展开宽度 `min(372px,36vw)`；顶栏 44px；z-index 语义层为 content 10 / float 20 / dropdown 30 / dialog 40 / dialog-top 50 / toast 60。
- **颜色 token**：浅色 canvas/surface 都接近白，hover `#f4f4f5`，ink `#18181b`，accent 紫 `#7c3aed`；深色通过 `[data-theme="dark"]` 同名变量切换。error/warn/info/ok 只用于 severity 或状态 glyph，普通文本走 ink token。
- **字体密度**：壳说明明确采用 13/12/11px 三档；面板卡片 12px，辅助信息 11px；长文本使用 `truncate/break-words/overflow-wrap:anywhere`。
- **形状和动效**：卡片圆角 12px + `shadow-soft`；浮层 12px + `shadow-pop`；对话框 16px + `shadow-dialog`；rail/button hover 0.15–0.16s；面板展开、审批进入/退出、selection pop、tab drag 都有动效，`prefers-reduced-motion` 时必须停用。
- **交互状态**：active tab 使用 accent 下划线/rail 左竖线；working/attention/done 使用 violet/amber/green 状态点；disabled 以 opacity 与明确原因配套；只读子会话使用 accent 头像。
- **可访问性基线**：按钮均 `type=button`；关键面板使用 `role=tablist/tab`、`aria-selected`、`aria-expanded`、`role=dialog`、`role=progressbar`；tooltip 统一 `Tooltip`；弹窗和 dropdown 需要外点/Esc 关闭。升级保持这些语义并补齐缺少的可见 focus ring、`aria-label` 和焦点回收。

### 科研风格升级落点

1. 将当前中性黑白壳保留为“实验室底板”，把紫色 accent 收敛成“当前研究对象”，新增可主题化的证据色阶（输入/方法/执行/证据/复核/结论），每个色阶同时有短标签和图标。
2. 在 ContextPanel 的每个卡片头显示 `状态 · 来源 · 时间` 三元组；把任务/过程/产物的按钮文案统一为动词 + 对象，例如“重跑该产物”“查看第 3 轮变更”，避免同一行为在消息、面板、弹窗中使用不同词。
3. 对 Composer/Approval 保留大目标区，在模型、思考、权限 chip 上增加可展开的“方法条件”摘要（provider、level、mode、是否继承），让研究设置可复核。
4. 对 Diff/Resource/Artifact 统一“证据阅读器”工具栏：对象标题、格式、版本/sha、预览模式、外部打开、复制/标注；将 zoom、wrap、filter、page 等局部工具变成同一 Toolbar token。
5. 用状态机驱动颜色、文案、按钮可用性和动画，所有异步动作显示 `queued/running/succeeded/failed/retry`；将失败操作保留为可重试 action，避免 toast 成为唯一证据。
