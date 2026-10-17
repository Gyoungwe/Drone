# Drone 插件化 + 前端重做 · 交接文档（给 GPT / Codex）

> 日期：2026-10-17。交接方：Claude（评审 + 设计）。执行方：GPT。
> **唯一权威计划**：`docs/final-pluginization-plan.md`。本文只负责告诉你先读什么、按什么顺序做、做到什么程度算完成。如果本文和计划冲突，以计划文首的「2026-10-17 评审决议」为准。

---

## 0. 开工前先读（按顺序）

1. `docs/final-pluginization-plan.md`
   - 文首「评审决议」
   - §3.8 / §3.8.1：包结构与代码映射
   - §3.9：两道闸门
   - §3.10：前端结构
   - §9.1：PR 执行清单
   - §10：红线
2. `docs/INDEX.md` 的「硬约束」一节：
   - renderer 不能 import pi 包；
   - Pi SDK 运行时只能在 `packages/backend/src/session-engine/**` 中 import；
   - 新增 IPC 要按约定同步；
   - i18n 中英文字典都要改；
   - zustand selector 必须返回稳定引用；
   - JSON 持久化一律走 JsonStore。
3. 设计稿 HTML：用户已下载，**放到 `docs/design/plugin-ui/`**（如果不在这里，先问用户放在哪）。在线版：https://claude.ai/artifact/RLTGyvjkAHsf8HN8bwDwek
   - 用户在画布上对 `Main.dc.html` 手改过一处，**以下载下来的 HTML 为准**，不要以本文描述为准。
4. 与插件仓库骨架 `../drone-plugins` 对照：它已经有多包 workspace、manifest 检查和 package smoke 骨架。**不要再建第二套。** 计划里写的"新建"在这里都理解为"补齐这个现有骨架"。

## 1. 已定决策（不要重新讨论）

| # | 决策 |
|---|---|
| D1 | 第一个插件是 **`pi-knowledge`**，同时用它推进主线「知识闭环」 |
| D2 | 插件源码最终放在 **`drone-plugins` 仓库**。先在 `drone/packages/pi-knowledge` 里通过外部安装 smoke 和 `MEM-01`，再用 `git subtree split` 迁过去 |
| D3 | 前端**按设计稿重做**，不受原计划"保持视觉不变"的限制 |
| D4 | 一级导航只有 **新任务 · 知识库 · 技能与连接 · 主机**，下面接「项目」「最近」两个分组；设置、扩展、帮助、关于收进头像菜单 |
| D5 | 右栏页签改为 **总览 / 文件 / 变更 / 主机**，"运行"和"证据"不再做一级入口 |
| D6 | 发版的硬门槛只有 `MCP-01`、`MEM-01`、`REDLINE-01` 三项；Pi 只测 `1.1.0`（每个 PR）和 `latest`（每周） |
| D7 | 不新增 `.drone/` 目录，不改已有落盘格式；能力协商 v1 只区分 `compatible` 和 `incompatible` 两种结果 |
| D8 | npm scope 还没定：`@drone` 是否归我们需要核实，否则改用 `@gyoungwe/`。**在 PR-5 发布前问用户**，之前统一用 `@drone/` 占位 |

## 2. 工作方式

- 每一步开一个分支、提一个 PR。上一个合并后再开下一个；不要在同一个 PR 里混入结构调整和行为改动。
- 每个 PR 合并前必须全部通过：
  ```sh
  npm ci && npm run lint && npm run typecheck && npm run test:unit && npm run check:arch && npm run build
  ```
  涉及扩展时再加 `npm run check:extensions`；涉及插件 API 时再加 `npm run check:plugin-api`。
- `.pi/**` 是生成产物，不要手改；改了源码之后用 `npm run build:extensions`、`build:knowledge` 或 `build:tasks` 重新生成。
- **不要加安全门、确认流程或抽象层**，除非计划里明确要求。用户明确不想要层层设防的改动。
- 版本号只在一组功能完成后再改（根目录和 `packages/desktop` 的 `package.json` 两处同步改）。版本号合入 main 会自动触发发布。
- 每完成一个 PR，在计划末尾的「执行日志」表里追加一行，写清日期、PR、关键数字和遗留问题。
- 遇到需要用户拍板的事（scope、删除数据、改变行为），**停下来问**，不要自己决定。

## 3. 执行顺序

插件化和前端两条线可以交替推进。下面的序号是推荐顺序，括号里是对应的计划章节。

| 顺序 | PR | 内容 | 完成标准 |
|---|---|---|---|
| 1 | PR-1 | 文档校准（§9.1）：清理 LAN 残留；在 `docs/INDEX.md` 加计划和本文的入口 | `git grep -n -i -E '\blan\b' -- packages/*/src docs/INDEX.md` 没有输出 |
| 2 | PR-2 | `scripts/check-native-pi.mjs`（§9.1） | 输出和 §3.8.1 的映射一致；有单测 |
| 3 | UI-1 | Token 与外壳（见 §4） | 浅色主题下主区是浮卡；`refine.css` 已删除 |
| 4 | UI-2 | 侧栏与一级导航 | 对照设计稿 `Sidebar.dc.html` |
| 5 | PR-3 | `pi-knowledge` 包 + `smoke-pi-package` 脚本 + CI job（§9.1） | Linux 和 macOS 上 smoke 都通过；产物里不出现 electron 或 backend 的 import |
| 6 | UI-3 | 右栏：总览 / 文件 / 变更 / 主机 | 对照设计稿 `Main.dc.html` 的右侧 |
| 7 | PR-4 | 原生 Pi 知识闭环 + 检索瘦身（§9.1） | 固定问题集里，同类问题第二次问时不联网 |
| 8 | UI-4 | 对话流与输入框 | 对照设计稿 `Main.dc.html` 的左侧 |
| 9 | UI-5 | 「技能与连接」页 + 能力状态 | 对照设计稿 `Skills.dc.html`；状态来自真实数据 |
| 10 | UI-6 | 知识库页 | 对照设计稿 `Knowledge.dc.html` |
| 11 | UI-7 | 首页 | 对照设计稿 `Home.dc.html` |
| 12 | PR-5 | 迁移 `pi-knowledge` 到已绑定的 `../drone-plugins` + 发布 `plugin-api`（§9.1） | 先问用户 npm scope（D8） |
| 13 | PR-6 | `pi-core`（§9.1） | 原生 Pi 能完成授权流程和回执 |
| 14 | PR-7 | `pi-research` + `research-suite`（§3.8 的 `bundleDependencies` 写法） | 全新环境只装 Pi 和 suite，就能完成一个最小研究任务 |
| 15 | 发版 | 一次性发布 v0.33.0；release notes 附设计稿前后对比截图 | `MCP-01`、`MEM-01`、`REDLINE-01` 三项都有真实证据 |

## 4. 前端：设计稿 → 代码 的映射

renderer 根目录：`packages/desktop/src/renderer/src/`。

### UI-1 · Token 与外壳
- 修改 `styles/globals.css`。设计稿只用到中性灰阶，以下是设计稿里的值和要对应的 token：

  | 设计稿颜色 | 用途 | 对应 token |
  |---|---|---|
  | `#fafafa` | 侧栏和外层背景 | `--sidebar` |
  | `#ffffff` | 主卡 | `--color-surface` |
  | `#0a0a0a` | 主文字 | `--color-ink` |
  | `#404040` | 次要文字 | `--color-ink-2` |
  | `#737373` | 弱文字 | `--color-ink-dim` |
  | `#e5e5e5`、`#ececec`、`#f0f0f0` | 边框 | `--color-border` 系列 |
  | `#ebebeb` | 选中态 | `--highlight` |
  | `#2563eb` | 只用于链接、运行指示点和焦点环 | — |

  状态色：
  - 琥珀：`#a3540a` 文字、`#f1c48b` 描边、`#fff8ee` 底色
  - 红：`#b42318` 文字、`#f4b4ae` 描边、`#fef3f2` 底色
  - 绿：`#059669`

- 主区做成浮卡：外层留 8px 间距，`border-radius: 24px`，加一圈 1px 边框和极轻的阴影。浅色和深色主题都这样做。
- 删除 `styles/refine.css`，把其中的规则合并回 `shell.css` 或对应组件。
- 字体：用 Inter，插画卡标题用 Noto Serif SC；数字一律 `tabular-nums`。
- 选中态一律用灰阶 `--highlight`，**不用强调色**。参考 `drone-clawsgo-ui-parity-plan.md` 的 U1，它的第 1–8 条仍然有效。

### UI-2 · 侧栏（`components/workbench/WorkbenchNav.tsx`）
- 从上到下：空间切换 → 四个一级入口（新任务 ⌘N / 知识库 / 技能与连接（需处理时显示琥珀色计数）/ 主机（显示主机数））→「项目」→「最近」→ 底部头像菜单。
- 「最近」每项占两行：第一行是状态点加标题；第二行是状态文字，比如"运行中 · 第 4/6 步"，或琥珀色的"等待你在浏览器里登录"。
- 原来的研究入口、扩展、设置、帮助按钮全部收进头像菜单或者合并掉。旧入口保留一个版本的兼容跳转。

### UI-3 · 右栏（`components/panel/*`、`stores/ui.ts`）
- `stores/ui.ts` 当前是 `CorePanelTab = "tasks" | "process" | "artifacts" | "subagents" | "compute"`。
- **id 不要改名**（持久化和测试都依赖它们），只改显示和归组：
  - `tasks` 显示为「总览」
  - 新增 `files` 和 `changes`（`ChangesPane.tsx` 已经存在）
  - `compute` 显示为「主机」
  - `process`、`artifacts`、`subagents` 不再单独成页签，内容并进总览的各节
  - 同步更新 `visiblePanelTabs` 的测试
- 总览从上到下各节：
  - 用量：`ContextUsageMeter` +「压缩上下文」按钮
  - 步骤：显示 n/N，底部有「详细视图」开关，打开后才显示原来的 ProcessLane
  - 交付物：`DeliveryCards`
  - 子智能体：有运行中的才显示
  - 证据：`EvidencePane`，有内容才显示，"来源过期"用琥珀色徽标，并带「重新读取」按钮
  - 审稿 / 决策：有待处理项才显示

### UI-4 · 对话流与输入框（`components/chat/*`、`components/composer/*`）
- 助手消息：头部显示模型名和回答模式；下面一行汇总"运行 Xs · N 个步骤"，可折叠；步骤行左侧有一条细竖线，每步右侧显示耗时或结果摘要，进行中的步骤用灰底加蓝点。
- 引用 chip 显示为「作者 年份」样式（`#eef2ff` 底、`#3730a3` 字）；证据等级文字用琥珀色（例如"有证据支持，尚未验证"）。
- 输入框：
  - 顶部是 `ComposerStatusBar` 和 `RunStatusStrip` 合并成的一条：主机 · 项目 · 分配方式 + 右侧计划进度；
  - 底栏只放四样东西：`＋`、「模型 · 强度」胶囊、`ContextRing`、发送 / 停止；
  - `PermissionPicker` 和 `RunConfigPicker` 收进胶囊的二级菜单；
  - 首页额外显示一个「学术回答」模式胶囊（`ModePicker`）。
- 用户消息：靠右，浅灰气泡，圆角 16px。

### UI-5 · 技能与连接（新页面，复用 `components/settings/*` 里的 MCP、技能、Zotero、WebDAV、机构访问面板）
- 页面头部：标题 + 一句说明 +「检查全部」（描边胶囊）+「添加」（黑色胶囊）。
- 分类页签：全部 / 插件 / 连接器 / MCP / 技能，右侧放琥珀色的「只看需要处理的 · N」。
- 每一行四列：名称、版本和说明 | 宿主或读写范围 | 状态 | 操作按钮。
- **状态必须来自真实探测**，比如 MCP 连接状态、凭据是否存在、宿主版本是否匹配，**不能只看开关的位置**。七种状态的样式见计划 §3.10 的表格，或设计稿。
- 插件行要显示所在宿主（原生 Pi / Desktop）。宿主不兼容时，写清楚"需要 X，当前是 Y；未加载任何工具"。

### UI-6 · 知识库（`components/knowledge/KnowledgeHome.tsx`、`KnowledgeView.tsx`）
- 布局：大搜索框（⌘K）+ 分类页签（全部 / 文献 / 软件 / 方法 / 想法，带计数）+ 左栏「最近沉淀」+ 右栏「待处理修改」和「健康检查」。
- 「最近沉淀」每行要显示类型、标题，以及"来自任务「…」"。
- 「健康检查」第一项是**"同类问题由本地回答 X / Y"**，这是知识闭环的验收指标，数据从 trace 统计。如果统计还没做，先显示"—"，不能写假数字。
- 网络图（`KnowledgeGraph` / `KnowledgeNebula`）放在头部按钮后面，不放在首屏。维护类功能（`KnowledgeMaintenance`、`SemanticManagement`、`TopicManagement`）移到设置的高级区。

### UI-7 · 首页（`components/panel/EmptyState.tsx`、`FirstRunGuide.tsx`）
- 内容：衬线体问候语 + 一句介绍 + 三张插画卡（研究 / 知识库 / 接力）+ 居中的输入框。
- 卡片上的数字要读真实数据（笔记数、本周沉淀数、待处理数、上一个未完成的任务）。
- 还没配置模型或 Vault 时，卡片直接显示配置入口，替代原来的 `FirstRunGuide`。
- 插画是简单的线描 SVG，可以直接从设计稿 HTML 里复制。

### 前端通用规则
- 每个 UI PR 都附上与设计稿对应画面的前后对比截图，浅色和深色两种主题都要。截图用 `scripts/cdp-shot.mjs`，窗口固定 1440×900。
- 新增文案要同时写进 `i18n/zh.ts` 和 `en.ts`。
- 设计稿里的假数据，比如"scVI 与 Harmony""105 篇笔记"，**不要写进代码**，一律从真实状态读取。
- 不能用颜色单独表达状态：每个状态点旁边都要有文字。
- 支持减少动效：用户开启"减少动态效果"时，关闭微光和脉冲动画。

## 5. 插件化的关键技术提醒

- **Pi 不会自动加载依赖包里的资源**：聚合包必须用 `bundleDependencies`，并在 `pi.extensions` / `pi.skills` 中写出 `./node_modules/<包>/...` 路径（见计划 §3.8）。`@earendil-works/pi-*` 只能写在 `peerDependencies` 里。
- 原生 Pi 目前**加载不到任务运行时**：`.pi/settings.json` 里没有它，而且 `packages/backend/src/tools` 里有 25 个工具只在 Desktop 中注入。`pi-core` 的主要工作量就在这里（PR-6）。哪些工具留在 Desktop，见计划 §3.8.1。
- `pi --print` 之类的 headless 参数**要先在 Pi 1.1.0 上确认**，再写进 smoke 脚本。
- `pi-knowledge` 在没有绑定 Vault 时，所有工具都返回 `unconfigured` 并提示 `/drone-init`，**不能伪装成已经启用**。
- 新增架构规则 R8：插件包的 dist 中禁止出现 `electron`、`@drone/backend`、`@drone/desktop`，以及任何 `../../` 开头的 import。把它加进 `scripts/check-architecture.mjs`，用 ratchet 基线管理。

## 6. 完成时交给用户的东西

- 每个 PR 的链接，以及执行日志里对应的那一行。
- 前端：对照设计稿四个画面的前后截图（浅色和深色）。
- 插件：`smoke-pi-package` 的输出；在原生 Pi 里跑一次知识闭环的 trace（第二次提问没有联网调用）。
- 状态不确定的项，如实标成 `BLOCKED` 或 `NOT_RUN`，**不能写成已完成**。
