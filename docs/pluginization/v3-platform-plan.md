# 插件化 v3：插件平台收口（执行计划）

> 执行方：GPT（Codex）。验收方：Claude。规范依据：`drone-plugins/docs/PLUGIN-SPEC.md`（以下简称「规范」），操作流程见技能 `drone-plugin-dev`。偏离计划时，先在文末「偏离记录」写明再动手。

## 0. 基线与规则

- 基线：Drone 与 drone-plugins 合并 v2（`codex/pluginize-v2-p2`）之后的 `main`。v2 未合并前不要开工。
- 分支：两个仓库都用 `codex/plugin-platform-v3`；每个任务单独提交，提交信息以 `feat(platform): T<n>` 开头。
- 沿用 v2 计划第 0 节的全部规则：不推 main；测试不调用真实模型、不读写用户 Vault；遵守两个仓库 AGENTS.md 的「编码尺度」；每个任务写证据。
- 证据统一写在 `docs/pluginization/v3-evidence.md`，每个任务一节，写明改了哪些文件、新增测试名称和命令输出。

## 1. 目标

完成后应当满足：

1. 第三方只要发布一个符合规范的 npm 包（L0/L1/L2），用户在「技能与连接」里安装后，工具、技能、界面都能用，**宿主不需要改一行代码**。
2. 宿主只依赖锁文件里的必需插件；移除全部可选插件后，宿主照常启动并通过测试。
3. 插件格式由检查器强制执行，不靠口头约定。

## 2. 任务

### T1 manifest 检查器与 `tools` 字段（drone-plugins）
- `scripts/check-manifests.mjs` 按规范 §4 校验：
  - `id` 符合正则，`version` 与 `package.json` 一致；
  - `capabilities` 在词表（§4.1）内；
  - 每个 `entrypoints` 路径都存在，并且被 `files` 覆盖；
  - `permissions` 的结构和取值合法；
  - L1 必须有 `tools`；
  - `package.json` 的依赖规则符合 §3、§6.2：Pi runtime 只能是 peer，不能依赖其他 Drone 插件，聚合包除外。
- 给现有 6 个插件的 manifest 补上 `tools`。
- 每个能力插件的 smoke（或注册测试）断言：运行时注册的工具与 `manifest.tools` 完全相等。
- 为检查器写测试，每条规则至少一个反例夹具。
- 验收：`npm run check` 通过；把任一 manifest 改坏一项，检查器都能指出是哪一项。

### T2 通用 UI 插件发现（Drone）
- `packages/desktop/src/main/ui-plugins/manager.ts`：删除硬编码的 `@gyoungwe/desktop-ui-pack/ui` 路径。改为遍历 Pi 托管安装根目录（`<agentDir>/npm/node_modules`，含 scope）下的已安装包，读取其 `plugin.manifest.json` 的 `entrypoints.ui`；`hosts` 必须包含 `drone-desktop`。
- 扫描到的 UI 插件与用户目录、内置插件走同一条构建、启用、热重载路径；默认未启用，第一次启用时需要用户确认（与现有第三方 UI 插件一致）。
- 用一个**非 `@gyoungwe` 作用域**的夹具包测试：它的 UI 能被发现、启用和停用；包损坏或 `droneUi` 版本不对时，只在诊断里报告，宿主不受影响。
- 验收：现有 desktop-ui-pack 仍能被发现；夹具包也能被发现；`rg desktop-ui-pack packages/desktop/src/main` 只剩测试命中。

### T3 页面区域：`knowledge.tab`、`home.section`、`skills.section`（Drone）
- `knowledge.tab`：在知识库页「总览 / 网络图 / 审阅 / 设置」后追加插件页签，标签为 `title`，id 为 `plugin:<name>:<cid>`，选中后贡献组件占满页签内容区。
- `home.section`：在新任务首页的卡片区追加分区。
- `skills.section`：在技能与连接页追加分区。
- 三个区域都要同步：renderer 挂载点、`drone-ui.d.ts`、UI SPEC 第 10.1 节表格、plugin-api shim（`npm run generate:plugin-api`），并把规范 §7.1 的状态改为「已有」。
- 插件禁用或加载失败时恢复默认：知识库回到「总览」，首页和技能页不留空壳。
- 测试：三个区域各一条挂载 / 卸载测试，外加一条「禁用后恢复默认」测试。
- 验收：桌面端测试通过；真机上装一个示例插件，三个区域都能看到它的贡献，停用后消失（由 Claude 真机验收）。

### T4 宿主独立性检查（Drone）
- 新增 `scripts/check-host-independence.mjs`，挂进 `npm run check:arch`：
  1. **静态检查**：宿主源码（`packages/*/src`，不含测试）中出现的 `@gyoungwe/*` 包名，只能是宿主自有包（`plugin-api`、`pi-core`、`pi-research`）或 `plugins.lock.json` 中的必需插件；对必需插件只能引用 `host` 入口。
  2. **运行检查**：在临时目录里不放任何可选插件（Pi 托管安装根和 UI 插件目录都为空），创建 backend，确认知识、会话、技能列表的基础调用正常返回，UI 插件管理器返回空列表且不报错。
- 验收：检查通过；临时加一个对可选插件的 import，检查失败并指出文件。

**C2 历史例外（2026-10-23）**：当时 `@gyoungwe/plugin-api` 没有可发现、可版本化的 analysis host registry/loader，宿主暂时保留了三个 facade。

**v3.1 已完成（2026-10-23，已合入两个 `main`）**：`plugin-api` 新增版本化 `AnalysisAdapterRegistryPort`、`AnalysisHostPort` 和 `AnalysisHostLoader`；`@gyoungwe/pi-analysis@0.1.2` 新增 `host` entry，导出 `analysisHostLoader`；宿主改为消费 `@gyoungwe/pi-analysis/host`，删除 `packages/backend/src/services/analysis-adapters/` 下的三个 facade 和组合 index。Drone `main=a6a6ade0ad3f86224c2a580d19a6d5b1d4230a6c`、drone-plugins `main=127db2658f465337fe9ad936692302d8536c09ba`，`plugins.lock.json` 锁定插件提交与 tarball SHA-256，`check-host-independence` 要求所有分析包引用必须走 `/host` entry；公开 npm 验收见 [`v3.1-pi-analysis-0.1.2.json`](../releases/v3.1-pi-analysis-0.1.2.json)。

- v3.1 删除条件已满足：`check:arch`、空可选插件运行检查，以及 analysis adapter/capability discovery 和 analysis plan→review→delivery 回归均通过。
- 双仓库门禁和推送记录见本文件的 v3.1 证据及 [`gap-closure-plan.md`](gap-closure-plan.md) 执行记录。

### T5 安装前展示权限与工具（Drone）
- 「技能与连接」安装插件时，从包的 `plugin.manifest.json` 读取 `permissions`、`tools`、`capabilities`、`hosts`；安装确认和插件详情中展示出来。L0 包没有 manifest 时显示「未声明权限（通用 Pi 包）」。
- 安装前取元数据：先查 npm registry 的包元数据；取不到就安装后展示，并标注「安装后读取」。不新增绕过用户确认的路径。
- 中英文文案都要加。
- 验收：对 pi-analysis 和一个 L0 夹具包，确认框分别显示正确的信息。

### T6 第三方工具重名检测（Drone）
- 会话装配完成后，检查各扩展注册的工具名有没有重复；有重复时在「技能与连接」的诊断里列出冲突的工具名和来源包，保留先加载的那个，不抛错。
- 验收：用两个注册同名工具的夹具包测试，诊断中列出冲突，会话正常。

### T7 文档与技能登记（两个仓库）
- `docs/INDEX.md` 登记规范、技能和本计划。
- `drone-plugins/AGENTS.md` 指向规范；`Drone/AGENTS.md` 写明插件相关任务使用技能 `drone-plugin-dev`。
- `drone-maintenance/references/dual-repo.md` 的所有权表更新为 v2 合并后的事实：pi-knowledge 源码已在插件仓库。

## 3. 回归清单（每个任务后都要成立）

- v2 的所有回归项（主题、节点名、分类标签、网络图、自动维护、知识 UI 事件跨 bundle）仍然通过。
- desktop-ui-pack 和内置 UI 插件照常加载。
- 干净 checkout、不设 `DRONE_PLUGINS_DIR` 时，`npm ci → fetch:plugins → lint → typecheck → test → check:arch → build → check:extensions -- --strict` 全部通过；插件仓库 `npm run check` 通过。

## 4. 不在本计划内

- 权限的强制执行（沙箱）。manifest 仍然只是声明，授权仍由宿主做。
- `@gyoungwe/plugin-api` 发布到 npm（需要用户凭据）。
- research、pi-research、zotero 的源码迁移。
- 把知识库页面整体做成 UI 插件（方案 (b)）；T3 的 `knowledge.tab` 只是为它铺路。

## 偏离记录

（日期、任务、偏离内容、原因。）
