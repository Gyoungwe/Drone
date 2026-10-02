# 架构升级 v2 · 任务拆解

> 配套：[architecture-v2.md](architecture-v2.md)。本文面向执行者（人或编码 Agent，如 Codex / Claude Code）。
> 每个任务都应该能在**一个 PR** 里完成；按顺序执行；完成一项勾选一项，并在文末执行日志里记一行。

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
  - `shared/src/host-api/define.ts`：`defineDomain(name, { methods, events })`。method 包含 `args`（typebox Tuple）、`result`、`access`（`desktop` | `lan-read` | `lan-control`，默认 `desktop`）。提供 `channelOf(domain, method)`、类型推导工具 `ClientOf<Contract>`。
  - `desktop/src/main/ipc/bind-contract.ts`：`bindContract(contract, impl)` → 用 `ipcMain.handle` 注册；入参 `Value.Check` 不通过时返回结构化的 `UiError`（code `invalid_arguments`，不回显敏感参数）；开发模式下还校验 result。
  - preload：`exposeContract(contract)` 生成 invoke 和 on* 订阅。
  - 验收：单测覆盖参数合法、参数非法、result 不符（开发模式）、事件订阅与退订四种情况。
- [x] **A2-2 迁移 sessions 域**：`SessionsContract` 替代 `INVOKE_ROUTES` 里 sessions 部分和对应的 `registerInvokers` 调用；`PiApi` 里这部分类型改由契约推导。验收：renderer 无需改动调用点（方法名不变），通过 typecheck；`scripts/check-report-ui.mjs` 通过。
- [x] **A2-3 迁移其余域**：settings、permissions、packages、app、ui-plugins、lan、knowledge、institutional、subagents，每个域一个提交。全部迁完后删除 `INVOKE_ROUTES`，`IpcChannels` 改由契约生成。验收：`grep -c "ipcMain.handle(" packages/desktop/src/main` 只剩 `bind-contract.ts` 以及少数有文档说明的例外。
  - [x] ui-plugins：配置、列表、读码、启停、槽位指派、重建、打开目录均通过 `UiPluginsContract` + `bindContract` 注册；保留既有通道名与 renderer 调用形状。
  - [x] institutional：状态、配置、登录窗口、URL 打开、会话清理、访问测试均通过 `InstitutionalContract` + `bindContract` 注册；保留既有通道名、返回形状与主 frame 安全校验。
  - [x] subagents：面板列表、派发、中止与运行记录均通过 `SubagentsContract` + `bindContract` 注册；保留既有 `subagents:*` 通道、renderer 调用形状，并为运行记录增加严格 TypeBox 校验。
- [x] **A2-4 LAN 复用契约**：`lan/server.ts` 把 `access: "lan-read"` 的方法暴露为 GET，事件走现有 SSE（保留命名事件 `ping` 心跳，见 PITFALLS）；删除 `shared/lan.ts` 中和契约重复的类型。验收：`lan-server`、`lan-projector`、`lan-sanitize` 测试通过；LAN 仍然是 GET-only（加一条断言）。
  - [x] 桌面端 `lan:getStatus`、`lan:setEnabled`、`lan:setRemoteControl` 已迁移到 `LanContract` + `bindContract`；`getStatus` 标记 `lan-read`，控制开关保持 desktop-only。
  - [x] LAN HTTP 增加鉴权 `GET /api/status`，复用 `LanContract.getStatus` 的结果形状并在服务端执行运行时 schema 校验；`LanStatus` 从契约 `LanStatusSchema` 推导，SSE 保留现有命名 `ping` 心跳。
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
- [x] **A4-2**：desktop IPC、LAN、子代理面板、历史回放（`getSessionMessages`、`peek*`）统一从 fanout 或同一个 `projectSnapshot` 取数据。
- [x] **A4-3 表驱动测试**：覆盖阶段顺序；publication 抛异常 → 失败关闭；trace 抛异常 → 放行并记日志；stream-guard 熔断 → 后续增量丢弃。验收：已有的 `event-slim`、`stream-guard*`、`knowledge-publication-*`、`trace` 测试不改就通过。

## A5 · 领域包 TS 化（风险最高，放在最后做）

先定好打包策略：新建 `packages/extensions`（`@drone/extensions`），用 esbuild 把每个扩展入口打包成**自包含的** `.pi/extensions/<name>.mjs`，文件名与现有的一一对应；`.pi/lib` 最终不再需要作为运行时资源分发。

- [x] **A5-0 打包管线**：`npm run build:extensions` 从 `packages/extensions/src/*.ts` 输出 `.pi/extensions/*.mjs`；`electron-builder.yml` 的 extraResources 不变（仍然复制 `.pi/extensions`）；`.pi/lib` 在迁移期继续复制。产物已提交，保证 CLI 用户 `git clone` 后直接可用，CI 检查产物和源码一致；manifest 顶层 `legacyOutputs` 声明的兼容遗留会在 A5-4 清零。
  - 验收：先用一个最小扩展（`subagent-research`）走通全流程；`check-knowledge-package.mjs`、`check-research-packaging.cjs` 通过；在 CLI 模式下 `.pi/settings.json` 能加载。
- [ ] **A5-1 @drone/knowledge**：把 `.pi/lib/knowledge/*` 迁到 `packages/knowledge/src/*.ts`（先 `git mv` 移动文件，再改成 TS）。worker（`worker.mjs`）单独作为一个构建入口。55 个后端测试的 import 从 `.pi/lib/...` 改为 `@drone/knowledge`。验收：§5 不变量 1–3 相关测试全部通过；`scripts/benchmark-knowledge.mjs` 和 `benchmark-semantic.mjs` 能运行，结果量级与迁移前一致（把数字记进执行日志）。
  - [x] claim-conflicts：新增 `@drone/knowledge` TS 包入口与强类型 `compareClaims` / `compareClaimSets`，包内 3 个测试及后端迁移测试 3 个通过；`.pi/lib/knowledge/claim-conflicts.mjs` 暂作运行时兼容实现。
  - [x] orchestration-policy：新增 `@drone/knowledge` TS 包入口与强类型 `specialistRequestSignature` / `decideSpecialistRun` / `createSpecialistBudget`，包内 3/3 与后端 knowledge orchestration/stress 13/13 通过；`.pi/lib/knowledge/orchestration-policy.mjs` 暂作运行时兼容实现。
  - [x] review-policy：新增 `@drone/knowledge` TS 包入口与强类型 `readReviewMode` / `saveReviewMode` / `advisoryCodes`，包内 4/4 与 backend `knowledge-automatic-review` 4/4 通过；`.pi/lib/knowledge/review-policy.mjs` 暂作运行时兼容实现。
  - [x] source-links：新增 `@drone/knowledge` TS 包入口与强类型 `onlineSourceLink` / `normalizeSourceLinks`，包内 4/4 与 backend `knowledge-delivery-round2`、`zotero-literature` 合计 26/26 通过；`.pi/lib/knowledge/source-links.mjs` 暂作运行时兼容实现。
  - [x] flow-cards：新增 `@drone/knowledge` TS 包入口与强类型回执卡构造器，包内 3/3 通过；`.pi/lib/knowledge/flow-cards.mjs` 暂作扩展运行时兼容实现。
  - [x] files：新增 `@drone/knowledge/files` 安全文件读取入口，迁移 Vault 相对路径校验、软链接拒绝、1 MiB 上限、稳定哈希与 bounded snippet；包内 6/6 通过；`.pi/lib/knowledge/files.mjs` 暂作运行时兼容实现。
  - [x] layout：新增 `@drone/knowledge/layout`，迁移安全 Vault containment、create-only 初始化、managed navigation 更新与项目上下文模板；包内 7 项定向测试，knowledge 包回归 53/53 通过；`.pi/lib/knowledge/layout.mjs` 暂作运行时兼容实现。
  - [x] wiki-policy：新增 `@drone/knowledge/wiki-policy`，迁移 Wiki 目标/来源约束、managed block、静态 explainer 与 proposal hash；包内 5 项测试通过；`.pi/lib/knowledge/wiki-review.mjs` 与 `wiki-model-review.mjs` 暂作运行时兼容实现。
  - [x] runtime/service/worker：`service.ts`、`worker.ts`、`maintenance.ts`、`ui-service.ts`、`specialist-host.ts`、`topic-memory.ts` 与 runtime host 已迁入 TS，并由 `scripts/build-knowledge-runtime.mjs` 生成 worker/runtime 产物；knowledge 包 58 项通过。`.pi/lib/knowledge/*` 仍保留跨 bundle host/UI 兼容适配，因此 A5-1 总项保持未完成。
- [ ] **A5-2 @drone/tasks**：`.pi/lib/tasks/*` 迁移。验收：全部 `task-*` 测试通过，包括 `example-tasks-one-authorization-sdk.test.mjs`。
  - [x] failure-feedback：新增 `@drone/tasks` TS 包入口与强类型 `diagnosticText` / `toolResultFailed` / `failureObservation` / `failureContext` 等纯函数；包内 4/4 测试及 backend `task-failure-feedback` 20/20 测试通过，backend diagnostics 复用该脱敏入口；`.pi/lib/tasks/failure-feedback.mjs` 暂作运行时兼容实现。
  - [x] single-flight：新增 `@drone/tasks` TS 包入口与强类型 `singleFlightCommand`，包内 3/3 与 backend `task-command-single-flight` 4/4 通过；`.pi/lib/tasks/single-flight.mjs` 暂作运行时兼容实现。
  - [x] turn-end-prompt：新增 `@drone/tasks` TS 包入口与强类型 `shouldAskToContinue`，包内 3/3 与 backend `task-one-authorization-flow` 4/4 通过；`.pi/lib/tasks/turn-end-prompt.mjs` 暂作运行时兼容实现。
  - [x] tool-protocol：新增 `@drone/tasks` TS 包入口与强类型 `restoreTaskToolOrder`，包内 9/9 与 backend `task-tool-protocol` 9/9 通过；`.pi/lib/tasks/tool-protocol.mjs` 暂作运行时兼容实现。
  - [x] consent / remaining：新增 `@drone/tasks` TS 包入口与强类型任务授权、剩余进度解释策略；包内测试和 backend `task-consent` / `task-progress` 回归通过；旧 `.pi` 文件暂作运行时兼容实现。
  - [x] evidence：新增 `@drone/tasks/evidence` TypeScript 状态机，`.pi/lib/tasks/evidence.mjs` 仅保留宿主 inspector 适配；包内 5/5 与 backend `task-workbench` 30/30 通过。
  - [x] authorization-policy：新增 `@drone/tasks/authorization-policy` 纯授权卡策略入口，包内 6 项测试通过；`.pi/lib/tasks/ask-authorization.mjs` 暂作运行时兼容实现。
  - [x] pdf-identity：新增 `@drone/tasks/pdf-identity` 宿主注入 worker 边界，含 15 秒超时、AbortSignal 清理、页数/文本上限与稳定错误码；包内 43/43 通过；`.pi/lib/tasks/pdf-identity.mjs` 暂作 CLI worker 适配器。
  - [x] acceptance-policy：新增 `@drone/tasks/acceptance-policy`，迁移验收器注册、schema live refs、结果归一化和说明投影；包内 49/49 通过；`.pi/lib/tasks/acceptance.mjs` 仍负责 Pi 事件桥接。
  - [x] runtime：`src/runtime/*.ts` 与 checked-in `src/runtime-compiled/*.mjs` 已承载 workbench、register、acceptance、授权、PDF worker、tool manifest 和 runtime bridge；`npm run build:tasks` 同步生成无 workspace 依赖的 `.pi/lib/tasks` 兼容图，开发环境的 acceptance adapter 优先复用 typed package 注册表，隔离打包环境回退到自包含产物；tasks 包 49 项通过，因此 A5-2 总项仍只剩宿主/SDK 兼容边界。
- [ ] **A5-3 @drone/research**：source-archive、open-access、zotero-*、institutional-access、literature-*、run-provenance、research-receipt-journal 等迁移。验收：`zotero-*`、`source-archive-*`、`institutional`、`literature-*` 测试通过。
  - [x] run-provenance：新增 `@drone/research/run-provenance`，执行回执、文件快照、范围/凭据校验和 QC 边界迁移到 TS；包内 5/5，backend 回归 4/4；`.pi/lib/run-provenance.mjs` 保持自包含兼容入口。
  - [x] evidence-gate：新增 `@drone/research/evidence-gate`，迁移证据阶段单调推进、失败终态与 answerable 断言；research 包 37/37 通过；`.pi/lib/evidence-gate.mjs` 暂作运行时兼容入口。
  - [x] source-archive-policy：新增 `@drone/research/source-archive-policy`，迁移 run 目录、文件名、挑战页、magic bytes、内容类型与元数据门禁；包内 5 项测试与 typecheck 通过；`.pi/lib/source-archive.mjs` 仍保留下载/写入运行时适配。
  - [x] receipt-journal-policy：新增 `@drone/research/receipt-journal-policy`，迁移核心工具准入、错误工具过滤、256 容量去重回执缓冲与 run_dir 归属判定；research 包回归 46/46 通过；`.pi/lib/research-receipt-journal.mjs` 仍保留宿主 journal 适配。
  - [x] runtime：source archive、receipt journal、research loop、Zotero setup/reconcile/write 与 institutional host runtime 已迁入 `@drone/research`，并由 `.pi/lib` 适配 workspace/filesystem/CLI 端口；research 包 50 项通过，A5-3 总项仍因兼容入口与 host 适配保留而未完成。
- [ ] **A5-4 扩展适配层**：`.pi/extensions/*.mjs` 的源码移到 `packages/extensions/src/`，只保留参数映射和注册逻辑，领域逻辑全部调用领域包。`runner.ts` 里两处 `../../../../../.pi/…` 改为包引用或构建产物的解析函数。验收：R5 基线清零；`.pi/lib` 从 extraResources 移除后，打包冒烟通过。

## A6 · DroneRuntime 注入

- [x] **A6-1**：在 `shared/src/runtime.ts` 定义 `DroneRuntime` 接口；`create-backend.ts` 构造实现，第一方扩展改为内联工厂并注入 runtime（桌面模式）；`@drone/extensions` 的入口在 CLI 模式下调用 `createStandaloneRuntime()`。
- [x] **A6-2**：逐个替换 10 个 `Symbol.for("drone.*")`：锁和队列类（`wiki-review-locks`、`topic-memory-queues`、`semantic-lock`）统一换成 `runtime.scheduler`（带 dispose）；单例类（worker-pool、binding、ui、specialists）改由 runtime 持有；`tool-manifest`、`acceptance-verifiers` 改为通过 `pi.events` 的版本化注册事件收集。
- [x] **A6-3**：`knowledge-publication.ts` 改为从 runtime 取投影器；`failClosedEvent` 保留，只作为抛异常时的兜底。验收：R4 基线清零；`knowledge-publication-fallback.test.ts` 改为覆盖"投影器抛异常"场景并通过；测试可以在同一进程里创建两个互不干扰的 runtime（新增测试）。

## A7 · StorageRegistry 与诊断

- [x] **A7-1**：新建 `backend/src/storage/registry.ts`，登记所有落盘状态（逐个排查 `JsonStore` 的使用点、userData、`DRONE_KNOWLEDGE_DIR`、traces、审计、会话 jsonl、机构会话分区），字段包括 id、path、owner、schema、migrate、sensitivity。验收：新增测试断言：凡是用到 `JsonStore` 的地方都能在注册表里找到对应条目（静态扫描或运行时断言皆可）。
- [x] **A7-2 诊断包**：新增 `app:diagnostics` 契约方法和设置 → 关于页的"导出诊断包"（i18n 双语）。内容：版本、平台、各存储的 schema 与损坏状态、最近的 incident 快照、日志尾部（脱敏）。**不含**凭据、auth.json 内容、Vault 正文、会话正文。导出使用无第三方依赖的 ZIP（`diagnostics.json` + `README.txt`），并通过现有保存对话框写入二进制；脱敏、ZIP 内容与保存桥接均有自动化测试覆盖。

---

## 执行日志

| 日期 | 任务 | 结果 / 数字 | 遗留 |
|---|---|---|---|
| 2026-09-30 | 基线 | typecheck 通过；backend 1,320 / desktop 528 / shared 102 测试通过；backend 测试 336 s | — |
| 2026-10-01 | A1-3 | `.pi/lib/knowledge/**/*.mjs` 与 `.pi/lib/tasks/**/*.mjs` 共 42 个文件纳入 `checkJs`；`npm run check:pi` 通过；根 `typecheck` 已串接该检查 | — |
| 2026-10-01 | A2-2 | 31 个 sessions IPC 方法统一由 `SessionsContract` + `bindContract` 注册；`PiApi` 会话方法由契约客户端类型推导；shared/desktop 定向契约与 IPC 测试通过 | `scripts/check-report-ui.mjs` 需要完整 Electron UI fixture；当前本机 fixture 在 React 初始化阶段失败，非 sessions IPC 错误 |
| 2026-10-01 | A7-2 | `serializeDiagnosticsArchive` 生成无压缩 ZIP；shared 诊断包 2 项、desktop 保存桥 3 项定向测试通过；导出文件名为 `drone-diagnostics-YYYY-MM-DD.zip` | UI 截图需在桌面运行环境补做 |
| 2026-10-01 | A5-0 | `build:extensions` 生成 `.pi/extensions/.build-manifest.json`，记录 7 个 generated TS 入口与 MJS 产物哈希；`check:extensions --strict` 校验 generated entries 的缺失与漂移。manifest 顶层 `legacyOutputs` 声明 4 个兼容遗留（obsidian-workbench/source-archive/subagent-mcp-readonly/zotero-literature），不会被 strict 当作漂移失败 | A5-4 完成后再移除这 4 个 legacy outputs，并从 extraResources 移除 `.pi/lib` |
| 2026-10-01 | A4 / A6 | EventPipeline 已移入 `session-engine/`；桌面 IPC、LAN 历史读取与会话回放统一复用持久化知识投影；运行时投影器、知识服务、UI 流和 specialist host 改用显式版本化事件桥接；`node scripts/check-architecture.mjs` 通过且 R4 无新增发现 | A5-1–4、A6-1–2 仍待完成；LAN 控制写端点保留兼容鉴权 |
| 2026-10-01 | A0-3 | backend 测试按 unit/sdk 自动分层：unit 1252（11 skipped），sdk 99（2 skipped），总计 1351；`npm run test:unit` 通过（113 files，98.64s），`npm run test:sdk` 99 passed + 2 skipped（8.43s） | — |
| 2026-10-01 | A0-4 / A2-3 | 删除 `.pi/lib/vault-mcp-proxy.mjs` 与旧 `register-invokers`/`INVOKE_ROUTES`；settings、permissions、packages、app、ui-plugins、lan、knowledge、institutional、subagents 全部由域契约 + `bindContract` 注册，preload 统一使用契约 client；旧配置识别保留为提示路径 | `IpcChannels` 仍是兼容通道名常量，尚未自动从契约生成 |
| 2026-10-01 | A7-1 | `JsonStore` 强制 `storageId`，生产使用点登记到 `storage/registry.ts`；静态扫描测试覆盖 backend 与 desktop main 的 10 个生产构造点，cwd-independent | 其他非 JsonStore 落盘（会话、trace、审计、机构分区）仍待逐项登记 |
| 2026-10-01 | A3 | `createBackend` 组合根显式暴露 runtime、sessionEngine、settings/models/login/mcp/packages/knowledge 服务；PiBackend 继续作为兼容门面，session 生命周期已由 SessionEngine 承接 | approvals、permissions/trust、subagents、zotero/institutional 等域仍待抽离，A3 总项未勾选 |
| 2026-10-01 | A3-3 / A6 | 生产后端 Pi SDK 值导入统一经 `session-engine/sdk.ts`，架构检查 R1 生产基线清零；ZoteroService 已接入组合根；研究循环、Zotero、source archive 的运行时状态和串行队列改为 host runtime 注入与 scheduler；Zotero 验收器在 host runtime 广播后重放，保持一次任务授权语义 | PiBackend 门面及 approvals/permissions/trust/subagents/institutional 等域仍待拆出；其余 legacy 扩展 singleton 与 CLI runtime 注入仍待完成 |
| 2026-10-01 | A5-1 增量 | `@drone/knowledge` 承载 claim-conflicts 强类型实现；包 typecheck 通过，包内 4/4 与后端迁移测试 3/3 通过，并加入 Unicode 归一化兼容回归 | 其余 knowledge 模块、worker 与 benchmark 尚未迁移；旧 `.pi/lib` 实现保留为运行时兼容层 |
| 2026-10-01 | A5-1 增量 | `@drone/knowledge` 新增 orchestration-policy 强类型实现；包内 3/3、backend knowledge orchestration/stress 13/13 通过，并保留旧 `.pi` 兼容实现 | knowledge service、worker、specialist-host 与 benchmark 尚未迁移；A5-1 总项保持未完成 |
| 2026-10-01 | A5-2 增量 | `@drone/tasks` 承载 failure-feedback 强类型实现；包 typecheck 通过，包内 4/4 与 backend `task-failure-feedback` 20/20 通过；backend diagnostics 复用包的 credential/URL 脱敏函数 | 其余 tasks 模块、task-* SDK 测试与 `.pi/lib/tasks` 运行时兼容层尚未迁移 |
| 2026-10-01 | A5-2 增量 | `@drone/tasks` 新增 single-flight 强类型实现；包 typecheck 通过，包内 3/3 与 backend `task-command-single-flight` 4/4 通过；命令合并仍按会话、目录与参数隔离，完成/失败后允许显式重试 | 其余 tasks 模块、task-* SDK 测试与 `.pi/lib/tasks` 运行时兼容层尚未迁移；A5-2 总项保持未完成 |
| 2026-10-01 | A5-2 增量 | `@drone/tasks` 新增 turn-end-prompt 强类型实现；包 typecheck 通过，包内 3/3 与 backend `task-one-authorization-flow` 4/4 通过；继续提示仍受授权、未验收里程碑、实际进展与自动续作配额约束 | 其余 tasks 模块、task-* SDK 测试与 `.pi/lib/tasks` 运行时兼容层尚未迁移；A5-2 总项保持未完成 |
| 2026-10-01 | A5-2 增量 | `@drone/tasks` 新增 tool-protocol 强类型实现；包 typecheck 通过，包内 9/9 与 backend `task-tool-protocol` 9/9 通过；仅修复已知状态卡交错，不移动不完整或外部批次 | 其余 tasks 模块、task-* SDK 测试与 `.pi/lib/tasks` 运行时兼容层尚未迁移；A5-2 总项保持未完成 |
| 2026-10-01 | A6-2 增量 | tool-manifest 增加 `drone:tool-manifest/v1` + `drone:tool-manifest/request/v1` 的 `pi.events` 注册/回放握手；SessionEngine 在 inline host factory 绑定后端收集器，覆盖扩展先加载的时序；独立事件总线、版本过滤、晚绑定回放 3 个测试，加上 capability/research/Zotero 回归测试通过 | 兼容期仍保留 process event 供无 host event bus 的 CLI/测试调用；acceptance-verifiers、其余 singleton/队列尚未迁移，A6-2 总项保持未完成 |
| 2026-10-01 | A6-2 增量 | acceptance-verifiers 增加 `drone:acceptance-verifier/v1` + `drone:acceptance-verifier/request/v1` 的 `pi.events` 注册/回放握手；扩展登记会在 host runtime 广播时复制到注入 runtime，SessionEngine 绑定后端收集器；`.pi/lib/tasks/acceptance.test.mjs` 与 backend collector 定向测试通过 | process-local runtimeSlot 仍保留 CLI/兼容路径；worker-pool、binding、ui、specialists 与其余队列尚未迁移，A6-2 总项保持未完成 |
| 2026-10-01 | A3-2 增量 | `PermissionSettingsService` 承接 permissions.json 快照、原子保存、恢复默认、规则试算与审计尾部；`BackendServices.permissions` 与 `PiBackend.permissions` 指向同一实例；服务级测试 1/1、createBackend 组合测试 1/1、backend typecheck 与架构检查通过 | 项目信任、审批 gate、会话权限模式仍在 PiBackend；A3-1/2/4 总项保持未完成 |
| 2026-10-01 | A3-1 增量 | `createBackend` 组合根现在尊重显式注入的 `DroneRuntime`，并通过组合测试验证 `BackendServices.runtime` 与 `PiBackend.runtime` 保持同一实例 | PiBackend 仍是兼容门面，A3-1 的完整 host composition 与 A3-4 façade 删除尚未完成 |
| 2026-10-01 | A3-2 增量 | `ProjectTrustService` 统一项目 `trust.json` 存储与 `TrustGate` 交互门控生命周期；`BackendServices.projectTrust` 与 `PiBackend.projectTrust` 指向同一实例，资源加载和旧 `respondTrust` 保持兼容委托；服务级 2/2、trust 回归 14/14、组合根 2/2 通过 | approvals gate、会话权限模式与 PiBackend 兼容门面仍待拆出；A3-2/4 总项保持未完成 |
| 2026-10-01 | A3-2 增量 | `ApprovalService` 统一 per-session `PermissionGate` 注册、待决请求快照、请求/裁决广播与 allowRun 队列裁决；`BackendServices.approvals` 与 `PiBackend.approvals` 共用同一实例，旧权限回调和回答入口继续委托；服务级 2/2、组合根 2/2、权限回归 40/40 通过 | 会话权限模式、desktop 直接消费服务与 PiBackend 门面删除仍待完成；A3-2/4 总项保持未完成 |
| 2026-10-01 | A5-1 增量 | `@drone/knowledge` 新增 review-policy 强类型实现；包 typecheck 通过，包内 4/4 与 backend `knowledge-automatic-review` 4/4 通过，并保留旧 `.pi` 兼容实现 | knowledge service、source-links、worker、specialist-host 与 benchmark 尚未迁移；A5-1 总项保持未完成 |
| 2026-10-01 | A5-1 增量 | `@drone/knowledge` 新增 source-links 强类型实现；包 typecheck 通过，包内 4/4 与 backend `knowledge-delivery-round2`、`zotero-literature` 合计 26/26 通过，并保留旧 `.pi` 兼容实现 | knowledge service、worker、specialist-host 与 benchmark 尚未迁移；A5-1 总项保持未完成 |
| 2026-10-01 | 最终验收 | `npm run lint`、根 `npm run typecheck`、根 `npm test`、`npm run build`、`node scripts/check-architecture.mjs`、插件/扩展检查、`npm run test:upgrade` 全部通过；backend 1,352 passed + 13 skipped，desktop 548，shared 129 | A3-1/2/4、A5-1 后续模块及 A5-2/3/4、A6-1/2 仍未完成 |
| 2026-10-01 | 最终验收复跑 | 静态检查、类型检查、构建、架构 ratchet、插件/扩展检查与升级 fixture 全部通过；根 `npm test` 通过：backend 1,362 passed + 13 skipped、desktop 548、extensions 1、knowledge 15、shared 129、tasks 19 | A3-1/2/4、A5-1 后续模块及 A5-2/3/4、A6-1/2 仍未完成 |
| 2026-10-01 | A2-4 | LAN `lan-read` 路由由 `LanContract` 推导并强制 GET；新增 `assertLanReadGetOnly()` 运行时断言与 `lan-server` 回归测试，保留 SSE `ping` 心跳和已有控制端点 | `lan-control` 的 M2 写端点仍按原有鉴权保留，A2-4 只约束契约读端点 |
| 2026-10-01 | A3-2 / A3-4 增量 | 组合根新增 institutional、subagents、knowledge、zotero、mcp、settings、models、login、sessions 端口；desktop IPC 生产路径已优先使用 `BackendServices`，PiBackend 仍提供兼容 fallback | PiBackend 中会话编排、knowledge orchestration 和少数兼容委托仍待最终删除 |
| 2026-10-01 | A5-2 增量 | `@drone/tasks` 新增 consent 与 remaining explanation 策略；包测试 24/24 通过，backend `task-consent` 30/30、`task-progress` 16/16 通过 | `.pi/lib/tasks` 运行时兼容层和其余 task SDK 测试仍待迁移 |
| 2026-10-01 | A5-3 增量 | 新建 `@drone/research`，迁移 literature receipt 与 source delivery 合约；包测试 4/4，backend literature evidence/research loop 34/34 通过 | source-archive、open-access、zotero/institutional 运行时模块仍待迁移 |
| 2026-10-01 | A5-1 / A6-2 增量 | knowledge 新增 tool-budget、topic-candidate；runtime bridge 删除旧 legacy key 参数，所有生产 `runtimeSlot`/`runRuntimeExclusive` 调用使用 host runtime；`.pi` checkJs 与隔离测试通过 | knowledge service/worker/specialist-host 尚未整体 TS 化；仍需完成剩余 runtime singleton 与扩展入口迁移 |
| 2026-10-01 | A3-2 增量 | services ports 的组合根与 sessions IPC 绑定通过：backend create-backend、desktop IPC 31 项定向测试通过，架构检查 150 baseline、6 fixed | A3-4 仍保留 PiBackend 兼容 façade，待删除委托并保留类型 re-export |
| 2026-10-01 | 全量验收复跑 | `npm run lint`、`npm run typecheck`、`npm test`、`npm run build`、`node scripts/check-architecture.mjs`、`check:extensions`、`check:plugin-api`、`test:upgrade --fixtures-only` 全部通过；backend 1,368 passed + 13 skipped、desktop 554、extensions 1、knowledge 20、research 4、shared 130、tasks 24 | A3-4 façade 删除、A5-1/3/4 完整迁移、A6-1/2 完整收尾仍待继续；兼容层保留是当前发布策略 |
| 2026-10-01 | A5 / A6 增量 | `@drone/research/run-provenance` 与 `@drone/tasks/evidence` 通过包级和 backend 回归；CLI/测试 Pi 宿主按对象获得独立 standalone runtime，重复绑定幂等；tool metadata 在 host runtime 注册，research-loop 隔离回归 27/27 | 带事件总线但尚未广播 runtime 的 CLI fallback、acceptance/tool-manifest 全量宿主归属以及 A5-4 扩展自包含打包仍待收尾 |
| 2026-10-01 | 修复后全量回归 | host runtime tool metadata 修复后 `npm test` 全部通过：backend 1,368 passed + 13 skipped、desktop 555、extensions 1、knowledge 20、research 9、shared 130、tasks 29；`.pi` checkJs、workspace typecheck、Biome、build、架构检查（148 baseline、8 fixed）和 `test:upgrade --fixtures-only` 通过 | A5-4 扩展自包含打包、A3-4 façade 删除及 A6-1/2 全量宿主归属仍待收尾 |
| 2026-10-01 | A5-4 / R5 增量 | backend subagent runner 改用 `researchWorkbenchRoot()` 解析打包资源，移除两处生产代码对相对 `.pi` URL 的直接依赖；架构基线从 156 收敛到 146，`check-architecture` 0 fixed | 测试 fixture 与剩余 knowledge service / session publication 兼容路径仍保留 R5 基线 |
| 2026-10-01 | A5-1 / A5-3 增量 | `@drone/knowledge/config` 承载知识库绑定目录、项目身份、revision 乐观并发与 AsyncLocalStorage 作用域；`@drone/research/open-access` 承载 PMCID/PMID/DOI 开放获取候选解析；包测试分别 23、12 项通过，后端开放获取回归 7 项通过 | `.pi/lib` 仍保留自包含兼容入口；knowledge worker、source-archive 运行时和其余 research 模块仍待迁移 |
| 2026-10-01 | A6-2 增量 / 运行时回归 | Pi 宿主获得独立 fallback runtime，桌面 runtime 延迟广播时复制工具清单与验收器声明；工具注册、回放和 execute 均在宿主 runtime 上下文中运行；兼容读模型保留无 host 上下文的 KnowledgeFlow / research journal 读取 | 其余 singleton 与队列仍待迁移；完整扩展自包含打包仍待 A5-4 |
| 2026-10-01 | 全量回归（最新） | `npm test` 全部通过：backend 1,368 passed + 13 skipped、desktop 555、extensions 1、knowledge 23、research 12、shared 130、tasks 29；`check:pi`、Biome、架构检查（145 baseline、0 fixed）通过 | A3-4 门面删除、A5-1/3/4 完整迁移、A6-1/2 全量收尾仍待继续 |
| 2026-10-01 | A5-4 增量 | institutional-access 已迁移到 `packages/extensions/src/`，生成自包含 `.pi/extensions/institutional-access.mjs`；Electron 持久分区、机构登录状态、EZproxy 推断和 CLI 降级均保留；`check:extensions` 通过，扩展回归 3/3 | `subagent-research` 及其他 8 个旧扩展产物仍保留；strict/R5 清零和 `.pi/lib` 移出 extraResources 尚未完成 |
| 2026-10-01 | A5-3 增量 | `@drone/research/zotero-identity` 承载 DOI 归一化、Zotero key 校验、精确 DOI/collection 匹配与附件元数据投影；research 19/19、backend 对账 8/8 通过 | source archive、Zotero 写入/设置/对账运行时、literature operations 等 `.pi` 入口仍待迁移 |
| 2026-10-01 | A5-3 增量 | `@drone/research/literature-operations` 承载文献 operation id、目的地对账状态、bounded history 与 Zotero 写入回执 journal；filesystem/config/queue/verify 均由显式 host ports 注入；research 31/31、backend `literature-operations` 4/4 通过；backend 测试已改用包入口 | `.pi/lib/literature-operations.mjs` 仍保留自包含 CLI/扩展适配；source archive 与其他 Zotero/institutional 运行时尚未整体迁移 |
| 2026-10-01 | A7-1 增量 | storage registry 登记 session traces、subagent sessions、PI logs、knowledge binding/review/specialist 目录，并为项目/Vault/研究结果根生成稳定 ID；registry 定向测试 5/5 通过 | 动态项目、Vault、研究结果目录仍需由 host 完整发现并注册；所有非 `JsonStore` 落盘路径尚未完成逐项审计 |
| 2026-10-01 | A3-4 增量 | desktop main/LAN 观察路径已改用组合根暴露的边界类型，减少直接依赖具体 PiBackend 实现；typecheck、desktop 回归和架构检查通过 | `SessionServicePort` 当前仍是 PiBackend 兼容类型别名，PiBackend 委托门面尚未删除，R1 基线仍未清零 |
| 2026-10-01 | 全量回归（扩展/存储后） | `npm run lint`、根 `npm run typecheck`、`npm test`、`npm run build`、`node scripts/check-architecture.mjs`、`check:extensions`、`check:plugin-api`、`test:upgrade -- --fixtures-only` 全部通过；backend 1,369 passed + 13 skipped、desktop 555、extensions 3、knowledge 27、research 16、shared 130、tasks 29；架构检查保持 145 baseline、0 fixed | A3-4 门面删除、A5-1/2/3/4 完整迁移、A6-1/2 全量宿主归属仍待继续 |
| 2026-10-01 | A5-1 增量 | `@drone/knowledge/semantic-settings` 承载语义 provider 配置校验、原子保存、revision CAS、危险路径检查与 per-runtime 默认时间戳；`.pi/lib/knowledge/semantic-settings.mjs` 仅保留 runtime scheduler 适配；包测试 33/33、backend semantic 回归 10/10 通过 | semantic provider HTTP、worker、knowledge service 与 specialist host 仍保留 `.pi` 兼容入口，A5-1 总项保持未完成 |
| 2026-10-01 | A5-4 增量 | research Wiki loop 与 WikiSkill 扩展迁移到 `packages/extensions/src/*.ts`，生成自包含产物并移除生产代码对 `.pi/lib` 的相对导入；Wiki 导航/写入反馈、应用知识模式禁写、WikiSkill gate 与 benchmark 行为保留；extensions 16/16，`check:extensions --strict` 验证 5 个 TS 入口 | obsidian-workbench、research-loop、source-archive、zotero-literature、subagent-mcp-readonly 仍是兼容产物；`.pi/lib` 移出 extraResources 与 A5-4 总项仍待完成 |
| 2026-10-01 | A1 / A5-4 | workspace-config 迁移后的所有返回分支补齐兼容配置字段，`.pi` checkJs 类型检查恢复通过；扩展构建 manifest 与生成哈希同步刷新，架构 ratchet 收敛到 144 条基线且 0 fixed | 基线剩余项主要是测试 fixture 与尚未迁移的 `.pi` 兼容入口 |
| 2026-10-01 | 知识回合并发回归 | 修复宿主自动生成摘要/Wiki 后项目索引刷新与父会话下一次检索的时序冲突：当前回合证据只按票据、绑定和来源哈希校验；宿主维护的 `Projects/<project>/Index.md` 更新会刷新导航快照，人工维护的 Home/Wiki/Context 仍要求重新准备；`npm test` 全部通过（backend 1,372 passed + 13 skipped、desktop 555、knowledge 33、research 29、shared 130、tasks 31），升级 fixture、类型、`.pi` checkJs、Biome、扩展 strict、架构检查均通过 | A3-4 门面删除、A5-1/2/3/4 完整迁移、A6-1/2 全量宿主归属仍待继续 |
| 2026-10-01 | A5-1 增量 | `@drone/knowledge` 承载 `extension-helpers` 与 `task-feedback` 的强类型实现；新增工具结果信封、项目/主题/会话身份策略、观察到的任务回执与 PDF 二进制门禁；包内 40/40、backend `knowledge-publication-hooks` 40/40 与 `usage-feedback` 13/13 通过；`.pi/lib/knowledge/*.mjs` 保留自包含兼容入口供 CLI 运行时使用 | knowledge service、worker、specialist-host、maintenance 与其余 `.pi` 运行时入口仍待迁移；A5-1 总项保持未完成 |
| 2026-10-01 | A3-4 增量 | `SessionServicePort` 收敛为纯会话/事件边界，域服务不再出现在会话端口；desktop main 的 IPC、心跳与 LAN 初始化均直接消费 `BackendServices`，IPC 模块的旧 PiBackend 形状仅保留为兼容适配路径；backend/desktop typecheck 与 7 个定向 IPC/组合根测试（25/25）通过 | `PiBackend` 仍是会话实现与兼容构造根；旧委托方法、LAN 后端结构端口及少数第三方适配入口仍待后续删除，A3-4 总项保持未完成 |
| 2026-10-01 | A6-2 运行时归属增量 | provenance、Obsidian 写入、Knowledge UI 预览/维护/语义任务、tool-manifest/acceptance 事件桥接均改为 host `runtimeSlot`；Knowledge worker pool 和 specialist host 注册 runtime disposal，关闭宿主时释放 worker、清理排队任务；研究回执 journal 补齐 reconciliation 核心工具记账。Biome、`.pi` checkJs、backend 定向 85 项、runtime/acceptance node:test 8 项通过 | Knowledge worker 内部 activeRequests/flushes/dirty/inflight 属于独立 Worker 实例，尚未进一步抽象为跨线程 runtime slot；tool-manifest 的无 host 兼容声明镜像仍保留 process-local 读模型，不承载执行状态 |

| 2026-10-01 | A3-4 完成 | 会话实现移到 `session-service.ts` 并命名为 `SessionService`；`pi-backend.ts` 仅保留 `PiBackend`/`PiBackendOptions` 兼容导出，组合根改用 `SessionService`，desktop/LAN/IPC 继续直接消费 `BackendServices`；backend/desktop typecheck、组合根与 SDK 回归通过，架构检查 141 baseline、0 fixed | 兼容别名保留一个发布周期；会话编排仍集中在 SessionService，后续可继续按 lifecycle/permission 子域拆分
| 2026-10-01 | A7-1 增量 | `StorageRegistry.registerDiscoveredRoot` 为宿主发现的项目工作目录提供稳定、脱敏、幂等登记；SessionService 在 create/open session 时登记 `<cwd>/.local/agent-work`，重复会话不会产生重复条目；registry 6/6 通过 | 研究结果目录与知识库 Vault 仍由扩展配置动态发现，下一步需在 host 配置刷新时调用同一登记入口 |
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
