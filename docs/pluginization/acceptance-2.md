# 插件化 v2 验收（第 2 轮）

> **历史验收记录**：本轮 B1–B3 问题已由 acceptance-3 和后续 C0–C2 合并验收取代；保留原始失败和修复过程，不代表当前 `main` 或公开包状态。

验收方：Claude　日期：2026-10-21
被验收对象：两个仓库的**当前工作树**（未提交改动）
- Drone：分支 `codex/pluginize-v2-p2`，HEAD `fbb7d7d2` + 工作树改动
- drone-plugins：分支 `codex/pluginize-v2-p2`，HEAD `cdff35e` + 工作树改动

本轮未推送、未合并、未提交。

## 总结论：FAIL

第 1 轮提出的 8 项「必须修」中，7 项已修好；正式 Vault 上的真实自动维护（限 2 项）按预期运行，没有改写正文。但本轮新引入了 1 处类型错误和 2 个后端测试回归，交付流程上也还有缺口（锁文件未更新、没有证据文件、提交的扩展打包文件过期），因此不能通过。

| 项 | 结果 |
|---|---|
| A1 维护提示词包含笔记正文 | PASS |
| A2 免费检查来自 worker 图谱，未知 kind 直接失败 | PASS |
| A3 真实 worker 索引测试 | PASS |
| A4 模型选择和运行明细界面 | PASS |
| A5 删除 Drone 中重复的知识扩展 | PASS（源码）；交付时打包产物过期，见 B3 |
| A6 recentByCategory、ui-state 持久化测试 | PASS |
| A7 干净 checkout 下 typecheck 的执行顺序 | 顺序已修好，但 typecheck 仍然 **FAIL**（新类型错误，见 B1） |
| R1 正式 Vault 真实运行（N=2） | PASS |
| B1 新类型错误 | **FAIL** |
| B2 后端测试回归（知识 UI 事件不再到达后端） | **FAIL** |
| B3 交付完整性（锁文件、打包产物、证据文件） | **FAIL** |

## 复核方法

1. 在设备上把两个工作树中**已跟踪 + 未忽略的未跟踪文件**打成压缩包（`git ls-files -co --exclude-standard`，不含 `node_modules`、`dist`、`.local`），解到云端干净目录，从零 `npm ci` 后运行检查。
2. 宿主通过 `DRONE_PLUGINS_DIR` 指向同一份插件工作树：`plugins.lock.json` 仍锁在旧提交 `cdff35e`（见 B3），按锁文件构建得到的是未修复的插件。
3. 真机：用户按要求重新构建（`build:extensions -- --force` → `build` → `electron-builder --dir`）后，打开 `packages/desktop/dist/mac-arm64/Drone.app`。打包中的知识 worker 哈希 `0ba27405…` 与插件工作树一致；`app.asar` 中包含新的维护代码（`Note body (first 4000`、`unknown-maintenance-kind`、`readGraph`、`maintenanceModel` 均能检索到）。

## 检查结果

### 插件仓库（干净副本）

| 命令 | 结果 |
|---|---|
| `npm ci --ignore-scripts` | rc=0 |
| `npm run check` | rc=0 |
| `npm test -w @gyoungwe/pi-knowledge` | rc=0，39 个文件 / 330 条 |
| 重新构建的产物与工作树中的对比 | `dist/index.mjs`、`worker.mjs`、worker manifest、`build-manifest.json` 的 sha256 完全一致 |

### 宿主仓库（干净副本，`DRONE_PLUGINS_DIR` 指向插件副本，按计划顺序执行）

| 命令 | 结果 |
|---|---|
| `npm ci` | rc=0 |
| `npm run lint` | rc=0 |
| `npm run typecheck`（在 build 之前） | **rc=2**：`packages/backend/src/create-backend.ts(589,15): error TS2314: Generic type 'Model<TApi>' requires 1 type argument(s).` 不再出现第 1 轮的 `@gyoungwe/plugin-api/knowledge` 找不到模块的错误，说明 `pretypecheck` 先构建 plugin-api 的改法有效 |
| `npm test` | **rc=1**：backend 有 2 个新失败（见 B2）；desktop 的 `filter-contributions.test.ts` 失败是因为云端环境没装上 Electron 二进制，与本次改动无关 |
| `npm run check:arch` | rc=0 |
| `npm run build` | rc=0 |
| `npm run check:extensions -- --strict`（按交付时的工作树） | **失败**：全部扩展都报 "changed since …mjs"，即提交的 `.pi/extensions/*.mjs` 比源码旧（见 B3） |

## 逐项核对

**A1 PASS。** `run.ts` 把 `note.markdown` 传给 `maintenancePrompt`；提示词包含 `Note body (first 4000 characters)`，「来源变化」类另附 `Current source body`。`parseMaintenanceJson` 能去掉 \`\`\`json 代码块。孤立 / 未被引用这两类只要求返回已有的链接目标，不再生成整页 markdown。集成测试断言假模型收到的提示词中包含笔记正文。

**A2 PASS。** `planMaintenance(_status, graph, settings)` 自己根据 worker 图谱计算缺主题（`looksLikeFileName`）、来源变化、孤立、未被引用；宿主改为 `readGraph → sessions.knowledge.graph({limit:5000, view:"all"})`，不再读 `index.problems`。`runMaintenance` 遇到未知 kind 时直接抛出 `unknown-maintenance-kind`。

**A3 PASS。** `test/maintenance.integration.test.ts`：在临时目录写 20 篇笔记，由真实 worker `reconcile` 建索引 → 读取图谱 → 规划 → 运行（假模型），断言规划出 20 个缺主题项、提示词含正文、Vault 发生对应写入。

**A4 PASS（真机）。** 设置页「自动维护」有模型下拉（默认「使用默认模型」）、每次项数、每日上限、立即运行；「最近一次」可以展开逐项明细（kind · 状态 · 打开）。小问题：明细里只显示 kind 和状态，不显示是哪篇笔记，要点「打开」才知道，建议显示标题。

**A5 PASS（源码）。** `packages/extensions/src/internal/knowledge-extension.ts` 已删除，`packages/extensions/src/knowledge-extension.ts` 只剩 17 行，转调 `@gyoungwe/pi-knowledge/host`。但交付时 `.pi/extensions/knowledge-extension.mjs` 没有重新生成，直接打包会带上旧代码；用户按要求重新构建后才包含新代码（见 B3）。

**A6 PASS。** 新增 `test/recent-by-category.test.ts`、`test/ui-state.test.ts`，以及抽出的 `src/core/recent-by-category.ts`，均在 330 条测试中通过。

**A7** 见上：执行顺序已修好，但存在 B1。

## R1 正式 Vault 真实运行（N=2）

- Vault：`~/Documents/ObsidianResearchVault`（App 显示已绑定，100 篇笔记，项目上下文 px-dhx16）。没有使用 Dronevault。
- 运行前：对 Vault 做完整副本，并为 109 个文件记录 sha256（`Drone/.local/acc2/vault-before/`、`vault-before.sha256`，`.local` 已被 gitignore）；Wiki 审阅队列为 0；维护记录为 0 次。
- 设置：`{"enabled": true, "maxItems": 2, "dailyLimit": 20, "model": null}`（null 表示使用现有的默认配置模型）。
- 运行：点击「立即运行」一次；开始于 `2026-10-21T11:24:03Z`。
- 运行记录（metadata）：

| 候选路径 | kind | 状态 |
|---|---|---|
| `Library/Papers/2106-09685v2-pdf-e9a0d3128767db61.md` | missing-topic | topic-updated |
| `Library/Papers/2210-03629v3-pdf-f285b0971ae4a790.md` | missing-topic | topic-updated |

  `processed=2`，`modelCalls=2`，没有跳过项，没有异常。

- 运行后立即关闭，设置回读为 `enabled: false`（运行记录 1 条）。
- Vault 变更（sha256 对比）：只有 4 个文件被修改，没有新增或删除文件。

| 文件 | frontmatter | 标题 | 其余正文 |
|---|---|---|---|
| `Library/Papers/2106-09685v2-pdf-e9a0d3128767db61.md` | 只新增 `topic` | 原文件名标题被替换 | 不变 |
| `Library/Papers/2210-03629v3-pdf-f285b0971ae4a790.md` | 只新增 `topic` | 原文件名标题被替换 | 不变 |
| `Projects/dronevault/Papers/2106-09685v2-pdf-e9a0d3128767db61.md`（镜像） | 新建只含 `topic` 的 frontmatter | 原文件名标题被替换 | 不变（逐行比对：唯一的改动块是「旧标题 → frontmatter + 空行 + 新标题」） |
| `Projects/research-workbench/Papers/2210-03629v3-pdf-f285b0971ae4a790.md`（镜像） | 同上 | 同上 | 同上 |

  被替换的 4 个旧标题都符合文件名规则；新主题长度分别为 25 和 29 个字符（不超过 40）。本报告不记录主题和正文内容。
- 没有产生 Wiki 候选（两项都是缺主题类），审阅队列不变。
- **Vault binding revision 未记录**：binding 和索引 revision 保存在应用状态目录（`~/Library/Application Support/Drone`），该目录受系统保护，无法授权读取。这里用文件哈希 diff 作为变更证据。
- 结论：符合「只允许直接写 topic 和自动标题」的边界，**PASS**。没有触发停止条件，所以没有恢复文件；如需撤销，可以用 `.local/acc2/vault-before/` 中对应的 4 个文件覆盖回去。

## 未解决问题（必须修）

### B1 新类型错误
`packages/backend/src/create-backend.ts:589` 声明 `let model: Model | undefined`，缺少泛型参数，`npm run typecheck` 失败。改为与 `runtime.getModel` 返回值一致的类型（例如 `ReturnType<typeof runtime.getModel>`，或者 `Model<any>`）。

### B2 回归：知识 UI 事件到不了后端（严重）
本轮从 `ui-state.ts` 删除了跨模块副本的 `UI_EVENT` 转发。问题在于：Pi 扩展 bundle（`knowledge-extension.mjs`）和 backend 主进程 bundle 各自打包了一份 `@gyoungwe/pi-knowledge/host`；扩展那份通过 `@drone/tasks` 的 runtimeSlot 存状态，backend 那份没有配置 slot provider，用的是模块内私有的 `slots`。两份状态互不相通，原来唯一的桥就是这条进程事件。删掉以后：

- `test/knowledge-specialists-sdk.test.mjs`：`flowFor(session.sessionId)` 返回 `null`（`TypeError: Cannot read properties of null (reading 'specialists')`）；
- `test/knowledge-publication-delivery.test.mjs`：`open-review` 通知数期望 3，实际 0。

这两个测试是真实 SDK 测试，不调用模型，第 1 轮全部通过。对用户的影响：对话中的知识流程卡片和打开审阅等实时界面收不到事件。

**说明：** 这项删除是按我在计划第 0 节第 6 条和第 1 轮报告 P2-3 中的要求做的，我当时判断「现在 worker 和扩展都来自同一个插件包，已无必要」，这个判断是错的：同一个包被打成了两个 bundle，仍然是两份模块副本。修法二选一：
1. 恢复 `UI_EVENT` 转发，并把注释改成准确的原因（两个 bundle）；
2. 让 backend 在启动时用与扩展相同的 runtimeSlot provider 配置知识宿主（`configureKnowledgeHost`），使两份副本共用同一状态；然后删掉转发。

无论哪种，上述 2 个测试都必须通过，再补一条测试：在 backend 那份副本订阅，从扩展那份副本发事件，断言能收到。

### B3 交付完整性
- `plugins.lock.json` 仍锁在 `cdff35e`。按默认流程（不设 `DRONE_PLUGINS_DIR`）构建，会打进**未修复**的插件。插件改动提交后要更新 commit 和 `tarballSha256`。
- 交付时工作树里的 `.pi/extensions/*.mjs` 比源码旧，`check:extensions -- --strict` 失败；用户这次重新构建时已经重新生成（工作树中这些文件现在显示为已修改），需要随本轮一起提交。
- 没有 `docs/pluginization/P5-fixes-evidence.md`；两个仓库的修复都还是未提交状态。

## 建议（不阻塞）
- 运行明细中显示笔记标题，而不只是 kind 和状态。
- 孤立 / 未被引用类目前会生成一个**新的** `Wiki/<标题>.md` 候选页，内容是链接列表；计划原意是「给已有页面加一条链接」的审阅候选。这次真实运行没有走到这一路径（两项都是缺主题），下轮请补一个此类候选的真实或集成测试，并确认候选内容的形态。
- `source-changed` 依赖 `note.sourceText`，而 `knowledge.read` 目前不返回这个字段，提示词会退回使用笔记正文；需要接上真正的来源读取。

## 下一轮交付要求
1. 修复 B1、B2；B2 按上面的说明修，并补跨副本事件测试。
2. 提交两个仓库，包括重新生成的 `.pi/extensions`；更新 `plugins.lock.json`。
3. 在**不设 `DRONE_PLUGINS_DIR`** 的干净 checkout 上按 `npm ci → fetch:plugins → lint → typecheck → test → check:arch → build → check:extensions -- --strict` 跑一遍，结果写入 `docs/pluginization/P5-fixes-evidence.md`。
4. 推送分支后告诉用户「P5 完成，请 Claude 验收」。本轮的真实 Vault 运行结果可以沿用，第 3 轮只需复核 B1–B3。
