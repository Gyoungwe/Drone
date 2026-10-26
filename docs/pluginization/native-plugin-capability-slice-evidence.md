# 原生插件能力发现与 clean-prefix 包验收

日期：2026-10-27

本记录只证明本轮新增切片，不替代 P2–P7 的完整领域迁移和正式安装包验收。

## 宿主

- `198c21d1` 新增 `DomainCapabilityRegistry`，由 `createBackend` 暴露只读 capability view。它只报告当前 provider、状态和原因，不构造领域服务，也不新增 IPC；后续可将 provider 从 `host-compat` 换成已安装插件而不改变 renderer 合同。
- `198c21d1` 同时让空的 managed UI package root 返回空 diagnostics；无可选 UI 插件时 `UiPluginManager.init()`、列表、来源、启用状态和诊断均保持可用。
- targeted checks：backend registry 2 tests、desktop empty-root 4 tests、backend/desktop typecheck、Biome 均通过。

## 插件

插件分支 `codex/native-plugin-architecture`：

- `3a84525` 增加 `research-suite` 自身 tarball clean-prefix 安装脚本。
- `a62708d` 从安装前缀加载 Pi SDK，并固定 1.1.0 SDK family，排除 workspace module resolution 假通过。
- `f7c68b1` 将该 smoke 接入 `check:research-suite`。
- `npm run check:research-suite` 和 workspace `npm run check` 通过；clean-prefix receipt：`@gyoungwe/research-suite@0.2.0`，4 extensions、22 tools，tarball SHA-256 `9bf75e0eb78d09a16bdc730ca2831a231cc68dbadc526d5d31e23fc220c7bc01`。

## 合并后门禁

宿主 worktree `codex/native-plugin-architecture-plan`：

- `npm run lint`：PASS；保留既有 2 MiB 设计稿文件大小 warning。
- `npm run typecheck`：PASS。
- `npm test`：PASS；backend 252 files/2029 passed/18 skipped，desktop 164 files/898 tests passed，其他 workspace 与脚本测试通过。
- `npm run build`：PASS。
- `npm run check:arch`：PASS；`Architecture check passed (0 baseline finding(s), 0 fixed)`，`Host independence check passed`。
- `485221d5` 的 runtime slice：Biome、`npm run typecheck -w @drone/shared`、`npm run typecheck -w @drone/backend` 及 `npm test -w @drone/backend -- src/create-backend.test.ts src/runtime.test.ts` 均 PASS（12 tests）。runtime event bus 按 backend 实例隔离；legacy `process.emit` 仅作兼容桥并按 cwd 过滤，双 backend 回归通过，dispose 清理 bus 与进程监听。
- `7a674fd3`/`9e32809d` 的后续 host slice：knowledge provider 注入、versioned `/host` 入口限制和空插件独立性检查均通过；`npm run typecheck -w @drone/backend`、create-backend 8 tests、独立性/边界 6 tests、Biome 通过。
- `11804540` 的 analysis slice：`AnalysisTaskController` 仅消费显式 `AnalysisHostLoader`/registry；无 loader 时 fail-closed，Desktop 缺包继续启动并记录告警。Biome、backend/desktop typecheck、analysis adapter/controller 12 tests 通过；manifest 依赖清理和正式包分析 workflow 仍未完成。
- `66cc4394` 的 generic host discovery slice：按任意已安装包的 `plugin.manifest.json` capability、`drone-desktop` host 和包内 `entrypoints.host` 动态加载 host loader；Desktop 源码不再直接写 pi-analysis 包名，backend 将 pi-analysis 移出运行时依赖。空根、未声明能力和路径穿越 3 tests、backend/desktop typecheck、host independence 与 Biome 通过。knowledge/research/core 仍是运行时依赖，故不宣称零插件构建完成。
- 本轮独立性门禁收紧：`check-host-independence.mjs` 将 `@gyoungwe/pi-core` 纳入 versioned host-entry 规则，仅登记 backend 的 5 个历史兼容 facade（project memory、todo、status、memory-save、deliver-files）；新宿主源码直接导入 pi-core 会失败。`node --test scripts/check-host-independence.test.mjs`（5 tests）与完整扫描均通过。该登记是 P4 迁移边界，不代表 pi-core 已从宿主运行时依赖移除。
- 宿主 `0e65b396` 增加 research host capability 注入：Desktop 使用通用 manifest discovery 加载任意已安装包的 `ResearchHostLoader`，backend 以 `createResearchHostPort` 授予受限 workspace/results 文件读取并将 `status/listRuns` 接到 knowledge IPC；research host file port 的越界/绝对路径 2 项回归、backend/desktop typecheck 通过。当前只读摘要合同不覆盖完整 run detail，宿主仍有其他 `pi-research` 兼容导入，不能作为 P3 完成或零插件正式 DMG 证据。
- 宿主 `0e65b396` 同步接入 knowledge host capability：Desktop 通过 manifest capability discovery 加载任意已安装包的 `knowledgeHostLoader`，backend 注入 `KnowledgeReadProvider` 覆盖 overview/search/read/noteLinks/graph；插件 `657d6f1` 的版本化 read port 与宿主发现回归 `8ed0a7fe`（4 项）通过。worker、写入服务、UI 所有权和旧组合根仍在迁移，不能作为 P2 完成或零插件正式 DMG 证据。
- 本轮合并验证（`730370b1`、`1b239a09`、`ded51ba1`）：`npm run lint`、`npm run typecheck`、`npm test`、`npm run build`、`npm run check:arch` 均通过；第二次全量测试回执为 backend 254 files/2040 passed/18 skipped、desktop 165 files/902 passed，`check-build-inputs` 已改为验证注入式 research host seam。仅保留既有设计稿体积 warning。

插件 worktree：

- `DRONE_PLUGIN_API_TARBALL=/tmp/gyoungwe-plugin-api-1.3.0.tgz npm run check`：PASS；8 manifests、知识 486 tests、研究 134 tests、locked/latest SDK matrix、research-suite PDF、clean-prefix smoke、pack checks 均通过。
- 在 `657d6f1` 后以当前宿主构建的 `@gyoungwe/plugin-api@1.3.0` 候选 tarball（SHA-256 `0916b3c5822548189ee1b3d7c28554cb459714a469074aef779021ae8191a027`）重跑 workspace check：knowledge host-loader smoke、research host/Zotero lookup、locked 1.1.0/latest 1.4.0 SDK matrix、research-suite clean install/PDF、analysis/evidence/connectors/workbench/UI pack 与 pack check 全部通过；真实 GUI 仍记为 `NOT_RUN`。
- 在该基线后，插件提交 `f476a7b` 增加 connector-backed Zotero host seam；pi-research 26 文件/136 tests、typecheck、build/build:check 和 package smoke 通过，smoke receipt 为 `lookup → found`。本轮 `test:sdk` 因网络会话挂起被终止，未宣称新 SDK PASS。

- 宿主 P2 worker 边界切片：移除 `knowledge/ui.ts` 的模块加载期 worker 配置；`createBackend` 仅在未发现 `KnowledgeHostLoader` 时启用 legacy `.pi/extensions/knowledge-worker.mjs`。已安装 knowledge 插件的通用宿主因此不再要求宿主 workbench worker 资源，缺失 worker 根的插件路径回归通过（13 项 focused tests）。worker 本体、写入服务和完整 UI 所有权仍未迁出，P2 继续保持部分完成。

- 宿主 `55699c2f` 扩展通用发现：除 `plugin.manifest.json` 外，发现器也接受标准 Pi `package.json` 中可选的 `drone` 声明；普通 Pi 包可在不增加 Drone 专用清单的情况下声明 Desktop host entry。路径仍限制在包根内，5 项发现回归通过。
- 宿主 `649b465e` 增加可选 `ResearchHostOperations.detail` 合同；提供完整详情适配器的研究插件可直接返回 run detail，未提供时继续使用 metadata-only fallback。backend typecheck、Biome 与 11 项 create-backend 回归通过；完整 Zotero/连接器页面、写入和正式 GUI 仍未完成。
- P4 依赖收窄切片：`diagnosticText` 从 `@drone/tasks` 迁入 `@drone/shared`，tasks 保留同名 re-export 以保持既有调用方 API；backend diagnostics 改为只依赖 shared。shared/tasks/backend typecheck 与 8 项 diagnostics/failure-feedback 回归通过。任务状态机、workbench 运行时和宿主对 tasks 的其余装配仍未迁移。
- 本轮全量 `npm test` 复跑未通过：backend 252 文件中 2 个既有 knowledge fixture 失败（`knowledge-host-ui-reading` 报 `Workspace config host is not configured`，`knowledge-worker-lifecycle` 收到 `workerVersion: unknown`），其余 backend 2040 项、desktop 165 文件/903 项及其他 workspace 通过；新增发现器/研究详情聚焦测试 18 项通过。该回执不替代此前基线全量通过记录，也不把当前全量门禁记为 PASS。
- 插件 P5/P6 `4467782` 为 `pi-analysis` 与 `pi-evidence` clean-install smoke 增加声明一致性校验：安装后的 capabilities、host entry、`manifest.tools` 必须与真实 Pi loader 注册工具一致；analysis 3 工具、evidence 4 只读工具均通过。正式 GUI、零插件安装包和完整领域迁移仍未完成。

## 未关闭项

本轮仍未证明：P2–P5 宿主领域装配删除；无领域插件的正式 DMG 启动与升级/停用/回滚；同一候选 tarball 的正式安装包 GUI；真实 Zotero/用户 MCP/Protocols.io 写入及其他平台验收。`check:native-plugin-boundary` 仍按计划输出 `INCOMPLETE`，不得改写为 PASS。

