# 插件化 v2 验收（第 1 轮）

验收方：Claude　日期：2026-10-21
被验收提交：Drone `fbb7d7d2`、drone-plugins `cdff35e`（分支均为 `codex/pluginize-v2-p2`）

## 结论

**不合并。** P1 通过；P2、P3 有条件通过（要补的项见下）；**P4 不通过**：自动维护在真实知识库上基本不起作用，现有测试也测不出这个问题。修完下列「必须修」各项后重新提交，我再验收第 2 轮。

## 我做了什么

- 在云端干净环境从 GitHub 重新克隆两个分支，`npm ci` 后重跑各项检查（不依赖你本机已有的构建产物）。
- 逐项核对证据文件、计划 §0 规则、§6 回归清单和 AGENTS.md「编码尺度」。
- 真机：打开 `dist/mac-arm64` 中的 App（其 worker 哈希 `eae35e78…` 与 P3 证据一致），检查知识库加载、分类标签和自动维护面板。**没有用正式知识库运行自动维护**：需要用户同意，而且按下面 P4-1、P4-2 的问题，现在运行也找不到真正要处理的项。

## 复核结果

| 检查 | 结果 |
|---|---|
| 插件仓库 `npm run check`（干净克隆） | 通过 |
| pi-knowledge 测试 | 通过，36 个文件 / 325 条 |
| pi-knowledge typecheck、smoke | 通过；原生 Pi 注册 19 个工具，与迁移前相比没有减少 |
| 源码历史 | 保留；`git log --follow` 能追到迁移前的提交 |
| 插件代码跨仓库相对路径、引用 backend/desktop/electron、测试中的真实 Vault 路径 | 未发现 |
| 宿主 `fetch:plugins` | 通过；从 GitHub 按锁定提交重新构建，得到的哈希与锁定值 `4b8275c9…` 完全一致 |
| 宿主 `check:knowledge-runtime`、`lint`、`check:arch`、`build` | 通过 |
| 宿主 `typecheck`（干净 checkout，按计划顺序在 build 之前跑） | **失败**：8 处找不到 `@gyoungwe/plugin-api/knowledge`；先 build 再跑就通过（见 P1-1） |
| 宿主 `npm test` | 806 条通过；唯一失败的套件是我这边没下载 Electron 二进制造成的，与改动无关 |
| 真机：知识库加载、分类标签计数、自动维护面板 | 正常；面板默认关闭，每次 5 项、每日 20 次 |

## 必须修

### P4-1 模型看不到笔记内容（严重）
`src/maintenance/run.ts` 先调用 `readNote` 读出了笔记，但传给 `maintenancePrompt` 的只有 `path`、`title`、`detail`，`note.markdown` 没有进提示词。后果：
- 补主题时，模型只能根据文件名（如 `PMC7022188.1.pdf`）来猜主题；
- 生成 Wiki 候选时，模型没看过正文，候选内容等于凭空编造。

要求：
- 提示词带上笔记正文的前 4000 字（计划 §5.1）；「来源变化」类还要带上来源的当前内容。
- 孤立笔记、未被引用的 Wiki 这两类，要求模型输出的是**建议的双链**（目标页 + 理由），不是整页 markdown；宿主校验目标页存在后，生成「加一条链接」的审阅候选。
- 模型返回被 \`\`\`json 代码块包住的 JSON 也要能解析（这是常见的模型输出格式，不算过度防御）。

### P4-2 没有实现「免费检查」，候选来源是错的（严重）
宿主 `knowledge-maintenance.ts` 用 `overview.index.problems` 作为维护候选。这张表是 worker 的**索引错误表**（只有 `path` 和 `message` 两列，没有 `kind`），不是孤立笔记、缺主题之类的清单。`planMaintenance` 又把所有未知 `kind` 一律当成 `orphan`。后果：
- 真实知识库里一个「缺主题」项都找不到（健康检查里明明显示了几十个）；
- 偶尔出现的索引错误会被当成孤立笔记交给模型处理。

要求：
- 按计划 §5.1 实现免费检查：孤立笔记、缺主题（`looksLikeFileName`）、没被引用的 Wiki、来源哈希变化。可以复用 worker 的图数据或宿主前端 `graph-model.ts` 里已有的 `graphHealth` 判定，但要放进插件：`planMaintenance(graph, status, settings)` 自己算，不再由宿主传候选进来。
- 去掉「未知 kind 当 orphan」的映射；未知类型就是程序错误，直接抛出。

### P4-3 测试没覆盖真实数据形状
「20 篇笔记假模型验收」直接塞入人工构造的、已经标好 `kind: "missing-topic"` 的 `problems`，所以没测到 P4-2 的问题。

要求：用一个**真实的临时 Vault 目录**（夹具里写 ≥20 个 .md 文件，含文件名标题、孤立笔记、互相链接的页面），经 worker 建索引 → `planMaintenance` → `runMaintenance`（假模型，并断言假模型收到的提示词里包含笔记正文）→ 核对 Vault 实际变化和审阅队列。

### P4-4 界面缺模型选择
计划 §5.2 要求面板有模型选择（沿用现有的模型选择组件）。现在没有，要补上；运行记录要能逐项展开，点开对应笔记或审阅项。

### P1-1 干净 checkout 下 typecheck 依赖 build 的产物
`@drone/shared` 现在依赖 `@gyoungwe/plugin-api/knowledge` 的 `dist`，而 `npm run typecheck` 不会先构建 plugin-api。要求：typecheck 能在干净 checkout 上直接通过（让 typecheck 前先构建 plugin-api，或者改为引用源码的类型路径），并在证据里给出干净 checkout 下按计划顺序跑 `lint → typecheck → test → build` 的输出。

### P2-1 知识扩展主体在两个仓库各有一份
`Drone/packages/extensions/src/internal/knowledge-extension.ts`（1590 行）和插件里的 `src/extension/internal-knowledge-extension.ts`（1594 行）只差 14 行。桌面版用的是 Drone 那份，于是改知识轮次逻辑（例如问题点名 Wiki 页时自动先查本地知识）仍然要改 Drone，这正是这次插件化要消除的情况。

要求：只保留插件里的那份。宿主需要的运行时能力（任务运行时、Obsidian 组合根等）通过 plugin-api 的 HostPort 注入；Drone 的 `knowledge-extension.ts` 只保留一个薄入口，负责组装 HostPort、调用插件。若本轮做不完，至少删掉 Drone 那份副本，改为从 `@gyoungwe/pi-knowledge/host` 导入，并在偏离记录里写明还剩哪些 HostPort 没做。

### P2-2 计划 §6 要求补的两条回归测试没有补
- worker `recentByCategory`（首页分类标签过滤最近沉淀）
- 本地回答指标持久化（`ui-state`）

插件测试里搜不到这两项，要补上。

### P2-3 编码尺度第 6 条没有执行
计划点名要删的跨模块副本兼容代码（`ui-state.ts` 的 `UI_EVENT` 跨副本转发、指标文件「取较大值」合并）还在。现在 worker 和扩展都来自同一个插件包，这些已经没有必要了，应当删掉。证据里也没有按要求列出删了哪些防御代码。

## 建议修（不阻塞）

- **P3-1** App 里打包了 `knowledge-plugin.mjs`，但没有任何地方加载它，只做了哈希校验。要么删掉，要么在 P2-1 完成后改为由它承担入口。
- **P4-5** P4 证据里有两条互相矛盾的描述（「维护测试共 5 项」和「共 6 项」），请更正。
- **P4-6** `modelCalls++` 放在模型调用之前，模型报错也会计入当日预算。计划的意思是「报错不计为已处理」；预算是否计入请明确，并补一条测试。

## 下一轮交付要求

1. 按上面「必须修」逐条修改，每条在 `docs/pluginization/P5-fixes-evidence.md` 里写明：改了哪些文件、对应的测试名称、命令输出。
2. 在**干净 checkout** 上按 `npm ci → fetch:plugins → lint → typecheck → test → build` 的顺序跑一遍，贴出结果。
3. 更新 `plugins.lock.json` 到新的插件提交，推送两个仓库的分支，然后告诉用户「P5 完成，请 Claude 验收」。
