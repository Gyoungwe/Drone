# 修改单 · 连接 / 技能 / 设置收敛（2026-10-19）

> 来源：Claude 实机验收（同目录 `README.md`）和用户确认。交给 GPT 执行。
> 规则沿用 `docs/pluginization-ui-handoff.md` §2：
> - 每个 CO 一个 PR，合并前必须通过 `npm run lint && npm run typecheck && npm run test:unit && npm run check:arch && npm run build`；
> - 新增文案要同时写进 `i18n/zh.ts` 和 `en.ts`；
> - **不新增确认流程或抽象层，不改已落盘的数据格式**；
> - 每个 PR 都要附上与本目录截图对应的改前和改后截图（1440×900，浅色和深色两种主题）。
>
> 路径前缀 `R = packages/desktop/src/renderer/src`

## 执行顺序
CO-1 → CO-2 → CO-3 → CO-4。CO-3 依赖 CO-2 里的右侧抽屉。

---

## CO-1 · 精简 Zotero（去掉 Zotero MCP）

**目的：** 只保留 Drone 内置的 Zotero 接入（本机 API `127.0.0.1:23119`、connector 端点、Web API）。去掉第三方 `zotero-mcp-server` 这条重复的接入路径，同时消除"开关开着、却探测到 0 个工具"的矛盾状态（截图 17）。

**改动：**
1. `R/components/knowledge/ZoteroPanel.tsx`
   - 删除"从零接入"区块（`setupTitle`、`setupHint`、`setupSteps`、`setupButton`、`openDocs` 等，也就是安装 zotero-mcp-server 的一键入口）。
   - "接入状态"压缩成一行，只保留 `Zotero 桌面端 · 本机 API · 当前写入方式` 三个状态点；去掉"MCP 已登记"和"MCP 已启用"两项。
   - 根据检测到的 Zotero 版本，只展示一种写入方式：
     - 10 及以上：展示 `ZoteroLocalWriteSection`；
     - 9 及以下或无法判断：展示 `ZoteroWebApiSection`；
     - 另一种折叠到"旧版 Zotero / 高级"里。
   - `InstitutionalAccessSection` 从 Zotero 面板里移走，放到 CO-3 的连接器抽屉中。
   - "与知识库的关系"这一整块压缩成一行提示。
2. `R/components/knowledge/zotero-copy.ts`：删掉不再使用的文案键（中英文都删）。
3. `packages/backend/src/zotero/status.ts`：`registered` 和 `enabled` 改为可选字段，或者从 UI 的输出里去掉。**不要删除或修改用户 `~/.pi/agent/mcp.json` 里已有的 zotero 条目。**
4. 「技能与连接 → MCP」：如果用户之前已经登记过 zotero MCP，照常显示成一个普通的 MCP 条目，按真实探测结果显示状态。探测到 0 个工具时显示"不可用 · 查看原因"，**不能显示为已启用**。

**验收：**
- Zotero 设置只剩"状态一行 + 一种写入方式（另一种折叠）"。
- 在装有 Zotero 10 的机器上，内置的 `research_zotero_status` 返回本机 API 可达，并且新建条目能被回读到，整个过程不依赖 MCP。
- 页面上不再出现"开关为开、0 个工具"的组合。

---

## CO-2 · 技能、插件、MCP 按来源分组

**目的：** 解决同一个包带来的多个技能平铺、显得冗余的问题（截图 16）。

**依据：** 后端已经提供了每个技能的来源信息：`packages/backend/src/services/session-resources.ts:80` 里有 `skill.sourceInfo.source` 和 `scope`，扩展也有同样的字段（:93）。**这一项不需要新增后端字段。**

**改动：**
1. `R/components/workbench/SkillsConnectionsView.tsx`
   - 行数据增加 `source` 字段（取自 `sourceInfo.source`），按 `source` 分组渲染。组的标题规则：
     - `npm:@gyoungwe/*` 显示为"<包名>（Drone 插件）"；
     - `~/.agents/skills` 和其他 user 来源显示为"个人技能 · <路径的最后一段>"；
     - project 来源显示为"本项目 · <相对路径>"；
     - 内置的显示为"内置"。
   - 组这一行显示：技能数量、汇总状态（全部可用 / N 个需处理）、整组的启用或禁用开关。默认折叠；如果组里有需要处理的条目，就默认展开。
   - **同名去重**：同一个技能名出现在多个来源时只显示一行，标注"另有 N 个来源"，展开后列出每个来源，并标明实际生效的是哪一个（按 Pi 的加载顺序判断）。
   - 插件包（例如 `@gyoungwe/research-suite`、`pi-knowledge`）作为父组，它带来的技能和工具挂在下面。**同时修复报告 P1-7**：Drone 自己的能力插件要出现在"插件"分类里，显示版本和宿主（原生 Pi / Desktop）。
2. 整组禁用复用现有的单项禁用逻辑，逐个禁用组内的技能，**不新增配置格式**。

**验收：**
- 截图 16 那种平铺列表变成按来源折叠的若干组；`research-workflow` 只出现一次，并标注"另有 1 个来源"。
- 禁用一个技能组后，在新会话里这些技能不可调用：`/skill:<名称>` 返回不可用的回执，并且 SKILL-01 的反证测试通过。
- 「插件」分类能看到 pi-core、pi-knowledge、pi-research 和 desktop-ui-pack。

---

## CO-3 · 设置入口统一（页面管能力和数据，设置只管偏好）

**目的：** 解决设置入口多、同一件事在页面和设置里各有一个家的问题。

**目标归属：**

| 内容 | 统一放在 | 从设置弹窗删掉的页签 |
|---|---|---|
| 技能、MCP、插件、扩展、UI 插件、Zotero、连接器、机构访问 | 「技能与连接」页，点某一行在右侧抽屉里配置 | 工具与技能、MCP、扩展、UI 插件、Zotero |
| SSH 主机、计算环境 | 「主机」页 | SSH 主机 |
| 当前 Vault（显示路径，带切换和新建按钮）、WebDAV、维护任务、工作流总览 | 「知识库」页新增"知识库设置"页签 | 知识库维护、工作流总览 |
| 通用、外观、模型、权限、关于 | 设置弹窗（只剩这 5 项） | — |

**改动：**
1. `R/components/settings/SettingsDialog.tsx`：页签列表只保留 `general`、`appearance`、`models`、`permissions`、`about`。旧的页签 id 改为兼容跳转：调用 `openSettings("mcp" | "skills" | "extensions" | "uiPlugins" | "zotero" | "knowledge" | "workflows" | "sshHosts")` 时，跳到对应页面并打开对应的抽屉或页签。兼容跳转保留一个版本。
2. `R/components/workbench/SkillsConnectionsView.tsx`：行操作里的 `openSettings(...)`（约 :254、:289、:403）改为打开**页面内的右侧抽屉**。抽屉复用现有的 `McpPanel`、`SkillsPanel`、`settings/extensions/*`、`UiPluginsSection` 和 CO-1 精简后的 `ZoteroPanel`，**组件直接搬过来，不重写**。
3. 「知识库」页（`R/components/knowledge/KnowledgeHome.tsx` / `KnowledgeView.tsx`）新增"知识库设置"页签：
   - 当前 Vault 一行，显示路径和作用范围，带"切换"和"新建"按钮。这两个按钮直接调用宿主接口完成，**确认一次就生效，不走 agent 任务计划**（修复报告 P1-6 和 P1-8）。
   - 确认文案只写一个作用范围，并且和实际行为一致（修复报告 P1-7 的矛盾文案）。
   - 下方放 WebDAV、维护任务和工作流总览，复用现有的 `KnowledgePanel` 和 `WorkflowOverview`。
4. 「主机」页并入原设置里 SSH 主机的登记表单。
5. `R/components/workbench/WorkbenchNav.tsx` 的头像菜单只保留"设置、帮助、关于"，去掉单独的"扩展"项（`nav.extensions`）。
6. 菜单栏的 Drone → 设置… 和头像菜单打开的是同一个弹窗（检查 main 进程的菜单是否也走 `openSettings`）。
7. 输入框的模型选择（`Composer.tsx` :512、:676）和子智能体面板（`SubagentsPane.tsx` :529）的深链接不变。

**验收：**
- 设置弹窗只剩 5 个页签；全仓库 `openSettings(` 的调用只指向这 5 个 id，或者经过兼容跳转。
- 从「技能与连接」的任意一行进入配置，都不会弹出设置弹窗。
- 在「知识库 → 知识库设置」里切换到一个测试 Vault，再切回来，各确认一次，全程在 10 秒内完成；`README.md` 里截图 05–08、19 描述的流程不再出现。
- 头像菜单里没有"扩展"项。

---

## CO-4 · 收尾
- 更新 `docs/final-pluginization-plan.md` 的 §3.10：写清"页面管能力，设置管偏好"这条规则，以及技能按来源分组的规则。
- 在本目录 `README.md` 的结果表后面，追加 CO-1 到 CO-3 的改前和改后截图对照。
- 版本号放在这一组改动完成后统一升级，不要每个 PR 单独升。
