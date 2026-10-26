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

- 宿主 P2 写入合同切片：`KnowledgeHostPort` 现在可声明 `reviews`、`preview`、`decide` 三个可选审核操作；`KnowledgeUiService` 在插件提供这些操作时路由到插件，否则保留兼容实现。该 seam 不自行授予写权限，插件仍需通过自己的 host runtime 完成 revision/授权/写后回读。`create-backend.test.ts` 新增注入路由回归；Biome、backend typecheck 与 12 项 create-backend 测试通过。Vault 写入服务、完整 worker 和 UI 所有权仍未迁出，P2 继续保持部分完成。

- 宿主 `c48f0023` 将上述 P2 审核操作接入 `createBackend` 的已发现 `KnowledgeHostPort`，插件路径的 `preview/decide` 现在真实走 host seam；无插件路径继续使用兼容实现。12 项 `create-backend` 回归、backend typecheck 和 Biome 通过。权限、CAS、写后回读仍由插件 host runtime 负责，P2 不标记完成。
- 宿主 `ada749a4` 将知识发布失败关闭提示迁入 `@drone/shared`，删除 backend `session/knowledge-publication.ts` 对 `@gyoungwe/pi-knowledge/host` 的运行时直接依赖；shared/backend typecheck、Biome 和 publication fallback 10 项测试通过，native boundary 的 runtime-import 计数由 32 降至 30。知识事件投影仍依赖注入的 `DroneRuntime` bridge，P2/P6 继续部分完成。
- 宿主 `1cb765c8` 补强 P6/P7 失败回执：卸载无变化和 registry 不可用的更新均保持 `failed`/`not-installed`，不写入 `disabled` 或新版本，也不触发 reload；backend lifecycle 8/8、Biome 通过。正式 DMG 的零插件、升级/回滚和销毁失败回执仍未完成。
- 宿主 `369f7c58` 收紧真实 arm64 `Drone.app` 的零可选插件回归：空 `profile/ui-plugins`、空 Pi managed npm root、空 auth/model、未绑定 knowledge、generic Pi session create/close 及现有 research/Obsidian IPC 均通过。该回执只证明空插件宿主可启动与通用会话生命周期，不证明插件安装/停用恢复、升级回滚或销毁失败。
- P6 依赖策略门禁已加入 `check:host-domain-deps` 并接入 `check:arch`：backend 当前的 `@drone/research`、`@drone/tasks`、`@gyoungwe/pi-core`、`@gyoungwe/pi-knowledge`、`@gyoungwe/pi-research` 被列为带移除条件的迁移依赖；新增未登记的 `@gyoungwe/pi-*` 或把 `pi-analysis`/evidence/connectors/UI/suite 提升为 runtime dependency 会直接失败。三项策略回归、Biome、`check:arch` 通过；输出保持 `PARTIAL`，不掩盖 P2–P5 未完成的宿主装配删除。
- P4 `1616ce6b` 将 backend 任务 acceptance registry 改为直接写入 host-owned `DroneRuntime.tasks.acceptance`，移除 `package-runtime.ts` 对 `@drone/tasks/acceptance` 与 `runtime-bridge` 的运行时导入；保留 v1 registration shape 校验和默认值语义。acceptance bridge 测试、backend typecheck 与 Biome 通过，P4 仍有完整任务状态机/编排迁移缺口。
- P2 `ca97c1e2` 将 `KnowledgeMaintenanceService` 改为注入 `KnowledgeMaintenanceOperations`；已发现 knowledge host 可提供 `planMaintenance/runMaintenance`，无插件时回退既有兼容实现。create-backend/knowledge-ui seam、4 项 maintenance 测试、backend typecheck 与 Biome 通过；worker、完整写入和 UI 所有权仍未迁出。
- P2 `e4bc4410` 将每日发现的 prompt/parser 从 backend service 移到 `DailyDiscoveryOperations` host contract；已发现 knowledge host 可提供实现，无插件时由组合根通过兼容 host entry 提供。daily-discovery 12 项测试、backend typecheck 与 Biome 通过，backend service 不再直接 runtime import `@gyoungwe/pi-knowledge/host`；worker、完整写入和 UI 所有权仍未迁出。
- P3 `d0df0d95` 将机构访问配置和 Cloudflare 提示的纯策略 helper 迁入 `@drone/shared`，backend 不再为这两段逻辑直接 runtime import `@gyoungwe/pi-research/host`；shared 回归、backend typecheck 与 Biome 通过。Zotero 状态、连接器写入和完整研究页面仍未迁移。
- P2/P6 `cc10cec3` 将 WebDAV 知识传输的大小限制和 Vault 相对路径校验迁入 shared host contract；`webdav.ts`/`webdav-transport.ts` 不再直接 runtime import `@gyoungwe/pi-knowledge/host`。Biome、shared/backend typecheck、shared 6 项路径合同测试和 backend WebDAV 17 项测试通过；native boundary runtime-import 继续下降，完整 knowledge worker/写入/UI 所有权仍未完成。
- P3 `d0df0d95` 将 EZproxy URL/Cloudflare challenge 纯策略 helper 迁入 `@drone/shared` 的 `research-access` 合同；`institutional/config.ts` 与 `session-engine/cloudflare-ask.ts` 不再直接 runtime import `@gyoungwe/pi-research/host`。shared/backend typecheck、policy 4 项和 institutional 5 项测试通过；Zotero 状态、机构连接器完整迁移与写入仍未完成。
- P2/P6 `cc10cec3` 将 WebDAV 知识路径合同（`KNOWLEDGE_MAX_NOTE_BYTES`、`validateKnowledgeNotePath`）迁入 shared；backend webdav/webdav-transport 不再直接 runtime import `@gyoungwe/pi-knowledge/host`。shared/backend typecheck、Biome、knowledge-path 6 项及 webdav/sync 17 项测试通过；worker、完整写入和 UI 所有权仍未迁出。
- P2/P6 `88f4fc5e` 将 specialist registrar 改为可选 `KnowledgeHostPort` 注入，backend `specialist-bridge.ts` 删除对 `@gyoungwe/pi-knowledge/host` 的 runtime import；Biome 通过，SDK 测试改为显式注册。跨模块事件合同仍保留，完整 specialist/worker 迁移未完成。
- P2/P6 `b7cd8b52` 将 compute experience 的终态记录改为注入式 knowledge operation，同时承载 research-resource host contract/factory 的宿主接线；`compute-experience`/`create-backend` 14 项测试、backend typecheck 与 Biome 通过。
- P3/P6 `19046ea0` 将 research capture 的 `ingestKnowledgeSnapshot/resolveKnowledgeContext` 改为 `ResearchKnowledgeOperations` 注入，backend service 删除对 `@gyoungwe/pi-knowledge/host` 的 runtime import；shared/backend typecheck、research-resource 8 项测试通过。无插件兼容回退保留，完整研究页面/写入仍未完成。
- P3/P6 `9dca6574` 将 Zotero setup binding 常量与只读 MCP config parser 迁入 shared；backend `zotero/status.ts` 删除 pi-research host runtime import，shared/backend typecheck 与 Zotero 6 项测试通过。
- P2/P6 `d2b018c6` 将 WebDAV binding/read/write/conflict 操作改为注入式 `KnowledgeWebDavVault`，`KnowledgeHostPort.vault` 负责组合；保留 fresh binding、CAS、原子写和授权语义，backend/shared typecheck、Biome 与 WebDAV 17 项测试通过。
- P4/P6 `5899f8fc` 将 deliverable reviewer 的 `BackgroundReviewer` 改为宿主注入的 reviewer factory，session composition 仅消费公开 adapter；3 项 targeted tests 与 Biome 通过，审稿算法仍由插件 host 提供。
- P2 `207c3a0c` 将 Knowledge UI 的事件订阅/通知与 Wiki 模型审阅改为可选 `KnowledgeHostPort.uiState/reviewWikiWithModel` 注入，保留无插件兼容回退并合并重复 host import；create-backend 13/13、backend typecheck 与 Biome 通过，native runtime-import 计数降至 13。
- P4/P6 `2755c85c` 将 project memory promote 改为 host-owned `ProjectMemoryWriter`，backend 不再经 pi-core facade 读取该写入器；promote 3 项、host independence 5 项测试和 Biome 通过，剩余 pi-core facades 仍有消费者。
- P7 `d39159d3` 将真实 arm64 包回执的 lifecycle 字段显式标为 `NOT_RUN`，列出 install/disable/restore/upgrade/rollback/destroy-failure 的未执行原因；空插件宿主及 generic session 仍 PASS，但不再让该回执暗示完整生命周期验收。
- P2/P6 `3f9ef839` 将 subagent answer publication registrar 改为 `DroneRuntime.knowledge.registerAnswerPublication` 注入，runner 删除对 `@gyoungwe/pi-knowledge/host` 的 runtime import；保留 evidence-only 子会话与 `begin(false)` 语义。backend typecheck、Biome、create-backend/subagent-panel 29 项测试通过，native runtime-import 计数降至 12。
- P2/P6 `0d0fbd7e` 将 ExperienceStore、terminal experience 与 deliverable reviewer 的纯类型合同发布到 `@gyoungwe/plugin-api/knowledge`；backend 不再从 pi-knowledge host 做这些 type imports。plugin-api contract 13 项、backend typecheck 与 targeted reviewer/experience 5 项测试通过。
- P2 `837d1594` 将每日发现 `DailyIdea` 与记忆沉淀 `MemoryNoteInput` 发布到 `@gyoungwe/plugin-api/knowledge`，backend knowledge UI 不再为这两个 payload 做 pi-knowledge host 类型导入；plugin-api 独立合同编译/13 项测试、backend typecheck 与 Biome 通过。
- P3/P6 `ad00d14c` 将研究写入 adapter 的执行上下文、adapter 和 registry 合同发布到 `@drone/shared`；`ResearchWriteService` 仅接收宿主注入 registry，删除 `@drone/research` runtime import，研究包保留兼容 re-export。shared/research/backend typecheck、5 项 research-write 回归与 Biome 通过；真实外部写入仍未验收。
- P3/P6 `c2b4c95f`/`6043b667` 将 research write 与 connector registry 从 `create-backend` 改为可注入的 host-neutral seam；默认 Desktop 组合移入显式 compatibility composition，宿主组合根不再直接 runtime import `@drone/research`。`52ced198` 补充 connector registry 注入回归；create-backend 注入测试、backend typecheck 与 Biome 通过；compat 文件仍保留默认实现，待安装 connector loader 接管后删除。
- P3/P6 `67543fbf` 将 `ResearchResourceService` 改为只依赖注入的 connector registry，删除其 `@drone/research` runtime import；connector search/recommend 行为由组合根或已安装 connector 提供，研究资源回归与 Biome 通过。
- P4/P6 `0fadba87` 发布版本化 `@gyoungwe/pi-core/host` host entry，`project/memory.ts` 不再直达 pi-core 根 memory 实现；pi-core build/check、12 项 pi-core 测试、backend project-memory 2 项回归、host-independence 与 `npm pack --dry-run` 均通过，包内包含 `dist/host.mjs`。该切片只收敛历史兼容门面的入口，不代表 pi-core 运行时依赖、任务状态机或正式安装包迁移完成；native boundary 仍保持 `INCOMPLETE`（runtime-import 11）。
- P2/P6 `0e84aec3` 将 `knowledge/ui.ts` 的默认领域实现集中到唯一 `knowledge/compat.ts` compatibility composition；UI 服务本身不再直接 runtime import `@gyoungwe/pi-knowledge/host`。同时 `reversible-write-adapters.ts` 改用 shared `ResearchWriteAdapterPort`，删除 backend 对 `@drone/research` 的类型依赖。Biome、knowledge UI 26 项、create-backend 18 项、WebDAV 6 项和 research write 23 项回归通过；compat 仍保留作为待删除迁移边界，native boundary 保持 `INCOMPLETE`（runtime-import 11）。
- P3/P6 `880ebc08` 将 `ResearchConnector`、执行上下文、连接器配置与项目存储端口发布到 `@drone/shared`；`@drone/research` 仅保留兼容 re-export，backend `research-resource.ts` 删除对研究包的类型依赖。shared/research/backend typecheck、research 25 项测试及 Biome 通过；native boundary 的 domain-type-import 从 14 降至 13，runtime-import 保持 11（仅剩显式 research compatibility composition），完整连接器实现迁移仍未完成。
- P4/P6 `042c44ff` 将 `@gyoungwe/pi-core` 的 status/todo/memory-save/deliver-files 工具发布到版本化 `/host` 入口，backend 四个兼容 facade 改用该入口；host bundle 导出检查、pi-core 13 项测试、backend typecheck 与工具相关 31 项测试通过。该切片只删除旧 `tools/*` 入口路径，`@gyoungwe/pi-core` 仍是登记中的迁移依赖，native boundary 继续为 `INCOMPLETE`（runtime-import 11）。
- P4/P6 `ae3434dd` 将 backend 对 `@drone/tasks` 的依赖降为 devDependency，门禁回归确认开发依赖不计入宿主运行时领域依赖；backend typecheck 与 `check:arch` 通过，任务状态机和 workbench 运行时仍未迁移。
- P2 `8619c135` 将 knowledge semantic settings/index 的 5 个 UI 操作改为 `KnowledgeHostPort.semantic` 注入；无 knowledge 插件时显式返回 unavailable，不伪造成功；host routing/no-plugin regressions、Biome 与 create-backend unit tests 通过。
- P7 `7daf6a13` 在实际 arm64 `Drone.app` 隔离 profile 中真实安装 `@gyoungwe/pi-evidence@0.1.1`，回执为 `staged → verified → enabled`；随后真实移除并回读为 `disabled → drained → disabled`，包目录与配置均消失。零插件/generic session 仍通过；restore/reload、upgrade、rollback、destroy-failure 和同 tarball GUI 仍 `NOT_RUN`。

- 宿主 `55699c2f` 扩展通用发现：除 `plugin.manifest.json` 外，发现器也接受标准 Pi `package.json` 中可选的 `drone` 声明；普通 Pi 包可在不增加 Drone 专用清单的情况下声明 Desktop host entry。路径仍限制在包根内，5 项发现回归通过。
- 宿主 `649b465e` 增加可选 `ResearchHostOperations.detail` 合同；提供完整详情适配器的研究插件可直接返回 run detail，未提供时继续使用 metadata-only fallback。backend typecheck、Biome 与 11 项 create-backend 回归通过；完整 Zotero/连接器页面、写入和正式 GUI 仍未完成。
- 宿主研究边界再收窄：`zoteroLibraryPath`/`zoteroLibraryEnvValue` 两个纯配置归一化函数迁入 `@drone/shared`，`backend/src/zotero/web-credentials.ts` 不再为这段配置读取导入 `@gyoungwe/pi-research/host`。共享层 2 项新回归、backend/shared typecheck、Biome 及 Zotero Web 凭据 3 项回归通过；Zotero 状态/机构访问等其余 host 适配仍未迁移，P3 继续保持部分完成。
- P4 依赖收窄切片：`diagnosticText` 从 `@drone/tasks` 迁入 `@drone/shared`，tasks 保留同名 re-export 以保持既有调用方 API；backend diagnostics 改为只依赖 shared。shared/tasks/backend typecheck 与 8 项 diagnostics/failure-feedback 回归通过。任务状态机、workbench 运行时和宿主对 tasks 的其余装配仍未迁移。
- 首次全量 `npm test` 复跑暴露两个 knowledge fixture 问题：独立 UI 测试未显式配置 host seam，worker 测试的独立模块图未注入已校验 metadata。`aa1d63d6` 修正测试夹具后，干净 `npm ci` 下全量 `npm test` 通过：backend 252 文件、desktop 165 文件/903 项及其他 workspace、脚本检查全部通过。
- 插件 P5/P6 `4467782` 为 `pi-analysis` 与 `pi-evidence` clean-install smoke 增加声明一致性校验：安装后的 capabilities、host entry、`manifest.tools` 必须与真实 Pi loader 注册工具一致；analysis 3 工具、evidence 4 只读工具均通过。正式 GUI、零插件安装包和完整领域迁移仍未完成。
- 插件 `a69a2b8` 为 `pi-research@0.3.0` 增加只读 `detail` host operation（summary/route/timeline/sources/claims/warnings/archive），同步 dist、manifest、desktop runtime、smoke 与测试；pi-research typecheck、build:check、26 files/136 tests、locked Pi 1.1.0/latest 1.4.0 SDK smoke 通过。Zotero 写入、完整页面和正式 GUI 仍未完成。
- `DRONE_PLUGIN_API_TARBALL=/tmp/gyoungwe-plugin-api-1.3.0.tgz npm run check`（插件分支 `a69a2b8` 后）最终退出码 `0`：8 manifests、知识 487 tests、研究 136 tests、analysis/evidence/connectors/workbench/UI checks、research-suite PDF/clean-prefix smoke、locked/latest SDK matrix 与 pack checks 全部通过；research-suite clean-prefix receipt 为 4 extensions/22 tools、tarball SHA-256 `8928930e79fa19b6bc2eadbdaad8376ff72638ec214c27d2b15b94e393b065ee`，候选 Plugin API 1.3.0 SHA-256 `0916b3c5822548189ee1b3d7c28554cb459714a469074aef779021ae8191a027`。正式 GUI 仍 `NOT_RUN`，候选 API 未发布。
- 最新宿主合并后门禁（提交 `5ac56510`、`ada749a4`、`369f7c58` 后）以 `/tmp/drone-host-final-gates.log` 收口：`npm run lint`、`npm run typecheck`、`npm test`、`npm run build`、`npm run check:arch` 均退出码 0；lint 仅保留既有 2 MiB 设计稿 warning，`check:arch` 报告 0 baseline finding、宿主独立性通过。`npm run check:native-plugin-boundary` 仍为 `INCOMPLETE`（domain-runtime-import 30，其他领域依赖/资源计数仍非零），按计划不改写为 PASS。
- 最新宿主五门禁（`1616ce6b`、`ca97c1e2`、`70b9df71`、`4d8ad3e5` 后）再次退出码 0：`lint`、`typecheck`、`npm test`、`build`、`check:arch` 均通过；`check:arch` 同时报告 `check-host-domain-dependencies` 为 `PARTIAL`，列出仍被跟踪的 `@drone/research`、`@drone/tasks`、`@gyoungwe/pi-core`、`@gyoungwe/pi-knowledge`、`@gyoungwe/pi-research`，没有把迁移未完成误报为清零。生成的 `packages/pi-core/build-manifest.json` 已恢复到提交值。
- 最新宿主五门禁（`cc10cec3`、`d0df0d95`、`e4bc4410`、`62c90eff` 后）再次退出码 0（`/tmp/drone-host-final-gates-4.log`）：`lint`、`typecheck`、`npm test`、`build`、`check:arch` 全部通过；`check:arch` 保持 architecture 0 baseline finding、host independence PASS，并明确输出 domain dependency gate `PARTIAL`。生成的 `packages/pi-core/build-manifest.json` 已恢复到提交值。
- 最新宿主五门禁（`88f4fc5e`、`b7cd8b52`、`19046ea0`、`8485a4cf` 后）再次退出码 0（`/tmp/drone-host-final-gates-5.log`）：五项命令全部通过，`check:arch` 仍明确输出 tracked runtime dependencies `PARTIAL`。`check:native-plugin-boundary` 当前计数为 domain-runtime-import 18、domain-type-import 20，整体仍 `INCOMPLETE`；生成的 `packages/pi-core/build-manifest.json` 已恢复到提交值。
- 最新宿主五门禁（`9dca6574`、`5899f8fc`、`d2b018c6`、`0e7fb736` 后）再次退出码 0（`/tmp/drone-host-final-gates-6.log`）：五项命令全部通过，`check:arch` 保持 architecture/host independence PASS 与 domain dependency `PARTIAL`。`check:native-plugin-boundary` 的 domain-runtime-import 已降至 15，但总体仍 `INCOMPLETE`；生成的 `packages/pi-core/build-manifest.json` 已恢复到提交值。
- 最新宿主五门禁（`207c3a0c`、`2755c85c`、`d39159d3`、`30857e31` 后）最终退出码 0（`/tmp/drone-host-final-gates-8.log`）；首次复跑的 channel-watch 单测时序波动已单独重跑 20/20 通过，第二次完整 `npm test` 全部通过。`check:arch` 保持 architecture/host independence PASS 与 domain dependency `PARTIAL`；native boundary runtime-import 已降至 13，整体仍 `INCOMPLETE`。生成的 `packages/pi-core/build-manifest.json` 已恢复到提交值。
- 最新宿主五门禁（`3f9ef839`、`58cb5c8f` 后）最终退出码 0（`/tmp/drone-host-final-gates-9.log`）：`lint`、`typecheck`、`npm test`、`build`、`check:arch` 全部通过；`check:arch` 保持 architecture/host independence PASS 与 domain dependency `PARTIAL`，native boundary runtime-import 已降至 12，整体仍 `INCOMPLETE`。生成的 `packages/pi-core/build-manifest.json` 已恢复到提交值。
- 最新宿主五门禁（`837d1594`、`ad00d14c`、`ae3434dd`、`67543fbf`、`c2b4c95f`、`6043b667` 后）复跑全部通过：`npm run lint`、`npm run typecheck`、`npm test`（254 个 backend 文件/2049 项通过、18 项跳过；desktop 165 个文件/903 项通过）、`npm run build`、`npm run check:arch` 均退出码 0；最新 `check:native-plugin-boundary` 仍为 `INCOMPLETE`，domain-runtime-import 11、domain-type-import 14，compat 组合仍是保留的迁移依赖，生成的 `packages/pi-core/build-manifest.json` 已恢复到提交值。
- 宿主 `bcbc4e07` 将根 devDependency 对齐到 `plugins.lock.json` 与公开版本（`pi-knowledge@0.2.1`、`pi-research@0.2.0`）；干净 `npm ci` 后 `npm ls` 无版本漂移，随后 `aa1d63d6` 的夹具修复使全量测试恢复通过。
- P6/P7 lifecycle guard：`packages/backend/test/packages-lifecycle.test.ts` 新增卸载无变化与更新失败回归。包管理器返回未安装或 registry 不可用时，回执保持 `failed`、不写入 `disabled`/新版本、不触发会话 reload；该切片验证了失败状态的可观察性，但不替代正式 DMG 的零插件、升级/回滚或销毁失败验收。
- 2026-10-27：`0fadba87` 后的宿主完整门禁收口于 `/tmp/drone-host-final-gates-10.log`：`npm run lint`、`npm run typecheck`、`npm test`、`npm run build`、`npm run check:arch` 全部退出码 0；pi-core host entry 的 12 项测试与 backend project-memory 2 项回归通过。插件仓库在候选 API tarball `DRONE_PLUGIN_API_TARBALL=/tmp/gyoungwe-plugin-api-1.3.0.tgz` 下完整 `npm run check` 退出码 0，研究包 26 文件/136 项测试、clean install/SDK matrix/pack checks 通过。`check:native-plugin-boundary` 仍为 `INCOMPLETE`（runtime-import 11）；P2–P7、正式 GUI 与四项外部验收保持未完成。
- 2026-10-27：`0e84aec3`/`4b419af0` 后再次完成宿主五项门禁，日志见 `/tmp/drone-host-final-gates-11.log`，全部退出码 0；backend typecheck 已覆盖 connector registry 的完整 shared response 合同。`check:arch` 仍为 architecture 0 baseline finding、host independence PASS、domain dependency `PARTIAL`。边界门禁继续为 `INCOMPLETE`（runtime-import 11），compat composition、完整领域删除和正式安装包验收仍未关闭。
- 2026-10-27：`880ebc08` 后宿主五项门禁再次全部通过，日志见 `/tmp/drone-host-final-gates-12.log`；插件依赖重新拉取、全量测试与 build 均成功，`check:arch` 保持 architecture 0 baseline finding、host independence PASS、domain dependency `PARTIAL`。边界门禁为 `INCOMPLETE`（runtime-import 11、type-import 13），研究兼容组合及 P2–P7 完整迁移仍未完成。
- 2026-10-27：`042c44ff` 后宿主五项门禁再次全部通过，日志见 `/tmp/drone-host-final-gates-13.log`；pi-core host 工具 bundle、backend 工具门面和完整宿主 build 均通过，生成的 build manifest 保持提交态。`check:arch` 仍为 architecture/host independence PASS、domain dependency `PARTIAL`；native boundary 仍 `INCOMPLETE`（runtime-import 11、type-import 13）。

## 未关闭项

本轮仍未证明：P2–P5 宿主领域装配删除；无领域插件的正式 DMG 启动与升级/停用/回滚；同一候选 tarball 的正式安装包 GUI；真实 Zotero/用户 MCP/Protocols.io 写入及其他平台验收。`check:native-plugin-boundary` 仍按计划输出 `INCOMPLETE`，不得改写为 PASS。

