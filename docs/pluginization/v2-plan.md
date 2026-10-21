# Drone 插件化 v2：知识能力迁出 + 自动维护（执行计划）

> 执行方：GPT（Codex）。验收方：Claude。本文是唯一任务说明，执行中如需偏离，先在本文末尾「偏离记录」写明原因再动手。

## 0. 基线与总规则

| 仓库 | 基线 commit | 工作分支 |
|---|---|---|
| `Gyoungwe/Drone`（宿主） | 代码 `0dedc3ab`；从其后的文档提交 `docs: pluginization v2 plan and coding scale` 拉分支 | `pluginize/v2` |
| `Gyoungwe/drone-plugins`（插件） | 代码 `5cd915e`；从其后的文档提交 `docs: coding scale for agents` 拉分支 | `pluginize/v2` |

规则：

1. 两个仓库都从基线拉 `pluginize/v2` 分支工作，**不要直接推 main**；每个阶段结束推一次分支，并写验收证据（见 §7）。验收通过后由 Claude 合并。
2. 每阶段一个或几个提交，提交信息用 `feat(pluginize): P<n> ...` 前缀，便于逐阶段验收。
3. 禁止：跨仓库相对路径引用（`../drone/...`）；插件 import `@drone/backend`、`@drone/desktop`、`electron`；提交 `.local/`、Vault 内容、凭据、`results/`、会话正文。
4. 测试不得调用真实模型、不得读写用户 Vault（`~/Documents/ObsidianResearchVault`、`~/Documents/Dronevault`）；一律用临时目录 + 假模型。
5. 功能零回退：基线已有的行为（见 §6 回归清单）在每个阶段后都必须仍然通过。
6. 编码尺度遵守两个仓库 `AGENTS.md` 的「编码尺度：不要过度防御」。迁移代码时，搬过去的代码里碰到的空 `catch`、为"另一个模块副本 / 旧 worker"写的兼容分支（如 `ui-state.ts` 的跨副本事件转发、指标文件"取较大值"合并），在新结构下已无必要的要删掉，并在阶段证据里列出删了哪些。
7. 本计划采用边界方案 **(a)**：知识库页面（网络图、维护、设置）仍留在宿主前端，通过公开合同调用插件；知识能力的源码、构建、发布全部归插件仓库。方案 (b)（知识页也做成 UI 插件）不在本计划内，见 §8。

### 现状（为什么要做）

- `drone-plugins/packages/pi-knowledge` 只有占位 `src/index.ts`，`dist/index.mjs` 是从 Drone 构建产物拷进去的，源码在 Drone（`packages/knowledge`、`packages/extensions`）。
- 桌面 App 从 `Resources/research-workbench/extensions` 加载 Drone 自己打包的 `.pi/extensions/*.mjs`，不用插件仓库的包。
- 结果：同一能力两份产物，插件仓库的 pi-knowledge 已落后于基线（不含 topic、probeTopic、recentByCategory 等）。
- 宿主对知识包是深度直连：`packages/backend/src` 有 13 个文件 import `@drone/knowledge` 的 13 个不同子路径（`ui-service`、`ui-state`、`daily-discovery`、`publication`、`specialist-host`、`runtime-host`、`files`、`config`、`layout`、`wiki-model-review`…）。

## 1. 目标结构（本计划完成后）

```text
drone/（宿主）
  packages/desktop      renderer（含知识库页面）、main、preload
  packages/backend      会话、宿主服务、调度器（只 import @gyoungwe/pi-knowledge/host）
  packages/shared       宿主内部类型
  packages/plugin-api   公开合同（含知识合同类型，1.1.0）
  packages/tasks, compute, pi-core, pi-research, research, inquiry, discovery   本计划不迁
  plugins.lock.json     插件来源锁定（仓库 + commit + 包名 + 产物 sha256）
  （删除）packages/knowledge、.pi/extensions 中的知识产物

drone-plugins/（插件）
  packages/pi-knowledge
    src/core/       ← 原 drone/packages/knowledge/src（保留 git 历史）
    src/extension/  ← 原 drone/packages/extensions 中知识相关入口
    src/host.ts     宿主入口（导出给 backend 的唯一 API 面）
    src/maintenance/ 自动维护（新）
    test/           ← 原 drone/packages/knowledge/test + 新测试
    dist/           由本仓库从 src 构建（不再从宿主拷贝）
```

## 2. P1 收口宿主依赖面（只改 drone 仓库）

目的：先把 backend/desktop 对知识包的 13 个子路径收成一个入口，迁移时只需替换一处。

1. 新建 `packages/knowledge/src/host.ts`，**只**导出 backend/desktop 当前实际用到的符号（用 grep 列全：`grep -rhoE 'import \{[^}]+\} from "@drone/knowledge[^"]*"' packages/backend/src packages/desktop/src`）。在 `packages/knowledge/package.json` 的 `exports` 加 `"./host"`。
2. 把 backend、desktop 中所有 `@drone/knowledge`、`@drone/knowledge/*` import 改成 `@drone/knowledge/host`。测试文件同样改。
3. 知识包对 `@drone/shared` 的 6 处类型依赖：把这些类型（`KnowledgeGraph`、`KnowledgeOverview`、`KnowledgeRecentNote` 等实际用到的）移到 `packages/plugin-api/src/knowledge.ts` 并从 `@gyoungwe/plugin-api` 导出；`@drone/shared` 改为从 plugin-api 重新导出这些类型（宿主其余代码不用改）。plugin-api 版本升到 `1.1.0`（只加不删）。
4. 在 `scripts/check-architecture.mjs` 加规则：除 `packages/knowledge` 自身和 `packages/extensions` 外，任何包 import `@drone/knowledge` 的路径只能是 `@drone/knowledge/host`；`packages/knowledge` 只能 import `@gyoungwe/plugin-api`、Node 内置模块和 npm 依赖（不能 import 任何 `@drone/*`）。给规则写测试（`check-architecture.test.mjs`）。
5. `packages/extensions` 里知识相关入口（`knowledge-extension.ts`、`knowledge-worker.ts`、`obsidian-workbench.ts`、`workspace-config.ts` 及其 `internal/` 依赖：`knowledge-extension`、`knowledge-runtime`、`obsidian-setup`、`obsidian-workbench`、`vault*`、`reply-focus`、`runtime`、`discovery-prompt`）列出清单，写进 `docs/pluginization/p1-inventory.md`：每个文件归属 knowledge / research / host，以及它 import 了哪些 `@drone/research`、`@drone/tasks`。**本阶段不移动文件**，只出清单并消除知识入口对 `@drone/research` 的依赖（如有，改为经 plugin-api 的 HostPort 注入或移到 research 侧）。

P1 验收：`npm run lint && npm run typecheck && npm test && npm run check:arch` 全过；`grep -rE 'from "@drone/knowledge/(?!host)' packages/backend packages/desktop` 无结果（用 `rg -P`）；行为不变。

## 3. P2 源码迁到插件仓库（两个仓库）

1. 在 drone 用 `git subtree split --prefix=packages/knowledge -b knowledge-split` 拆出带历史的分支；在 drone-plugins 用 `git subtree add --prefix=packages/pi-knowledge/src/core <drone 路径> knowledge-split`（或等价方式，**必须保留历史**，验收会用 `git log --follow` 检查任意一个老文件）。`test/` 同样迁到 `packages/pi-knowledge/test/`。
2. P1 清单中归属 knowledge 的 extensions 入口迁到 `packages/pi-knowledge/src/extension/`（同样保留历史，可对 `packages/extensions` 做一次 split 后只保留知识文件）。
3. pi-knowledge 改为**从源码构建**：
   - `scripts/build.mjs` 用 esbuild 从 `src/extension/knowledge-extension.ts` 打 `dist/index.mjs`、从 `src/extension/knowledge-worker.ts` 打 `lib/knowledge/runtime/worker.mjs`，同时生成 `.knowledge-worker-manifest.json`（与宿主现有校验格式一致：`outputSha256` 等字段）。
   - 新增构建入口 `src/host.ts` → `dist/host.mjs` + `dist/host.d.ts`，`package.json` `exports` 增加 `"./host"`。
   - `build-manifest.json` 的 `artifactSource` 改为 `"source"`，并记录 src 输入哈希；`build:check` 校验 dist 与 src 一致。
   - 依赖：`@gyoungwe/plugin-api@^1.1.0`（在它发布前用 drone 打出的 tarball，放 `vendor/` 并在 lock 里锁 sha，**不许用相对路径指向 drone**）。
4. 测试在插件仓库跑：`npm test -w @gyoungwe/pi-knowledge`（vitest），覆盖原 knowledge 的全部测试（基线时 35 个文件、319 条）。
5. 版本：`@gyoungwe/pi-knowledge` → `0.2.0`；`plugin.manifest.json` 同步，`entrypoints` 增加 `"host": "./dist/host.mjs"`。
6. `research-suite` 的依赖同步到 0.2.0，`npm run check`（插件仓库全量）必须通过。

P2 验收：插件仓库 `npm run check` 全过；`packages/pi-knowledge/src/index.ts` 不再是占位；`dist` 可由 `npm run build` 从干净 checkout 重新生成且哈希一致；测试数 ≥ 319。

## 4. P3 宿主改为消费插件（只改 drone 仓库）

1. 新增 `plugins.lock.json`：
   ```json
   { "version": 1, "plugins": [ { "name": "@gyoungwe/pi-knowledge", "repo": "https://github.com/Gyoungwe/drone-plugins.git", "commit": "<P2 完成的 commit>", "path": "packages/pi-knowledge", "version": "0.2.0", "tarballSha256": "<npm pack 产物 sha256>" } ] }
   ```
2. 新增 `scripts/fetch-plugins.mjs`：按 lock 浅克隆指定 commit → 安装 → 构建 → `npm pack` → 校验 sha256 → 解包到 `vendor/plugins/<name>/`（gitignore）。支持开发覆盖：设置 `DRONE_PLUGINS_DIR=/path/to/drone-plugins` 时直接从本地插件仓库构建（不校验 sha，但打印醒目提示）。`npm run fetch:plugins` 挂进根 `build` 与 `prebuild`。
3. backend 依赖 `@gyoungwe/pi-knowledge`（`file:vendor/plugins/pi-knowledge`），P1 收口的 `@drone/knowledge/host` 全部替换为 `@gyoungwe/pi-knowledge/host`。
4. electron-builder `extraResources`：知识扩展和 worker 改为从 `vendor/plugins/pi-knowledge/` 复制到 `research-workbench/extensions/`（文件名保持 `knowledge-extension.mjs`、`knowledge-worker.mjs`、`.knowledge-worker-manifest.json`，宿主加载逻辑不用改；若改名则同步宿主加载与校验）。
5. 删除 drone 中的 `packages/knowledge/`、`packages/extensions` 里已迁走的入口及 `.pi/extensions` 中对应产物；更新 `scripts/build-extensions.mjs`、`.build-manifest.json`、`scripts/fixtures/native-pi-tools.json`（工具来源改为插件包）、`workbench-manifest.json`、`check-local-desktop-artifact.mjs`、`check-knowledge-package.mjs`。
6. 修掉基线里的构建坑：`build:extensions` 不能再改写知识 worker（它已不在 drone）；若仍有类似"一个脚本覆盖另一个脚本的产物"的情况，在 `docs/pluginization/p3-build.md` 列出并修。
7. 文档：根 README 写清新的构建顺序（`npm run fetch:plugins` → `npm run build` → electron-builder），以及插件开发时如何用 `DRONE_PLUGINS_DIR` 联调。

P3 验收：drone 仓库无 `packages/knowledge`，`rg '@drone/knowledge'` 无结果；`npm run lint/typecheck/test/check:arch/build` 全过；按 README 从干净 checkout 构建出的 App（`--dir`）中 `research-workbench/extensions/knowledge-worker.mjs` 的 sha256 等于插件仓库构建产物、manifest 校验通过；真机知识库能打开（Claude 真机验收）。

## 5. P4 自动维护（主要在插件仓库，宿主只加调度和界面）

### 5.1 行为

- 默认**关闭**。开启后：每天至多一次 + 新内容入库后（防抖 10 分钟）+ 界面「立即运行」。
- 每次运行两步：
  1. **免费检查**（不调模型）：孤立笔记、缺少主题（`looksLikeFileName`）、没人引用的 Wiki、来源哈希变化、托管块异常。产出候选清单。
  2. **模型处理**：按优先级（缺主题 > 来源变化 > 孤立 > 未被引用）取前 N 项（默认 5），对每项调用模型：
     - 缺主题：读来源笔记前 4000 字 → 生成 ≤40 字主题 → 走 `setSourceTopic` 同等逻辑（只改 topic 和自动标题）。
     - 孤立 / 未被引用：给出建议双链（只能指向 Vault 中真实存在的页面，宿主校验）→ 作为 **Wiki 审阅候选**提交，不直接写。
     - 来源变化：复读来源，与笔记比对 → 有差异则提交审阅候选。
- 任何正文修改都进 Wiki 审阅队列；唯一允许直接写的是缺主题时的 `topic` 字段（与 `research_set_source_topic` 规则一致：保留人工标题）。
- 预算：每次最多 N 项、每天最多 M 次模型调用（默认 20），超出即停，剩余留到下次；模型报错不计为已处理，下次重试（参考 `backend/src/services/daily-discovery.ts` 的 `completionText` 处理）。
- 每次运行写一条运行记录：时间、检查数、处理项、每项结果（已改主题 / 已提交候选 / 跳过原因）、模型调用次数；保存在应用状态目录（不写 Vault），保留最近 30 次；同时向 Vault 的 `log.md`（若存在约定的日志页）追加一行摘要——若当前没有该约定，则只存应用状态，不新建 Vault 文件。

### 5.2 代码归属

- 插件 `packages/pi-knowledge/src/maintenance/`：
  - `plan.ts`：`planMaintenance(status, graph, settings) → MaintenanceItem[]`（纯函数，免费检查 + 排序 + 截断）。
  - `run.ts`：`runMaintenance(items, { complete, readNote, setTopic, proposeWiki, budget, signal }) → MaintenanceRunReport`，模型和写入能力**全部由宿主注入**（经 plugin-api 的 HostPort 类型），插件不直接持有模型凭据。
  - `prompts.ts`：各项任务的提示词与输出解析（严格 JSON，解析失败计为跳过并记录原因）。
  - 由 `src/host.ts` 导出。
- 宿主 `packages/backend/src/services/knowledge-maintenance.ts`：调度（仿 daily-discovery：每小时检查、开关、上次运行时间）、注入模型调用与写入函数、保存运行记录；新增 IPC：`getMaintenanceSettings / saveMaintenanceSettings / runMaintenanceNow / getMaintenanceRuns`（`shared/src/host-api` 合同 + main/ipc + preload）。
- 宿主前端：知识库「维护」页顶部加一块「自动维护」：开关、每次项数、每日上限、模型选择（沿用现有模型选择组件）、「立即运行」、最近一次运行结果（逐项列出，点击打开笔记或审阅项）。中英文文案都加。

### 5.3 测试（不得调用真实模型）

- `plan.test.ts`：给定图与状态，产出排序和截断正确；基础设施页（Index/Home）永不入选。
- `run.test.ts`（假模型）：预算截断；模型报错不计已处理；JSON 解析失败记跳过；建议双链指向不存在页面时被拒；缺主题只改 topic（对含人工标题的笔记断言标题未变）；所有正文修改都走 `proposeWiki` 而不是直接写。
- 宿主：调度器开关/每日一次/防抖测试；IPC 合同测试。

P4 验收：上述测试全过；默认关闭；在临时 Vault（测试夹具，≥20 篇含文件名标题的笔记）上用假模型跑一次，运行记录与 Vault 变更逐项对得上；真机上 Claude 用你的正式 Vault 开启一次，限 N=2，核对结果（这一步由 Claude 做，会消耗少量模型用量，届时先征得用户同意）。

## 6. 回归清单（每阶段都必须仍然成立）

| 行为 | 自动化检查 |
|---|---|
| 归档来源必须带 `topic`，写入 frontmatter 与标题 | `source-archive` 工具 schema `required` 含 `topic`；obsidian-workbench 测试 |
| 节点标题优先级 topic > title > H1 > 文件名 | `note-title.test.ts` |
| 问题点名 Wiki 标题自动走本地知识 | `topic-probe.test.ts` |
| 首页分类标签过滤最近沉淀 | worker `recentByCategory` 测试（P2 需补一条） |
| 托管块重复标题清理 | `managed-header.test.ts` |
| 网络图聚类打包布局、健康检查含缺少主题 | `graph-model.test.ts`（宿主前端，留在 drone） |
| 本地回答指标持久化 | 需补一条 `ui-state` 测试（P2） |
| 知识 worker 产物与 manifest 一致 | `check:knowledge-runtime`（P3 后改为插件仓库 `build:check` + 宿主打包校验） |

## 7. 每阶段交付与验收证据

每个阶段结束时：

1. 推送两个仓库的 `pluginize/v2` 分支。
2. 在 drone 写 `docs/pluginization/P<n>-evidence.md`，包含：
   - 两个仓库的 commit 号；
   - 运行过的命令与结尾输出（测试数、通过数）；
   - 本阶段删除/新增的文件清单；
   - 未完成或偏离项（如实写，不得把未做的标成完成）。
3. 告诉用户"P<n> 完成，请 Claude 验收"。Claude 会：拉分支、在干净环境重跑命令、核对证据、检查 §0 规则（尤其跨仓库相对路径、调用真实模型、Vault 读写）、必要时真机验证；不通过会写明原因与需修改项。
4. 编码尺度检查：Claude 会对本阶段 diff 统计新增的空 `catch`、`?? 默认值`、`typeof`/`Array.isArray` 检查和兼容分支，逐条对照 `AGENTS.md`「编码尺度」；没有理由的会被退回。迁移阶段（P2/P3）期望这些数量净减少。

## 8. 不在本计划内（后续再定）

- 方案 (b)：知识库页面做成 desktop-ui-pack 的整页 UI 插件（需先扩展 UI 插件接口支持整页贡献）。
- research / pi-research / zotero / source-archive 的源码迁移（P1 清单会标出归属，P2 只迁 knowledge）。
- `@gyoungwe/plugin-api@1.1.0` 正式发布到 npm（需要用户的 npm 凭据；在此之前用锁定 sha 的 tarball）。
- 矛盾检测（contradictions）类维护任务。

## 偏离记录

| 2026-10-21 | P1 | 工作分支使用 `codex/pluginize-v2-p1`，没有创建计划中的 `pluginize/v2` | 仓库维护技能要求改动默认使用 `codex/*` 分支；P1 只改宿主仓库，未在 `drone-plugins` 创建无改动分支 |
