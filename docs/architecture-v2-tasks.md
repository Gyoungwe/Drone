# 架构升级 v2 · 任务拆解

> 配套：[architecture-v2.md](architecture-v2.md)。本文面向执行者（人或编码 Agent，如 Codex / Claude Code）。
> 每个任务都应该能在**一个 PR** 里完成；按顺序执行；完成一项勾选一项，并在文末执行日志里记一行。
> 当前产品决定（2026-10-16）：LAN observer/remote-control 已移除；以下旧 LAN 条目保留为历史迁移记录，不再代表当前产品表面。

## 通用规则（每个 PR 都适用）

- **完成标准（DoD）**：`npm run lint && npm run typecheck && npm test && npm run build` 全部通过；A0-2 之后再加 `node scripts/check-architecture.mjs`。涉及打包资源的 PR 还要跑 `node scripts/check-knowledge-package.mjs` 和 `npm run test:upgrade`。
- **不变量**：architecture-v2.md §5 的 8 条，任何一条都不能为了让测试通过而放松。如果发现必须改变行为，就停下来，另开 issue。
- **不改用户数据格式**；不提交凭据、Vault、会话或 `results/`。
- 纯结构改动的 PR 不能同时混入行为改动。移动文件和修改文件内容分成两个提交，方便 review 看 diff。
- 改动了文件位置或职责，要同步更新 `docs/INDEX.md`；新踩的坑记到 `docs/PITFALLS.md`。
- 新增 UI 文案时，`i18n/zh.ts` 和 `en.ts` 都要加。

---

## A0 · 治理基线

- [x] **A0-1 公开 AGENTS.md**
  - 从 `.gitignore` 移除 `AGENTS.md`，新建一份公开版：硬约束（复制 `docs/INDEX.md` 的"硬约束"一节）、常用命令、分层规则 R1–R6、DoD、本任务文档的入口。私有发版流程继续留在 `.local/docs/release.md`，公开版只写"见本地文档"。
  - 验收：`git check-ignore AGENTS.md` 无输出；文件里不含任何本机路径或凭据。
- [x] **A0-2 架构检查脚本（ratchet）**
  - 新建 `scripts/check-architecture.mjs`：扫描 `packages/**`、`.pi/**`（排除 node_modules、dist、测试 fixtures），检查 R1–R6。当前的违规项写进 `scripts/fixtures/architecture-baseline.json`；**新增违规让脚本失败，违规减少时提示更新基线**。
  - 加入根 `package.json`：`"check:arch": "node scripts/check-architecture.mjs"`；CI `check` job 在 typecheck 之后运行。
  - 验收：在当前代码上退出码为 0；人为在 renderer 里加一行 `import "@earendil-works/pi-coding-agent"` 时退出码为 1，并指出文件和规则编号（为此写一个单测）。
- [x] **A0-3 测试分层**
  - backend 的 `vitest.config.ts` 改用 `projects`：`unit`（排除 `*-sdk.test.*` 和会构造真实 `PiBackend` 或 `AgentSession` 的用例）和 `sdk`。新增 `npm run test:unit` 和 `npm run test:sdk`；`npm test` 仍然跑全部。
  - CI 拆成并行 job：`static`（lint/typecheck/arch）、`unit`、`sdk`、`desktop`，Windows 矩阵保留。
  - 验收：`test:unit` 与 `test:sdk` 的用例数之和等于拆分前的总数（1,320 + 13 skipped）；把 `test:unit` 的耗时记进执行日志。
- [x] **A0-4 遗留死路径**
  - 调查 `.pi/lib/vault-mcp-proxy.mjs`（它 import 的 `vendor/pi-web-ui/…` 不存在）和 `obsidian-workbench.mjs:696,726` 对它的引用：确认是否有迁移路径会生成指向它的用户 MCP 配置。
  - 确认没有：删除该文件，把引用改成"识别旧配置 → 提示用户移除"。确认有：保留识别逻辑，但不再 import vendor。
  - 验收：`grep -rn "vendor/pi-web-ui" .pi packages` 无结果；相关的 obsidian 测试通过。

## A1 · `.pi/lib` 类型护栏

- [x] **A1-1 checkJs 基础设施**
  - 新增 `.pi/tsconfig.json`（`allowJs`、`checkJs`、`noEmit`、`strict: false` 起步，`include` 按白名单逐步扩大）；根 `typecheck` 加一步 `tsc -p .pi`。
  - 新建 `packages/shared/src/runtime.ts`：为现有的 10 个 `Symbol.for("drone.*")` 桥对象各写一个 TS 接口，并导出 key 常量；backend 侧的 `session/knowledge-publication.ts` 和 `tools/manifest.ts` 改为引用这些接口。
  - 验收：`tsc -p .pi` 在白名单（至少 `knowledge/publication.mjs`、`tool-manifest.mjs`、`tasks/acceptance.mjs`）上通过。
- [x] **A1-2 消除手工镜像常量**
  - `shared/src/task-workbench.ts` 里镜像 `REASON_TEXT` 这类常量，改为 shared 作为唯一来源，`.mjs` 从 `@drone/shared` 的构建产物 import；如果 CLI 路径做不到，就加一个一致性测试来断言两边相同。
  - 验收：`grep -rn "Mirrors \`.pi/lib" packages` 无结果，或每一处都有对应的一致性测试。
- [x] **A1-3 扩大白名单**：knowledge、tasks 全部 `.mjs` 纳入 checkJs（允许 `// @ts-expect-error` 并注明原因）。验收：白名单覆盖 `.pi/lib/knowledge/*` 和 `.pi/lib/tasks/*`。

## A2 · Host API 契约

- [x] **A2-1 契约框架**
  - `shared/src/host-api/define.ts`：`defineDomain(name, { methods, events })`。method 包含 `args`（typebox Tuple）、`result`、`access`（`desktop`，默认 `desktop`）。提供 `channelOf(domain, method)`、类型推导工具 `ClientOf<Contract>`。
  - `desktop/src/main/ipc/bind-contract.ts`：`bindContract(contract, impl)` → 用 `ipcMain.handle` 注册；入参 `Value.Check` 不通过时返回结构化的 `UiError`（code `invalid_arguments`，不回显敏感参数）；开发模式下还校验 result。
  - preload：`exposeContract(contract)` 生成 invoke 和 on* 订阅。
  - 验收：单测覆盖参数合法、参数非法、result 不符（开发模式）、事件订阅与退订四种情况。
- [x] **A2-2 迁移 sessions 域**：`SessionsContract` 替代 `INVOKE_ROUTES` 里 sessions 部分和对应的 `registerInvokers` 调用；`PiApi` 里这部分类型改由契约推导。验收：renderer 无需改动调用点（方法名不变），通过 typecheck；`scripts/check-report-ui.mjs` 通过。
- [x] **A2-3 迁移其余域**：settings、permissions、packages、app、ui-plugins、knowledge、institutional、subagents，每个域一个提交。全部迁完后删除 `INVOKE_ROUTES`，`IpcChannels` 改由契约生成。验收：`grep -c "ipcMain.handle(" packages/desktop/src/main` 只剩 `bind-contract.ts` 以及少数有文档说明的例外。
  - [x] ui-plugins：配置、列表、读码、启停、槽位指派、重建、打开目录均通过 `UiPluginsContract` + `bindContract` 注册；保留既有通道名与 renderer 调用形状。
  - [x] institutional：状态、配置、登录窗口、URL 打开、会话清理、访问测试均通过 `InstitutionalContract` + `bindContract` 注册；保留既有通道名、返回形状与主 frame 安全校验。
  - [x] subagents：面板列表、派发、中止与运行记录均通过 `SubagentsContract` + `bindContract` 注册；保留既有 `subagents:*` 通道、renderer 调用形状，并为运行记录增加严格 TypeBox 校验。
- [x] **A2-4 桌面契约收口**：LAN observer 已移除（2026-10-16），删除 `shared/lan.ts`、`host-api/lan.ts`、backend `lan/`、main/preload/renderer 接线、HTTP/SSE 资源和对应测试；Host API 访问级别收敛为 `desktop`。
- [x] **A2-5 插件 Host API 清单化**：`renderer/src/plugins/host-api.manifest.json` 为唯一生成来源，`host-api.manifest.ts` 提供 renderer 运行时导入；`packages/desktop/scripts/gen-plugin-api.mjs` 生成 `host-api.ts`、`env.d.ts`、main/ui-plugins/build.ts 的 SHIM、`resources/ui-plugins/drone-ui.d.ts` 标记区，保留投影文件中的宿主实现与其他声明。`--check` 与 `gen-plugin-api.test.ts` 防止名称、类型和生成结果漂移。

## A3 · 拆分 PiBackend

- [x] **A3-1 组合根**：新增 `backend/src/create-backend.ts`，返回 `BackendServices`；`PiBackend` 的构造函数内部改为调用它（行为不变）。
- [x] **A3-2 按域抽服务**（每个域一个 PR，顺序：approvals → permissions/trust → models/settings → mcp/packages → subagents → knowledge/zotero/institutional）：把方法移到 `services/<domain>.ts`，`PiBackend` 上保留委托方法并加 `@deprecated`。验收：每个服务 ≤ 400 行；原有测试不改就通过；新增的服务级单测可以不构造 `PiBackend`。
  - [x] packages：`PackageService` 已从 `PiBackend` 门面抽出，包目录访问与安装/卸载/热重载集中在 `src/services/packages.ts`；`BackendServices.packages` 暴露同一实例，门面方法保留兼容委托。
  - [x] permissions/settings：`PermissionSettingsService` 已从 `PiBackend` 门面抽出，`permissions.json` 快照、原子保存、恢复默认、规则试算和审计尾部集中在 `src/services/permissions.ts`；`BackendServices.permissions` 暴露同一实例，旧方法保留兼容委托并有服务级单测。
  - [x] project-trust：`ProjectTrustService` 承接 `ProjectTrustStore` 与 `TrustGate` 的同一生命周期；项目资源加载、信任应答和销毁均经 `PiBackend.projectTrust` 委托，`BackendServices.projectTrust` 暴露同一实例；服务级 2/2 与组合根回归 1/1 通过。
  - [x] approvals：`ApprovalService` 承接 per-session `PermissionGate` 注册表、待决请求快照、请求/裁决事件广播与 allowRun 队列裁决；`BackendServices.approvals` 与 `PiBackend.approvals` 指向同一实例，旧 `onPermission*`/`respondPermission` 委托保持兼容；服务级 2/2、组合根回归 2/2 与权限回归 40/40 通过。
  - [x] zotero：`ZoteroService` 已从 `PiBackend` 门面抽出，Knowledge IPC 优先使用 `BackendServices.zotero`，旧委托保留兼容。
  - [x] institutional / subagents：机构访问状态与会话子代理面板服务已从 `PiBackend` 暴露为组合根端口，desktop IPC 生产路径优先直接消费端口。
  - [x] mcp / settings / models / login：MCP 重载边界、provider 设置、模型偏好和交互登录均通过 `BackendServices` 端口提供，desktop IPC 保留兼容 fallback。
  - [x] knowledge / sessions：知识 UI 与 Zotero 服务端口已接入组合根；sessions IPC 直接绑定组合根的 session service。
- [x] **A3-3 SessionEngine**：会话生命周期部分移到 `session-engine/engine.ts`，`buildExtensionFactories`、`buildCustomTools` 移到 `session-engine/extensions.ts`；生产 Pi SDK 运行时 import 只允许出现在 `session-engine/**`，测试文件保留直接 SDK import 以覆盖 SDK 分层；R1 生产基线已清零。
- [x] **A3-4 删除门面**：desktop main 和契约绑定直接使用 `BackendServices`；会话实现移到 `session-service.ts`，`pi-backend.ts` 只保留一版本兼容 value/type re-export。验收：`check:arch` 的 R1 基线清零，`pi-backend.ts` 仅含兼容导出；旧导入仍由别名保持可用。

## A4 · EventPipeline

- [x] **A4-1**：新建 `session-engine/event-pipeline.ts`，定义 `Stage` 接口（含 `failMode`），把 `emitEvent` 里的 slim、stream-guard、publication 投影、trace、fanout 改写成阶段列表。
- [x] **A4-2**：desktop IPC、子代理面板、历史回放（`getSessionMessages`、`peek*`）统一从 fanout 或同一个 `projectSnapshot` 取数据。
- [x] **A4-3 表驱动测试**：覆盖阶段顺序；publication 抛异常 → 失败关闭；trace 抛异常 → 放行并记日志；stream-guard 熔断 → 后续增量丢弃。验收：已有的 `event-slim`、`stream-guard*`、`knowledge-publication-*`、`trace` 测试不改就通过。

## A5 · 领域包 TS 化（风险最高，放在最后做）

先定好打包策略：新建 `packages/extensions`（`@drone/extensions`），用 esbuild 把每个扩展入口打包成**自包含的** `.pi/extensions/<name>.mjs`，文件名与现有的一一对应；`.pi/lib` 最终不再需要作为运行时资源分发。

- [x] **A5-0 打包管线**：`npm run build:extensions` 从 `packages/extensions/src/*.ts` 输出 `.pi/extensions/*.mjs`；`electron-builder.yml` 复制自包含扩展和 `workbench-manifest.json`。`.pi/lib` 兼容树已在 A5-4 清零，CLI 用户 `git clone` 后直接可用，CI 检查产物和源码一致。
  - 验收：先用一个最小扩展（`subagent-research`）走通全流程；`check-knowledge-package.mjs`、`check-research-packaging.cjs` 通过；在 CLI 模式下 `.pi/settings.json` 能加载。
- [x] **A5-1 @drone/knowledge**：领域实现、worker 和 specialist host 已由 `@drone/knowledge` / `@drone/extensions` 承载，生产路径不再依赖 `.pi/lib/knowledge`；knowledge 回归、worker/runtime、benchmark 和包检查通过。
  - [x] claim-conflicts：新增 `@drone/knowledge` TS 包入口与强类型 `compareClaims` / `compareClaimSets`，包内 3 个测试及后端迁移测试 3 个通过；`.pi/lib/knowledge/claim-conflicts.mjs` 暂作运行时兼容实现。
  - [x] orchestration-policy：新增 `@drone/knowledge` TS 包入口与强类型 `specialistRequestSignature` / `decideSpecialistRun` / `createSpecialistBudget`，包内 3/3 与后端 knowledge orchestration/stress 13/13 通过；`.pi/lib/knowledge/orchestration-policy.mjs` 暂作运行时兼容实现。
  - [x] review-policy：新增 `@drone/knowledge` TS 包入口与强类型 `readReviewMode` / `saveReviewMode` / `advisoryCodes`，包内 4/4 与 backend `knowledge-automatic-review` 4/4 通过；`.pi/lib/knowledge/review-policy.mjs` 暂作运行时兼容实现。
  - [x] source-links：新增 `@drone/knowledge` TS 包入口与强类型 `onlineSourceLink` / `normalizeSourceLinks`，包内 4/4 与 backend `knowledge-delivery-round2`、`zotero-literature` 合计 26/26 通过；`.pi/lib/knowledge/source-links.mjs` 暂作运行时兼容实现。
  - [x] flow-cards：新增 `@drone/knowledge` TS 包入口与强类型回执卡构造器，包内 3/3 通过；`.pi/lib/knowledge/flow-cards.mjs` 暂作扩展运行时兼容实现。
  - [x] files：新增 `@drone/knowledge/files` 安全文件读取入口，迁移 Vault 相对路径校验、软链接拒绝、1 MiB 上限、稳定哈希与 bounded snippet；包内 6/6 通过；`.pi/lib/knowledge/files.mjs` 暂作运行时兼容实现。
  - [x] layout：新增 `@drone/knowledge/layout`，迁移安全 Vault containment、create-only 初始化、managed navigation 更新与项目上下文模板；包内 7 项定向测试，knowledge 包回归 53/53 通过；`.pi/lib/knowledge/layout.mjs` 暂作运行时兼容实现。
  - [x] wiki-policy：新增 `@drone/knowledge/wiki-policy`，迁移 Wiki 目标/来源约束、managed block、静态 explainer 与 proposal hash；包内 5 项测试通过；`.pi/lib/knowledge/wiki-review.mjs` 与 `wiki-model-review.mjs` 暂作运行时兼容实现。
  - [x] runtime/service/worker：`service.ts`、`worker.ts`、`maintenance.ts`、`ui-service.ts`、`specialist-host.ts`、`topic-memory.ts` 与 runtime host 已迁入 TS；knowledge 包与 worker/runtime 检查通过，`.pi/lib/knowledge` 已删除。
  - [x] 2026-10-18 最终清理：删除 `.pi/lib/knowledge`，`@drone/extensions` worker 只解析 package-owned 产物；knowledge 307、extensions 19、runtime/strict/architecture 检查通过。
- [x] **A5-2 @drone/tasks**：任务授权、进度、验收器、PDF worker 与 runtime bridge 由 `@drone/tasks` 和 `pi-core` 独占；所有 `task-*` 回归通过，`.pi/lib/tasks` 已删除。
  - [x] failure-feedback：新增 `@drone/tasks` TS 包入口与强类型 `diagnosticText` / `toolResultFailed` / `failureObservation` / `failureContext` 等纯函数；包内 4/4 测试及 backend `task-failure-feedback` 20/20 测试通过，backend diagnostics 复用该脱敏入口；`.pi/lib/tasks/failure-feedback.mjs` 暂作运行时兼容实现。
  - [x] single-flight：新增 `@drone/tasks` TS 包入口与强类型 `singleFlightCommand`，包内 3/3 与 backend `task-command-single-flight` 4/4 通过；`.pi/lib/tasks/single-flight.mjs` 暂作运行时兼容实现。
  - [x] turn-end-prompt：新增 `@drone/tasks` TS 包入口与强类型 `shouldAskToContinue`，包内 3/3 与 backend `task-one-authorization-flow` 4/4 通过；`.pi/lib/tasks/turn-end-prompt.mjs` 暂作运行时兼容实现。
  - [x] tool-protocol：新增 `@drone/tasks` TS 包入口与强类型 `restoreTaskToolOrder`，包内 9/9 与 backend `task-tool-protocol` 9/9 通过；`.pi/lib/tasks/tool-protocol.mjs` 暂作运行时兼容实现。
  - [x] consent / remaining：新增 `@drone/tasks` TS 包入口与强类型任务授权、剩余进度解释策略；包内测试和 backend `task-consent` / `task-progress` 回归通过；旧 `.pi` 文件暂作运行时兼容实现。
  - [x] evidence：新增 `@drone/tasks/evidence` TypeScript 状态机，`.pi/lib/tasks/evidence.mjs` 仅保留宿主 inspector 适配；包内 5/5 与 backend `task-workbench` 30/30 通过。
  - [x] authorization-policy：新增 `@drone/tasks/authorization-policy` 纯授权卡策略入口，包内 6 项测试通过；`.pi/lib/tasks/ask-authorization.mjs` 暂作运行时兼容实现。
  - [x] pdf-identity：新增 `@drone/tasks/pdf-identity` 宿主注入 worker 边界，含 30 秒跨平台超时、AbortSignal 清理、页数/文本上限与稳定错误码；包内 43/43 通过；`.pi/lib/tasks/pdf-identity.mjs` 暂作 CLI worker 适配器。
  - [x] acceptance-policy：新增 `@drone/tasks/acceptance-policy`，迁移验收器注册、schema live refs、结果归一化和说明投影；包内 49/49 通过；`.pi/lib/tasks/acceptance.mjs` 仍负责 Pi 事件桥接。
  - [x] runtime：`src/runtime/*.ts` 与 checked-in `src/runtime-compiled/*.mjs` 承载 workbench、register、acceptance、授权、PDF worker、tool manifest 和 runtime bridge；`npm run build:tasks` 只执行旧目录清理护栏，tasks 包 58 项通过，`.pi/lib/tasks` 已删除。
  - [x] 2026-10-18 最终清理：backend acceptance event bridge 在 `DroneRuntime` scope 内调用 package registry；`.pi/lib/tasks` 自包含兼容图删除，tasks runtime check、backend acceptance、Desktop build 通过。
- [x] **A5-3 @drone/research**：source archive、open access、Zotero、institutional access、literature operations、provenance 和 receipt journal 由 `@drone/research` 及其宿主端口承载；相关回归通过，`.pi/lib` research 兼容入口已删除。
  - [x] run-provenance：新增 `@drone/research/run-provenance`，执行回执、文件快照、范围/凭据校验和 QC 边界迁移到 TS；包内 5/5，backend 回归 4/4；`.pi/lib/run-provenance.mjs` 保持自包含兼容入口。
  - [x] evidence-gate：新增 `@drone/research/evidence-gate`，迁移证据阶段单调推进、失败终态与 answerable 断言；research 包 37/37 通过；`.pi/lib/evidence-gate.mjs` 暂作运行时兼容入口。
  - [x] source-archive-policy：新增 `@drone/research/source-archive-policy`，迁移 run 目录、文件名、挑战页、magic bytes、内容类型与元数据门禁；包内 5 项测试与 typecheck 通过；`.pi/lib/source-archive.mjs` 仍保留下载/写入运行时适配。
  - [x] receipt-journal-policy：新增 `@drone/research/receipt-journal-policy`，迁移核心工具准入、错误工具过滤、256 容量去重回执缓冲与 run_dir 归属判定；research 包回归 46/46 通过；`.pi/lib/research-receipt-journal.mjs` 仍保留宿主 journal 适配。
  - [x] runtime：source archive、receipt journal、research loop、Zotero setup/reconcile/write 与 institutional host runtime 已迁入 `@drone/research`，由 typed host ports 提供 workspace/filesystem/CLI 适配；research 包 93 项通过，旧兼容入口已删除。
  - [x] 2026-10-18 最终清理：research host ports、extensions typecheck/strict、runtime check 和 research 93 项通过；`.pi/lib` research/CLI 兼容入口删除。
- [x] **A5-4 扩展适配层**：`.pi/extensions/*.mjs` 的源码移到 `packages/extensions/src/`，只保留参数映射和注册逻辑，领域逻辑全部调用领域包；`workbench-manifest.json` 与扩展一起打包，`.pi/lib` 已从仓库和 `electron-builder.yml` extraResources 移除。R5、Desktop artifact 和 CLI smoke 通过。
  - [x] 正式入口：`obsidian-workbench`、`source-archive`、`zotero-literature`、`subagent-mcp-readonly` 已迁入 TypeScript 源码并由 `build:extensions` 生成；兼容 `research-host` 仅转发宿主端口，不再作为独立扩展产物；manifest 已无 legacy outputs。
  - [x] 2026-10-18 最终资源收口：`.pi/lib` 不再存在，Desktop 仅复制 `.pi/extensions` 与 package-owned Pi resources；manifest 路径和 capability footprint 检查同步更新。

## A6 · DroneRuntime 注入

- [x] **A6-1**：在 `shared/src/runtime.ts` 定义 `DroneRuntime` 接口；`create-backend.ts` 构造实现，第一方扩展改为内联工厂并注入 runtime（桌面模式）；`@drone/extensions` 的入口在 CLI 模式下调用 `createStandaloneRuntime()`。
- [x] **A6-2**：逐个替换 10 个 `Symbol.for("drone.*")`：锁和队列类（`wiki-review-locks`、`topic-memory-queues`、`semantic-lock`）统一换成 `runtime.scheduler`（带 dispose）；单例类（worker-pool、binding、ui、specialists）改由 runtime 持有；`tool-manifest`、`acceptance-verifiers` 改为通过 `pi.events` 的版本化注册事件收集。
- [x] **A6-3**：`knowledge-publication.ts` 改为从 runtime 取投影器；`failClosedEvent` 保留，只作为抛异常时的兜底。验收：R4 基线清零；`knowledge-publication-fallback.test.ts` 改为覆盖"投影器抛异常"场景并通过；测试可以在同一进程里创建两个互不干扰的 runtime（新增测试）。

## A7 · StorageRegistry 与诊断

- [x] **A7-1**：新建 `backend/src/storage/registry.ts`，登记所有落盘状态（逐个排查 `JsonStore` 的使用点、userData、`DRONE_KNOWLEDGE_DIR`、traces、审计、会话 jsonl、机构会话分区），字段包括 id、path、owner、schema、migrate、sensitivity。验收：新增测试断言：凡是用到 `JsonStore` 的地方都能在注册表里找到对应条目（静态扫描或运行时断言皆可）。
- [x] **A7-2 诊断包**：新增 `app:diagnostics` 契约方法和设置 → 关于页的"导出诊断包"（i18n 双语）。内容：版本、平台、各存储的 schema 与损坏状态、最近的 incident 快照、日志尾部（脱敏）。**不含**凭据、auth.json 内容、Vault 正文、会话正文。导出使用无第三方依赖的 ZIP（`diagnostics.json` + `README.txt`），并通过现有保存对话框写入二进制；脱敏、ZIP 内容与保存桥接均有自动化测试覆盖。

---

## B5 · 研究状态、元认知与工作流修复

- [x] **B5a 研究状态基础**：新增 `@drone/inquiry` 领域包，提供 artifact、finding、question/prior、attempt 和 agent decision 五本账、自动 lineage 校验、workspace run/result 晋升与 cleanup dry-run；SQLite `SqliteInquiryStorage` 使用独立表、事务、WAL/FULL 同步和 project 隔离；backend 组合根通过 `InquiryService` 注入并登记 `ledger.sqlite`。
- [x] **B5b 元认知发布门禁**：publication projection 在发布前核对报告数字、引用产物校验和、方法与实际工作流/模块/参数、finding 标签及诊断漂移，并拦截实际引用的待复核产物；不一致时失败关闭，并把通过的 finding 投影为可引用证据。
- [x] **B5c 工作流编排与有限修复**：`WorkflowSpec` 先验与模块注册门禁、编译/type-check/preview、失败与负结果检索、最多三次声明式自主修复；重复失败阻断，并记录“我替你决定的”变更。
- [x] **B5d–B5f**：`@drone/discovery` 提供容器能力门控的 KernelSession、runs-only 导出、探索预算/先验与竞争解释、独立只读 critic、多路径稳健性记录，以及带数据集版本和基线的 BixBench/重新发现/不一致拦截/混杂发现/线索命中/核验耗时/重复失败评测；缺外部数据返回 `needs-data`，执行器失败返回 `blocked`。
- [x] **B7**：`@drone/compute` 与 `@drone/shared` 提供内容寻址数据集、样本表与设计矩阵校验、受控公共数据抓取、分析计划/功效与最小可检测效应、偏离复核和确定性 RO-Crate 清单；校验失败在提交前阻断并保留可追溯记录。
- [ ] **B8**：团队协作能力，按用户要求暂不实施。

---

## C1 · RunAttempt / causation lineage

设计和当前代码基线：[run-attempt-causality-design.md](superpowers/specs/2026-10-14-run-attempt-causality-design.md)。这一组任务以 v0.32.0 的 `VersionedRecord` / `parentRefs` / content hash 为基线，先做 additive lineage，再接入副作用和证据；不合并领域账本。

- [x] **C1-1 契约**：新增 shared `CausalEnvelope`；研究合同、execution、ask、analysis provenance 增加可选 lineage；hash 排除 lineage；覆盖旧 schema 兼容和安全校验。
- [x] **C1-2 attempt 根**：`AnalysisTaskController.prepareCompute` 创建 attempt 根和 binding lineage；analysis ledger 双读兼容，fork 不继承 execution binding。
- [x] **C1-3 副作用回执**：`ExecutionReceipt`、`ComputeTaskBinding`、compute `JobSpec` / `SubmissionRecord` 和 direct scheduler 传播 lineage；unknown 只 reconcile。
- [x] **C1-4 intent/evidence**：intent journal start-before-effect 带 envelope；checkpoint hash 排除 lineage；replay 新建 attempt，branch 不继承授权。
- [x] **C1-5 只读投影**：提供按 attempt/event 的 backend/host 脱敏投影；只有实际需要跨进程展示时才扩展 IPC。
- [x] **C1-6 收尾**：完成旧数据 partial/legacy 兼容、crash/restart/reconcile/retry/branch/hash/capsule 回归和完整 DoD；远程 CI 还需在包含生成物的统一提交上复核。

## P9 · 研究资料浏览器与全科研场景知识闭环

- [x] **P9-1 资料工作台**：新增 `research` 视图，复用 `listProjectFiles`、`previewFile`、`openResourceExternal` 与 `PreviewHost`，支持任意项目文件的检索、预览、源码查看和外部打开；未知二进制只展示元数据。
- [x] **P9-2 捕获 seam**：在 backend/research 提供 `captureResearchResource`，以 `cwd + relativePath + byteHash + sourceReceipt + scope + freshness + approval` 生成待审 `KnowledgeSnapshot`；禁止会话正文、凭据和未授权原文自动进入知识库。
- [x] **P9-3 连接器合同**：统一合同已固定来源、许可（可选）、访问时间、内容哈希、只读标记与失败原因；Crossref/DOI/OpenAlex/PubMed/Europe PMC、Zenodo/OSF/NCBI SRA/ENA、Zotero、Protocols.io（只读）、机构访问和项目存储均已纳入默认连接器清单，并保留 UI 开关与禁用失败回执。Protocols.io 写入 seam 按产品决策显式禁用，不再作为计划门槛；WebDAV 已完成真实可逆闭环。Zotero provider-specific 写入运行时、授权、回读与删除回读已有真实 Desktop local API 证据；机构访问保持只读，不再提出写入门槛。
- [x] **P9-4 验收**：空项目、中文/超长路径、压缩 FASTQ/VCF、BAM 等常见科研格式、无扩展名未知二进制、重复捕获、文件变更、连接器失败和撤回/过期快照均已有可解释状态与定向回归；跨平台 CI 已覆盖共享/后端/桌面构建，自动化证据作为唯一发布门槛。

## P10 · 发布与更新证据（无证书模式）

- [x] **P10-1（策略调整）**：发布流程保留更新 feed、回滚和跨平台验收记录，但产品不要求签名身份、notarization、Windows 签名或证书预检；Release workflow 按无证书构建发布。
- [x] **P10-2**：正式发布不等待 macOS notarization、Windows signing 或证书；v0.32.9 的 macOS arm64/x64 与 Windows x64 无证书安装包、更新 feed、版本切换与回滚证据已齐全，Release workflow 的 validate/build/publish/website 全部成功（run 39007033259）。

---

## 执行日志

> Older execution entries are archived in [architecture-v2-tasks-log-2026-10-19.md](archive/architecture-v2-tasks-log-2026-10-19.md) and [architecture-v2-tasks-log-2026-10-20.md](archive/architecture-v2-tasks-log-2026-10-20.md).

| 2026-10-01 | 全量验收（A3/A5/A6/A7 增量后） | `npm test` 全部通过：backend 1,372 passed + 13 skipped、desktop 556、extensions 16、knowledge 40、research 31、shared 130、tasks 31；`npm run typecheck`、`.pi` checkJs、build、upgrade fixtures、plugin API、extensions strict、架构检查（141 baseline、0 fixed）均通过 | 仍保留 5 个 `.pi/extensions` legacy 适配入口；A5-1/2/3 的运行时 worker、source archive 与剩余扩展仍按兼容层策略逐步迁移 |
| 2026-10-01 | A5-2 增量 | `@drone/tasks` 新增 `authorization-policy` 纯策略入口：动作枚举/待决动作判定、授权请求去重键、ask_user 标题与授权卡正文投影；包测试 37/37、包 typecheck 与 Biome 检查通过；`.pi/lib/tasks/ask-authorization.mjs` 保持 CLI/扩展兼容实现 | backend、desktop 与组合根未改；授权 journal、binding 校验和 UI 仍由宿主运行时负责，A5-2 总项保持未完成 |
| 2026-10-01 | A5-1 增量 | `@drone/knowledge/semantic-provider` 承载语义 provider 配置验证、请求边界、凭据注入与 bounded vector 响应校验；backend `knowledge-semantic` 10/10 改用包入口，knowledge typecheck/40 tests 通过 | `.pi/lib/knowledge/semantic-provider.mjs` 保留 CLI 自包含适配；service/worker 与 extension runtime 仍待整体迁移
| 2026-10-01 | A5-1 增量 | `@drone/knowledge/files` 承载 Vault 相对路径校验、软链接拒绝、读取期间签名一致性、1 MiB 上限和 bounded snippet；包内 6/6 与 typecheck、Biome 通过 | `.pi/lib/knowledge/files.mjs` 仍保留运行时兼容入口；layout、maintenance、service、worker 与 specialist host 尚待迁移 |
| 2026-10-01 | A5-3 增量 | `@drone/research/evidence-gate` 承载证据阶段单调推进、失败终态和 answerable 断言；research 包 11 个文件、37 项测试与 typecheck 通过 | `.pi/lib/evidence-gate.mjs` 仍保留运行时兼容入口；source archive、research receipt journal 与 Zotero 运行时适配器尚待迁移 |
| 2026-10-01 | A5-1 增量 | `@drone/knowledge/layout` 承载安全 Vault 初始化、create-only 文件保护与 managed navigation 更新；knowledge 包回归 53/53、typecheck 与 Biome 通过 | `.pi/lib/knowledge/layout.mjs` 仍保留运行时兼容入口；service、worker、maintenance 与 specialist host 尚待迁移 |
| 2026-10-01 | A5-2 增量 | `@drone/tasks/pdf-identity` 承载隔离 PDF worker 的超时、取消、页数/文本边界与稳定错误码；tasks 包回归 43/43、typecheck 与 Biome 通过 | `.pi/lib/tasks/pdf-identity.mjs` 仍保留 CLI worker 适配器；workbench、acceptance、register 与 runtime 尚待迁移 |
| 2026-10-01 | A5-3 增量 | `@drone/research/source-archive-policy` 承载来源归档的 run 目录、文件名、挑战页、magic bytes、内容类型和元数据策略；5 项测试与 typecheck 通过 | `.pi/lib/source-archive.mjs` 仍负责下载/写入运行时；source archive runtime、receipt journal、Zotero/institutional adapters 尚待迁移 |
| 2026-10-01 | A5-1 / A5-2 / A5-3 增量 | 新增 `@drone/knowledge/wiki-policy`、`@drone/tasks/acceptance-policy`、`@drone/research/receipt-journal-policy` 三个纯策略入口；对应包回归分别扩展到 knowledge 58、tasks 49、research 46；typecheck、Biome 与静态回归通过 | 三个 `.pi` runtime/host adapter 仍保留，A5 总项继续按兼容层策略收敛 |
| 2026-10-01 | 全量回归（layout / PDF / source archive 后） | backend 1,373 passed + 13 skipped、desktop 556、extensions 16、knowledge 53、research 42、shared 130、tasks 43；`npm run lint -- --error-on-warnings`、根 `npm run typecheck`、`npm test`、`npm run build`、`npm run test:upgrade -- --fixtures-only`、`check:extensions --strict`、`check:plugin-api` 与架构检查（140 baseline、0 fixed）全部通过 | A5 的运行时 worker/service、source archive 下载适配、Zotero/institutional 写入适配及 5 个 legacy extension outputs 仍按兼容层策略待迁移 |
| 2026-10-01 | 全量回归（语义、授权、文件与证据切片后） | backend 1,373 passed + 13 skipped、desktop 556、extensions 16、knowledge 46、research 37、shared 130、tasks 37；`npm run lint -- --error-on-warnings`、`npm run typecheck`、`npm test`、`npm run build`、`npm run test:upgrade -- --fixtures-only`、`check:extensions --strict`、`check:plugin-api` 与架构检查（140 baseline、0 fixed）全部通过 | A5 总项仍按兼容层策略逐步迁移：knowledge service/worker、tasks runtime、research source archive/Zotero adapters、5 个 legacy extension outputs 仍待收尾 |
| 2026-10-01 | A6-1 / A6-2 完成 | `DroneRuntime` 已由 shared 契约、backend 组合根和 extensions CLI fallback 统一承载；10 个 `Symbol.for("drone.*")` 运行时桥已清零，锁/队列使用 scheduler，worker/UI/specialist 等资源挂入 host runtime，tool-manifest/acceptance 通过版本化事件桥接；runtime 隔离、dispose、Pi host 回归通过 | Worker 线程内部 activeRequests/flushes/dirty/inflight 仍是 worker 私有状态；无 host 上下文的兼容读取只保留只读模型，不承载执行状态 |
| 2026-10-01 | A5 runtime 收敛 | `@drone/knowledge` 58、`@drone/tasks` 49、`@drone/research` 50、`@drone/extensions` 16 项包级测试通过；knowledge service/worker/UI/specialist、tasks runtime/workbench/register/acceptance/PDF、research source archive/receipt/Zotero/institutional/research-loop 均已有 TS runtime/compiled artifacts。`node scripts/benchmark-knowledge.mjs 20 100`：warm median 1.37 ms / p95 1.87 ms，single update 1.57 ms，publication median 1.16 ms / p95 1.54 ms；semantic benchmark 全部通过。`npm run lint -- --error-on-warnings`、根 typecheck、升级 fixture、`check:extensions --strict`、`check:plugin-api` 与架构检查通过 | backend/SDK 测试和若干宿主仍经 `.pi/lib` compatibility adapters；manifest 保留 4 个 legacy extension outputs，`.pi/lib` 尚未从 extraResources 移除，A5-1/2/3/4 顶层继续保持未完成 |
| 2026-10-01 | 发布前最终回归 | `npm run build:tasks` 生成 17 个无 workspace 依赖的 tasks `.pi` 兼容产物；`npm run lint -- --error-on-warnings`、根 `npm run typecheck`、backend 1,373 passed + 13 skipped、desktop 556、extensions 16、knowledge 58、research 50、shared 130、tasks 49、`npm run build`、`npm run test:upgrade -- --fixtures-only`、`check:extensions --strict`、`check:plugin-api` 与架构检查（120 baseline、0 fixed）通过；`channel-watch-watcher` 定向 4/4 复跑通过 | A5 顶层仍保留 `.pi/lib` host adapters 与 4 个 legacy extension outputs；A5-1/2/3/4 的最终清理不在本批次强行删除 |
| 2026-10-03 | CI 发布护栏 | desktop CI job 新增 knowledge 58、tasks 49、research 50 三个包级测试（共 157 项）；knowledge、tasks、research runtime builder 均支持临时目录构建后 `--check` 字节校验，tasks 兼容产物同步校验；清理 knowledge 目录中 20 个已无引用的旧 chunk；本地 lint、typecheck、build、架构/插件/扩展检查、升级 fixture 与三包测试全部通过 | PiBackend 继续保留兼容门面；backend 测试时长、120 条测试 `.pi` 相对路径架构基线及研究技能包下载依赖仍按后续任务处理 |
| 2026-10-03 | A3-4 / 后续收敛 | `SessionPermissionService` 承接会话权限模式，`SessionLifecycleService` 承接会话枚举、关闭顺序与资源清理；channel-watch 测试注入短 debounce，backend unit 约 24 秒、unit+SDK 约 33 秒；可迁移 backend 测试改用 knowledge/research 包入口，架构基线由 120 降至 106；CI 增加离线研究包门禁，release 在获取 pinned skill packs 后显式运行真实 packaging check；全量 `npm test` 通过（backend 1,378 + 13 skipped、desktop 556、extensions 16、knowledge 58、research 50、shared 130、tasks 49） | `SessionService` 的 create/open/delete 仍与 project resources、extensions、filesystem 强耦合；剩余 106 条是 host/compatibility adapter 测试边界，未放宽架构规则；真实 research packs 仍由 release 同步步骤提供，Academic pack 需显式许可依据 |
| 2026-10-03 | B5a–B5c | `@drone/inquiry` 四本账与 SQLite 持久化、backend `InquiryService` 组合根、B5b 元认知发布门禁、B5c 先验注册与最多三次自主修复已合并；全量 `npm test` 通过，根 typecheck、Biome、架构检查通过 | B5d–B5f、B7、B8 留待后续；研究状态的事件订阅、桌面/桌面只读面板和 host 投影仍需单独接入 |
| 2026-10-03 | B1–B7 收尾 | B1/B2 真实 runner、ssh2/OpenSSH/ProxyJump、known_hosts 与 SFTP/终端/授权 IPC；B3 固定 nf-core/rnaseq 3.18.0 vertical slice、MultiQC/QC/provenance 与显式真实 smoke；B5a 事件宿主接入；B5d–B5f discovery 包；B7 数据/设计合同均已接入并通过本地测试。runner 协议、取消、断线未知态、幂等、产物校验和桌面资源打包路径均已覆盖 | Docker/Slurm fixture 需要本机 Docker daemon；真实 Windows/OTP/跳板机、外部 Slurm 与真实研究数据/基线需在相应环境提供后执行；B8 暂不实施 |
| 2026-10-03 | 后续收尾 | `SessionService` 进一步拆为显式 `SessionHost` 组合根、API/设置/诊断委托、construction/control/events/messages/models/resources/settings-boundary/extensions 专责服务；门面约 400 行、专责服务均 ≤400 行。R5 既有 106 条已迁移到 typed package/extension adapters，架构基线清零；4 个 legacy extension outputs 已替换为正式 source entries，`check:extensions --strict` 无遗留。研究技能包增加锁定缓存、SHA/receipt 校验、原子恢复和离线 release gate；backend unit 约 26 秒、定向 unit+SDK 约 33 秒。 | `PiBackend` 兼容导出、`.pi/lib` 兼容运行时和 A5-1/2/3 的完整移除仍保留一个发布周期；真实 Windows/OTP/外部 Slurm 需正确的 SSH Host 别名和凭据环境后再做 smoke；B8 暂不实施 |
| 2026-10-17 | P9-4 验收覆盖补齐 | ResearchResourceService 新增空项目、中文/超长路径、压缩 FASTQ/VCF、BAM 与无扩展名二进制覆盖；默认连接器清单回归验证 13 个入口唯一且可发现；run 873 的 macOS/Windows 静态、单测、桌面工作区测试和构建全部通过 | P9-4 已关闭，自动化证据是唯一门槛 |
| 2026-10-17 | P9-3 连接器写入验收 | WebDAV 远程认证、临时对象 PUT 201 → DELETE 204 → 最终 GET 404 清理完成；服务端未返回 ETag，强 ETag 闭环门槛保持关闭。Protocols.io 已按产品决策登记为只读，写入 seam 显式 disabled；公开协议读取已验证 | P9-3 仅剩 Zotero/机构等 provider-specific 写入合同与真实回执；Protocols.io 写入不再是计划门槛 |
| 2026-10-17 | P9-3 / P10-2 缺口复核 | Zotero 本机临时 note 已完成创建→标记回读→按版本删除→最终 404；机构连接器保持只读；Protocols.io 保持只读；v0.32.9 无证书发布的 macOS/Windows validate、构建、更新 feed、版本切换与回滚证据已登记，Release run 39007033259 全部成功 | 连接器/发布门槛已关闭；下一阶段仅剩 A5-1～A5-4 的 `.pi/lib` 兼容运行时清理，B8 团队协作按用户决定继续暂缓 |
| 2026-10-18 | v1.1 门槛复核 | Drone `main` 已与 `origin/main` 同步（代码验收基线 `a620a40e`） 与 `drone-plugins` `main=8389116` 已同步远端；`check:remaining-gates`、Pi 1.1.0/latest 兼容矩阵、`drone-plugins` 全量 check、桌面产物 16/16 和四视口视觉对照 4/4 均通过；`/drone-doctor`、`/drone-example` 已纳入真实 CLI 证据 | A5-1～A5-4 兼容层清理仍未完成，但明确不阻塞已发布 v1.1；Protocols.io 继续只读，B8 仍按用户决定暂缓 |
| 2026-10-18 | A5 并行生产切片 | 主线 `876f0a07` 合入 knowledge worker package-relative cutover、tasks acceptance package registry ownership、research host typed ports，以及 tasks runtime 类型收口和 source-only knowledge worker 测试路径；knowledge 307、tasks 58、research 93、extensions 18、backend acceptance 1/1、全量 workspace 测试、root lint/typecheck/build、runtime checks、`check:extensions --strict`、`check:arch`、`check:native-pi` 和 Desktop build 全部通过；插件 API 未变，证据见 [`a5-migration-2026-10-18.json`](releases/a5-migration-2026-10-18.json) | `.pi/lib` 的 CLI/打包兼容入口仍保留，A5-1/2/3 总项和 A5-4 extraResources 清理继续未完成；不阻塞当前插件化发布 |
| 2026-10-18 | A5-1～A5-4 最终收口 | 删除 `.pi/lib` knowledge/tasks/research 运行时兼容树；扩展 manifest 移到 `.pi/extensions/workbench-manifest.json`，`electron-builder.yml` 不再复制 `.pi/lib`；`@gyoungwe/plugin-api` 未变。knowledge 307、tasks 58、research 93、extensions 19、runtime/strict/package/desktop artifact 检查及全量 lint/typecheck/test/build/architecture 均通过 | A5-1～A5-4 已关闭；后续能力只进入领域包和 `drone-plugins`，Protocols.io 继续只读 |
| 2026-10-18 | 计划复核与门禁复跑 | Drone `main=260995a0`、`drone-plugins main=8389116` 均与远端一致；`check:remaining-gates`、plugin-api migration/lifecycle、Pi 1.1.0/latest、升级 fixtures、插件仓库全量 check 和 Desktop artifact 16/16 均通过；最新桌面产物 SHA-256 为 `9db8e47ec4c039415ca6dc66a1ccd78dd7ca2f7e3f9a1bb78fafa5cac30244e7` | 未发现未关闭的 v1.1 或 A5 门槛；Protocols.io 继续只读，交互式 Electron SIGABRT 仅作环境观察 |
| 2026-10-19 | 交接规则、知识 worker 与主线评估 | `AGENTS.md` 增加暂缓条目、日志归档和真实 PASS 三条红线；计划日志均压到最近 30 行；backend worker host seam、打包资源检查和 v0.33.1 缺陷复现完成；onboarding 三项修复与 `eval:mainline` 20×2 离线证据加入；根 lint/typecheck/test/build/check:arch 均通过 | v0.33.2 正式安装包和发布 tag 尚待完成；B8 仍暂缓 |
| 2026-10-19 | v0.33.2 真实插件宿主回归 | pi-core 0.1.3 / research-suite 0.1.5 公开 registry tarball 已回读；Pi 1.1.0/latest 真实安装、三条 onboarding 命令及旧冲突负例均完成；证据见 `docs/releases/v0.33.2-pi-cli-regression.json` | v0.33.2 release tag 待 Drone PR 合并后生成；B8 仍暂缓，Protocols.io 保持只读 |
| 2026-10-19 | v0.33.3 安装包验收门禁与发布提速 | Release workflow 新增构建后原生 DMG/ZIP/NSIS 检查、上传后从 draft 回下载并对 installers/blockmaps/update metadata 做双向 SHA-256 清单比对，只有 `finalize` 才能公开 release；macOS 两架构合并为单次构建，构建与完整验证并行，Electron/Builder 缓存和资产白名单已加入；GitHub run `39191569111` 的 macOS/Windows 构建、上传、draft 回下载、Windows ZIP/NSIS 安装和最终 release 均通过；Windows 参数传递与 prepare 依赖门禁问题已修复，证据见 `docs/releases/v0.33.3-asset-validation.json` 与 Release run | v0.33.3 已发布且无证书门禁关闭；B8 仍暂缓，Protocols.io 保持只读 |
| 2026-10-20 | 架构与插件计划缺口复核 | A0–A7、P9、P10 以及 A5-1～A5-4 的任务勾选和门禁记录均已核对；唯一未勾选项仍是按用户要求暂缓的 B8；根 `check:remaining-gates`、`check:plugin-api` 和浅色四视图回归均通过 | 插件热插拔 worker 排空/失败回滚/生命周期事件、任意 Skill 仓库管理、市场完整安装更新卸载、MCP 真实配置、原生 Pi 对等会话、深色对照和 v0.33.4 远端 Release 仍属后续门槛 |
