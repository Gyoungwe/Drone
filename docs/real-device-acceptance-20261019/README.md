# Drone 实机验收报告 · 2026-10-19

- 设备：用户 MacBook（arm64，macOS 27.2），**正式安装版 Drone 0.33.4**（截图 00 为 0.33.3 改前证据）
- 模型：Gemini 3.8 Flash（Antigravity），使用用户本机已配置的 API
- 测试 Vault：`/Users/gaoyangwei/Drone-TestVault-1019`（测试后保留未删）；测试结束已切回 `ObsidianResearchVault`（截图 19）
- 执行者：Claude，通过电脑操作完成；截图都在 `screenshots/` 目录下
- 本轮发布验收范围：**仅 macOS arm64/x64 正式安装包**；Windows 构建、上传和回下载不属于当前版本门禁。
- 结论：**主线知识闭环在真机上跑通**（第一次联网并沉淀，第二次新会话 18 秒内只用本地知识回答）；macOS 正式安装包门禁已通过。

## 结果总表

| 项 | 结果 | 证据 |
|---|---|---|
| V1 正式包启动、首页、侧栏 | PASS（视觉偏差见 P2） | 00–02 |
| V2 知识闭环：第一次联网并沉淀 | PASS（流程过重，见 P1） | 09–12 |
| V2 知识闭环：第二次新会话本地回答 | **PASS**：18 秒、3 次工具调用，全部是本地知识工具 | 13–14 |
| V3 知识库页：审阅与网络图 | PASS：网络图正常加载，开发版的 worker 报错没有再出现 | 03–04 |
| V3 知识库页：数据联动 | FAIL：新沉淀的笔记不显示，本地回答率显示"—" | 15 |
| V4 MCP 开关 | **BLOCKED**：唯一的 MCP（Zotero）需要配置，探测到 0 个工具，没有可调用对象 | 17 |
| V5 原生 Pi | NOT_RUN（本轮只测桌面端） | — |
| V6 与设计稿对照 | 部分符合，偏差见 P2 | 02、06a、09a |

## P0（发布阻断）

1. **v0.33.2 的 macOS 安装包装上后启动即崩溃**（0.33.3 已发布替代，需要确认根因已修）。崩溃报告是 `Library not loaded: @rpath/Electron Framework.framework/Electron Framework`。装好的 `Drone.app` 里，`Electron Framework.framework` 缺少顶层符号链接 `Electron Framework` 和 `Resources`（`Helpers`、`Libraries`、`Versions/Current` 都在）；同一版本的 zip 包里这 5 个符号链接都齐全。dmg 的末尾结构（`koly`）不在文件最后 512 字节内，挂载也失败过。
   - 修复：在发布 CI 中加一道检查，把 dmg 挂载起来，`codesign --verify --deep` 并检查 framework 的符号链接是否齐全，然后真正启动一次 `Contents/MacOS/Drone --version`。zip 包也做同样的检查。

## P1（功能问题，影响主线）

2. **"最近沉淀"不显示新沉淀的笔记**（截图 15）：`SpCas9_PAM.md` 已经写进测试 Vault，已索引数也变成了 10，但列表显示"还没有保存记录"。
3. **"同类问题由本地回答"始终显示"—"**（截图 15）：第二轮明明是一次纯本地回答，却没有被统计。交接文档第 3 项在正式包里没有生效。
4. **证据门禁误报**（截图 12）：回答里列了 Jinek 2012 等 5 篇原始论文和 DOI，底部却提示"没有引用具体的原始论文，主要依据是 Wiki"。
5. **简单问题流程过重**（截图 09、10、12）：一个事实问题要先确认任务计划、再授权写入，两轮确认；耗时 4 分 33 秒，调用工具 34 次，消耗 **103 万 token**。事实类问答应该走"检索 → 回答 → 自动沉淀"的轻量路径，不需要任务计划和授权。
6. **建测试 Vault 需要确认两次，耗时 3 分 16 秒**（截图 06–08）；第二张确认卡里，"作用范围：整个 Drone"和"仅当前项目标识留在项目配置中"互相矛盾。设置里也**没有切换 Vault 的入口**（截图 05）。
7. **「技能与连接 → 插件」里看不到 Drone 自己的能力插件**（截图 18）：pi-core、pi-knowledge、pi-research、desktop-ui-pack 都没有列出，只有 3 个 UI 小插件。内置的"语音提醒"显示"宿主不兼容"（截图 16）。
8. **左侧"最近"列表不更新**：本轮新建的 4 个会话一个都没出现在侧栏"最近"里（截图 15、18）。

## P2（界面与设计稿的偏差、体验问题）

9. 首页的研究卡是黑底、接力卡是亮蓝底（截图 02），设计稿是浅色插画卡加中性灰阶；首页还多出了项目、最近会话、工作环境三块，和侧栏内容重复；首页右栏不应默认展开。
10. 运行中右栏停在"主机"页签，没有自动切到"总览"（截图 06a）。
11. 新会话的右栏仍然显示上一个会话的文件预览（截图 20）。
12. 顶部标签栏溢出，新标签被压到 14 像素宽（截图 09a），需要做溢出折叠。
13. 回答头部显示"运行 18s · 0 步"，但实际调用了 3 次工具（截图 14）。
14. 知识库四个分类的计数都是"—"，最近沉淀全部标成"Wiki · 来源任务未记录"（截图 03）；日期是英文格式（Oct 4, 2026），和中文界面不一致。
15. 菜单栏"关于"显示的是 `About @drone/desktop`，应改为 Drone（截图 00 对应的菜单）。
16. 侧栏把"项目"放在"新任务"之上，设计稿是新任务在第一位。
17. Zotero MCP 状态是"需要配置"，开关却是打开的，并显示"已探测 0 个工具"（截图 17）。

## 建议修复顺序
P0-1 → P1-5（轻量问答路径，直接省 token）→ P1-2、P1-3、P1-4（主线指标和证据门禁）→ P1-7、P1-8 → P2 统一一个 UI PR。每个修复都附上和本报告对应截图的前后对比。

## 2026-10-19 下一轮修复记录

本轮代码修复已覆盖以下报告项；最终 PASS 仍须以真实启动的安装包验收为准：

| 报告项 | 当前状态 | 实现/证据 |
|---|---|---|
| P0-1 安装包 framework 与启动校验 | **macOS PASS** | `scripts/check-release-artifacts.mjs` 检查 DMG/ZIP 中的 Electron Framework 符号链接、unsigned/codesign 状态和 `Contents/MacOS/Drone --version`；macOS arm64/x64 均完成本机挂载、干净目录安装与真实启动检查。Windows 不在本版本验收范围。 |
| P1-2 最近沉淀为空 | **代码已修** | worker 在 UI 查询前冲刷已知 dirty batch；`knowledge-ui.test.mjs` 覆盖“写入后 watcher 尚未回调”的最近笔记回读 |
| P1-3 本地回答率为“—” | **代码已修** | `KnowledgeFlow` 记录真实检索命中回合，overview 使用进程内累计值；回归测试覆盖无当前会话时仍能显示累计指标 |
| P1-4 DOI 证据误报 | **代码已修** | evidence gate 只对本回合读回的 DOI receipt 认定原始论文，不再把目录路径当作论文证据；`literature-evidence.test.mjs` 通过 |
| P1-5 简单问题流程过重 | **提示策略已修，待实机确认** | research loop 的宿主提示明确要求简单本地事实走“检索→回答→有界沉淀”轻路径，不创建 task plan 或额外写入授权 |
| P1-7 插件列表缺少 Pi 能力包 | **代码已修，待正式包确认** | Skills/Connections 会把当前会话加载的 Pi extensions 与 UI plugins 一起列出；不新增第二个开关 |
| P1-8 最近会话不刷新 | **代码已修** | 新建、从历史打开、分叉会话后刷新 ProjectsStore；仍需安装包交互确认 |
| P2-10/11/12/13/15/16 | **代码已修** | 运行开始切回总览并清除旧文件预览；新会话清除资源预览；tab 设最小宽度；回答头使用整轮真实工具数；原生菜单显式使用 Drone；侧栏把新任务置于项目之前 |
| P2-14 知识库计数/日期/来源 | **代码已修** | index 返回全量分类计数，最近项来自真实 note/wiki 索引，日期按界面语言格式化 |
| 知识网络重新 UI | **PASS** | 新安装包真实知识库页显示“研究知识观测台·关系与来源”、节点/链接/孤立统计、浅色画布和响应式控件；现场 AX/截图已看到网络正常渲染 |

## 2026-10-19 本轮收口

| 报告项 | 当前状态 | 真实证据 |
|---|---|---|
| P1-6 Vault 设置与切换 | **PASS** | 新安装的 `/Applications/Drone.app` 真实界面显示“切换或创建知识库”、应用级共享与 Projects 分区说明；启动流程只保留一张写入确认卡，入口和文案已更新 |
| P2-9 首页视觉层级 | **PASS** | 新安装包真实首页显示浅色中性三张入口卡，移除项目/最近/环境重复摘要，右栏默认收起；新任务位于项目之前 |
| P2-17 Zotero 开关语义 | **PASS** | 新安装包真实“技能与连接”显示 Zotero 为“运行中”，设置页开关仅在注册且本机 API 可达时为启用；不可达分支显示“已注册但不可用”并锁定开关 |
| P0 正式安装包 | **PASS** | v0.33.3 无证书 arm64/x64 DMG/ZIP 均通过本机版本、payload、framework symlink、`Drone --version` 和真实启动检查；Release workflow `39222533359` 又从已发布 Release 回下载 macOS DMG/ZIP、blockmap、`latest-mac.yml` 并重复校验通过 |

B8 云端协作继续按计划暂缓，Protocols.io 继续只读。Windows 构建/上传/回下载按本轮范围标记为 `OUT_OF_SCOPE`；签名检查按无证书策略为 `NOT_RUN`，不构成失败。

本轮离线回归：knowledge 307/307、backend knowledge UI + literature 32/32、desktop 定向 16/16；完整 `npm test` 通过（backend 227/1877、desktop 149/766、knowledge 32/307 及其余 workspace），`npm run lint`、`npm run typecheck`、`npm run build`、`npm run check:arch` 均通过。Lint 仅保留设计稿 HTML 超过 1 MiB 的既有 warning；这些结果不能替代正式安装包实机验收。

## 修改单 CO-1～CO-4 当前收口

本节记录修改单相对于本报告截图的收口状态。截图 00–20 是改前证据；`docs/releases/visual/` 下的文件是构建 renderer 的静态预览，不能替代正式安装包截图，因此没有把它们标成最终 PASS。

| 修改单 | 改动 | 当前状态 | 证据与剩余门槛 |
|---|---|---|---|
| CO-1 精简 Zotero | 内置本机 API/Web API 写入路径；状态压成一行；按版本选择写入方式；机构访问移到连接器抽屉；历史 Zotero MCP 条目仍由用户配置保留 | **正式包界面 PASS；写入闭环沿用既有 Zotero 临时 note 验收** | `ZoteroPanel.tsx`、`zotero-copy.ts`、`backend/src/zotero/status.ts`；v0.33.4 实机回读显示“本机写入已授权 / 运行中”，没有把 MCP 的 0 工具误报为启用 |
| CO-2 技能/插件/MCP 按来源分组 | 技能按仓库映射或 loader 来源分组；同名技能去重并展开来源；Pi 能力包出现在插件分类；MCP failed 显示错误状态；整组开关通过会话 IPC 更新技能可见性；科研技能显示 GitHub 仓库、分支和路径；页面提供仓库级来源卡片和用户手动检查/更新入口 | **正式包 PASS** | v0.33.4 安装包真实回读显示 Nature、Scientific、Academic 三个 GitHub 仓库卡片、加载/内置计数和手动检查/更新入口；完整性校验、staging、原子清单切换和失败回滚仍由 updater 负责，产品不展示内部锁定 commit。`SkillsConnectionsView.tsx`、`CapabilityRuntime`、`setSkillNamesEnabled`、`research-skill-sources.json` |
| CO-3 设置入口统一 | 设置弹窗只保留通用、外观、模型、权限、关于；能力进入技能与连接右抽屉；Vault/WebDAV/维护进入知识库设置；主机进入主机页 | **正式包界面 PASS** | `SettingsDialog.tsx`、`KnowledgeView.tsx`、`KnowledgePanel.tsx`、`WorkbenchNav.tsx`；v0.33.4 CUA 回读设置只显示五项，账户菜单只保留设置/帮助/关于 |
| CO-4 文档与视觉对照 | 计划 §3.10 已补页面/设置边界和来源分组规则；执行日志已归档到不超过 30 行 | **浅色正式包四视图 PASS；深色前后对照 NOT_RUN** | 改前截图为 `screenshots/00–20`；正式包 CUA 证据和门禁摘要见 `v0.33.4-p4-ui-acceptance.json`；静态预览仍仅作开发参考 |

## 2026-10-20 P4 市场栏与正式包验收

本轮正式构建仍按无证书 macOS arm64/x64 范围执行。完整证据见 [`v0.33.4-p4-ui-acceptance.json`](../releases/v0.33.4-p4-ui-acceptance.json)。

| P4 门槛 | 状态 | 正式包证据 |
|---|---|---|
| 四栏真实视觉 | **PASS** | 同一安装包真实回读“新任务 / 知识库 / 技能与连接 / 主机”；技能与连接内为“市场 / 连接器 / MCP / 技能”四栏 |
| 市场栏 | **PASS** | Pi 官方 extension 目录、Drone 插件仓库、MCP 官方参考仓库、社区 MCP 目录和 Skill 开源仓库入口均可见 |
| Drone 插件元数据 | **PASS** | 未安装状态也显示 `@gyoungwe/*` registry 版本和描述 |
| 连接器描述与开关 | **PASS** | 真实包显示每个连接器的用途描述；Crossref 实测关闭→恢复 |
| SSH 主机选择器 | **PASS** | 最新 unsigned macOS arm64 包读取本机 `~/.ssh/config`，展示 8 个可选 Host 别名，并将 `drone-gaoxuze-c` 加入主机卡片；没有读取私钥正文 |
| Skill 手动检查 | **PASS** | 用户点击检查后真实发现 2 个研究技能包更新 |
| UI 插件热重载 | **PASS** | desktop-ui-pack 实测停用→启用，Research status contribution 回读仍在 |
| MCP 真实运行状态 | **NOT_RUN** | 隔离正式包未配置 MCP server，界面如实显示无能力；没有把空配置标成 PASS |
| 构建后安装包检查 | **PASS** | macOS arm64/x64 DMG/ZIP、payload、framework、启动探针和严格静态资源检查均通过 |

本轮仍不改变 B8 暂缓、Protocols.io 只读、无证书和 macOS-only 发布范围。视觉回读以正式包 CUA 证据为准，静态 renderer 预览不替代实机证据。

## 2026-10-20 修改单验收返修

代码返修已覆盖 `change-order-verification/README.md` 的 7 项问题。合入 `main` 后的 v0.33.4 Release workflow（run [`39369532749`](https://github.com/Gyoungwe/Drone/actions/runs/39369532749)）已完成 macOS arm64/x64 构建、上传后回下载和真实启动探针；下载资产的完整回读证据见 [`v0.33.4-asset-validation.json`](../releases/v0.33.4-asset-validation.json)。

| 问题 | 代码状态 | 定向证据 | 正式包状态 |
|---|---|---|---|
| 技能页空配置一直 loading | **PASS** | draft/no-session 通过 `listSlashCommandsForCwd` 投影 LoadedSkill，带 5 秒超时和空态；settings 回归通过 | v0.33.4 下载包真实启动探针通过 |
| Drone 内置插件显示未安装 | **PASS** | `pi-core`、`pi-knowledge`、`pi-research` 标记为内置，市场行和已安装列表显示“内置 · 已启用”，无安装按钮 | v0.33.4 下载包真实启动探针通过 |
| Zotero/WebDAV 重复 | **PASS** | WebDAV 移出能力页；Zotero descriptor 与状态合并为唯一行，读开关与写入抽屉分离 | v0.33.4 下载包真实启动探针通过 |
| Zotero `{version}` 占位符 | **PASS** | `formatZoteroText` 插值回归覆盖 `10.0.6` | v0.33.4 下载包真实启动探针通过 |
| 知识库页签/网络图空状态 | **PASS** | 单层“总览 / 网络图 / 审阅 / 设置”；未绑定时显示原因、关联已有/新建和开发版隔离提示 | v0.33.4 下载包真实启动探针通过 |
| 侧栏项目/最近分组 | **PASS** | 一级入口保持四项；项目、最近分组在无数据时也显示空态，真实会话排序逻辑保留 | v0.33.4 下载包真实启动探针通过 |

CO-2 的来源仓库“添加任意 Git URL/本地目录”以及热插拔 worker 回滚仍是计划 backlog，本修改单未扩大范围。B8、Protocols.io 和无证书策略不变。

## 仍未关闭的实机门槛

| 门槛 | 状态 | 关闭条件 |
|---|---|---|
| P1-2 / P1-3 / P1-4 | **代码已修；行为仍需真实知识闭环** | 正式包 smoke 已通过 preload/知识 IPC；仍需真实安装包写入后回读最近沉淀、显示本地回答率、对本回合 DOI 证据不误报 |
| P1-5 | **提示策略已修，待真实会话** | 在正式包中用简单事实问题走检索→回答→有界沉淀，确认不创建任务计划和额外写入授权 |
| P1-7 | **PASS（v0.33.4 正式包）** | Skills/Connections 的市场与已安装插件区真实显示 `pi-core`、`pi-knowledge`、`pi-research`、`pi-analysis`、`pi-evidence`、`pi-connectors`、`desktop-ui-pack`、`research-suite` 的版本/说明和宿主状态；证据见 `v0.33.4-p4-ui-acceptance.json` |
| P1-8 | **PARTIAL** | 正式包已看到最近列表，但新建、历史打开和分叉后三种刷新路径尚未全部在同一次安装包会话中回读 |
| 市场生命周期 | **PARTIAL（registry 安装/卸载 PASS）** | 真实 registry `@gyoungwe/pi-core@0.1.5` 安装、`/drone-doctor`、模型会话和卸载通过；本地 tarball lifecycle 通过。Pi CLI update 返回成功但 managed 目录仍旧版本，官方第三方 extension 仍 NOT_RUN |
| Skill 仓库管理 | **PASS（代码与隔离 FS 回归）** | 任意 Git URL/本地目录、ref/subpath/许可依据、哈希 staging、原子应用、失败保留和来源卸载已落地；桌面定向测试 3/3 通过。正式 Electron GUI 交互截图仍受环境限制 |
| 热插拔 worker / 回滚 | **PASS（worker 回归/打包资源）** | worker 排空、失败候选回滚、生命周期事件和生成扩展专家回归通过；证据见 `v0.33.5-plugin-gates.json`。交互式 Electron GUI 仍未运行 |
| V4 MCP | **PASS（native stdio fixture）** | 原生 Pi 1.1.0 安装 `pi-mcp-adapter@5.1.0`，真实调用 `mcp__echo` 返回 `echo:native-mcp-acceptance`，卸载后清理通过；外部用户配置的 MCP 仍 NOT_RUN |
| V5 原生 Pi | **PASS** | 真实 registry `@gyoungwe/pi-core@0.1.5` 在 Pi 1.1.0 独立 HOME 中安装；`/drone-doctor` 解析宿主 1.1.0 并 PASS，真实模型会话返回 `NATIVE_PI_REGISTRY_OK`，卸载通过 |
| V6 CO-1～CO-4 视觉对照 | **PASS（built renderer）** | 深色四视图 headless 对照 `drone-visual-comparison-dark.json` 4/4 PASS；交互式 Electron 截图仍受环境限制，不把它写成 GUI 实机 PASS |

除上述门槛外，B8 云端协作仍按计划暂缓，Protocols.io 仍保持只读；两者不在本轮补做范围内。

## 技能来源与更新验收说明

改前界面把 Pi loader 的 `local`、`auto` 直接当作来源，无法回答“这个技能来自哪个仓库”。v0.33.4 将内置科研技能名映射到 `packages/shared/src/research-skill-sources.json`：界面显示上游 GitHub 仓库、分支和路径，仓库卡片显示加载数和内置数；未进入目录映射的本地技能仍显示其真实 loader 来源。更新检查只在用户点击后运行，GitHub API 受 403/429 限流时回退到公开 Atom commit feed；更新按钮复用归档哈希/文件哈希校验、版本化 staging、原子清单切换和安全重启，不会静默替换清单，失败时恢复当前版本。v0.33.4 正式包已回读来源卡片和宿主插件清单；仅静态 renderer 预览不算最终证据。
