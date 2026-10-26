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

插件 worktree：

- `DRONE_PLUGIN_API_TARBALL=/tmp/gyoungwe-plugin-api-1.3.0.tgz npm run check`：PASS；8 manifests、知识 486 tests、研究 134 tests、locked/latest SDK matrix、research-suite PDF、clean-prefix smoke、pack checks 均通过。
- 在该基线后，插件提交 `f476a7b` 增加 connector-backed Zotero host seam；pi-research 26 文件/136 tests、typecheck、build/build:check 和 package smoke 通过，smoke receipt 为 `lookup → found`。本轮 `test:sdk` 因网络会话挂起被终止，未宣称新 SDK PASS。

## 未关闭项

本轮仍未证明：P2–P5 宿主领域装配删除；无领域插件的正式 DMG 启动与升级/停用/回滚；同一候选 tarball 的正式安装包 GUI；真实 Zotero/用户 MCP/Protocols.io 写入及其他平台验收。`check:native-plugin-boundary` 仍按计划输出 `INCOMPLETE`，不得改写为 PASS。

