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

- [ ] **A0-1 公开 AGENTS.md**
  - 从 `.gitignore` 移除 `AGENTS.md`，新建一份公开版：硬约束（复制 `docs/INDEX.md` 的"硬约束"一节）、常用命令、分层规则 R1–R6、DoD、本任务文档的入口。私有发版流程继续留在 `.local/docs/release.md`，公开版只写"见本地文档"。
  - 验收：`git check-ignore AGENTS.md` 无输出；文件里不含任何本机路径或凭据。
- [ ] **A0-2 架构检查脚本（ratchet）**
  - 新建 `scripts/check-architecture.mjs`：扫描 `packages/**`、`.pi/**`（排除 node_modules、dist、测试 fixtures），检查 R1–R6。当前的违规项写进 `scripts/fixtures/architecture-baseline.json`；**新增违规让脚本失败，违规减少时提示更新基线**。
  - 加入根 `package.json`：`"check:arch": "node scripts/check-architecture.mjs"`；CI `check` job 在 typecheck 之后运行。
  - 验收：在当前代码上退出码为 0；人为在 renderer 里加一行 `import "@earendil-works/pi-coding-agent"` 时退出码为 1，并指出文件和规则编号（为此写一个单测）。
- [ ] **A0-3 测试分层**
  - backend 的 `vitest.config.ts` 改用 `projects`：`unit`（排除 `*-sdk.test.*` 和会构造真实 `PiBackend` 或 `AgentSession` 的用例）和 `sdk`。新增 `npm run test:unit` 和 `npm run test:sdk`；`npm test` 仍然跑全部。
  - CI 拆成并行 job：`static`（lint/typecheck/arch）、`unit`、`sdk`、`desktop`，Windows 矩阵保留。
  - 验收：`test:unit` 与 `test:sdk` 的用例数之和等于拆分前的总数（1,320 + 13 skipped）；把 `test:unit` 的耗时记进执行日志。
- [ ] **A0-4 遗留死路径**
  - 调查 `.pi/lib/vault-mcp-proxy.mjs`（它 import 的 `vendor/pi-web-ui/…` 不存在）和 `obsidian-workbench.mjs:696,726` 对它的引用：确认是否有迁移路径会生成指向它的用户 MCP 配置。
  - 确认没有：删除该文件，把引用改成"识别旧配置 → 提示用户移除"。确认有：保留识别逻辑，但不再 import vendor。
  - 验收：`grep -rn "vendor/pi-web-ui" .pi packages` 无结果；相关的 obsidian 测试通过。

## A1 · `.pi/lib` 类型护栏

- [ ] **A1-1 checkJs 基础设施**
  - 新增 `.pi/tsconfig.json`（`allowJs`、`checkJs`、`noEmit`、`strict: false` 起步，`include` 按白名单逐步扩大）；根 `typecheck` 加一步 `tsc -p .pi`。
  - 新建 `packages/shared/src/runtime.ts`：为现有的 10 个 `Symbol.for("drone.*")` 桥对象各写一个 TS 接口，并导出 key 常量；backend 侧的 `session/knowledge-publication.ts` 和 `tools/manifest.ts` 改为引用这些接口。
  - 验收：`tsc -p .pi` 在白名单（至少 `knowledge/publication.mjs`、`tool-manifest.mjs`、`tasks/acceptance.mjs`）上通过。
- [ ] **A1-2 消除手工镜像常量**
  - `shared/src/task-workbench.ts` 里镜像 `REASON_TEXT` 这类常量，改为 shared 作为唯一来源，`.mjs` 从 `@drone/shared` 的构建产物 import；如果 CLI 路径做不到，就加一个一致性测试来断言两边相同。
  - 验收：`grep -rn "Mirrors \`.pi/lib" packages` 无结果，或每一处都有对应的一致性测试。
- [x] **A1-3 扩大白名单**：knowledge、tasks 全部 `.mjs` 纳入 checkJs（允许 `// @ts-expect-error` 并注明原因）。验收：白名单覆盖 `.pi/lib/knowledge/*` 和 `.pi/lib/tasks/*`。

## A2 · Host API 契约

- [ ] **A2-1 契约框架**
  - `shared/src/host-api/define.ts`：`defineDomain(name, { methods, events })`。method 包含 `args`（typebox Tuple）、`result`、`access`（`desktop` | `lan-read` | `lan-control`，默认 `desktop`）。提供 `channelOf(domain, method)`、类型推导工具 `ClientOf<Contract>`。
  - `desktop/src/main/ipc/bind-contract.ts`：`bindContract(contract, impl)` → 用 `ipcMain.handle` 注册；入参 `Value.Check` 不通过时返回结构化的 `UiError`（code `invalid_arguments`，不回显敏感参数）；开发模式下还校验 result。
  - preload：`exposeContract(contract)` 生成 invoke 和 on* 订阅。
  - 验收：单测覆盖参数合法、参数非法、result 不符（开发模式）、事件订阅与退订四种情况。
- [ ] **A2-2 迁移 sessions 域**：`SessionsContract` 替代 `INVOKE_ROUTES` 里 sessions 部分和对应的 `registerInvokers` 调用；`PiApi` 里这部分类型改由契约推导。验收：renderer 无需改动调用点（方法名不变），通过 typecheck；`scripts/check-report-ui.mjs` 通过。
- [ ] **A2-3 迁移其余域**：settings、permissions、packages、app、ui-plugins、lan、knowledge、institutional、subagents，每个域一个提交。全部迁完后删除 `INVOKE_ROUTES`，`IpcChannels` 改由契约生成。验收：`grep -c "ipcMain.handle(" packages/desktop/src/main` 只剩 `bind-contract.ts` 以及少数有文档说明的例外。
- [ ] **A2-4 LAN 复用契约**：`lan/server.ts` 把 `access: "lan-read"` 的方法暴露为 GET，事件走现有 SSE（保留命名事件 `ping` 心跳，见 PITFALLS）；删除 `shared/lan.ts` 中和契约重复的类型。验收：`lan-server`、`lan-projector`、`lan-sanitize` 测试通过；LAN 仍然是 GET-only（加一条断言）。
- [ ] **A2-5 插件 Host API 清单化**：`renderer/src/plugins/host-api.manifest.ts` 作为唯一来源，生成 `host-api.ts` 的导出表、`env.d.ts`、`main/ui-plugins/build.ts` 的 SHIM、`resources/ui-plugins/drone-ui.d.ts`（脚本放在 `packages/desktop/scripts/gen-plugin-api.mjs`，产物提交进仓库，CI 检查是否与清单一致）。验收：新增一个 hook 只需改清单一处再运行生成脚本；`registry.test.ts` 通过。

## A3 · 拆分 PiBackend

- [ ] **A3-1 组合根**：新增 `backend/src/create-backend.ts`，返回 `BackendServices`；`PiBackend` 的构造函数内部改为调用它（行为不变）。
- [ ] **A3-2 按域抽服务**（每个域一个 PR，顺序：approvals → permissions/trust → models/settings → mcp/packages → subagents → knowledge/zotero/institutional）：把方法移到 `services/<domain>.ts`，`PiBackend` 上保留委托方法并加 `@deprecated`。验收：每个服务 ≤ 400 行；原有测试不改就通过；新增的服务级单测可以不构造 `PiBackend`。
- [ ] **A3-3 SessionEngine**：会话生命周期部分移到 `session-engine/engine.ts`，`buildExtensionFactories`、`buildCustomTools` 移到 `session-engine/extensions.ts`；Pi SDK 运行时 import 只允许出现在 `session-engine/**`（更新 R1 白名单）。
- [ ] **A3-4 删除门面**：desktop main 和契约绑定改为直接使用 `BackendServices`；删除 `pi-backend.ts` 中的委托方法，保留类型 re-export 至少一个版本。验收：`check:arch` 的 R1 基线清零；`pi-backend.ts` 删除或只剩 re-export。

## A4 · EventPipeline

- [ ] **A4-1**：新建 `session-engine/event-pipeline.ts`，定义 `Stage` 接口（含 `failMode`），把 `emitEvent` 里的 slim、stream-guard、publication 投影、trace、fanout 改写成阶段列表。
- [ ] **A4-2**：desktop IPC、LAN、子代理面板、历史回放（`getSessionMessages`、`peek*`）统一从 fanout 或同一个 `projectSnapshot` 取数据。
- [ ] **A4-3 表驱动测试**：覆盖阶段顺序；publication 抛异常 → 失败关闭；trace 抛异常 → 放行并记日志；stream-guard 熔断 → 后续增量丢弃。验收：已有的 `event-slim`、`stream-guard*`、`knowledge-publication-*`、`trace` 测试不改就通过。

## A5 · 领域包 TS 化（风险最高，放在最后做）

先定好打包策略：新建 `packages/extensions`（`@drone/extensions`），用 esbuild 把每个扩展入口打包成**自包含的** `.pi/extensions/<name>.mjs`，文件名与现有的一一对应；`.pi/lib` 最终不再需要作为运行时资源分发。

- [ ] **A5-0 打包管线**：`npm run build:extensions` 从 `packages/extensions/src/*.ts` 输出 `.pi/extensions/*.mjs`；`electron-builder.yml` 的 extraResources 不变（仍然复制 `.pi/extensions`）；`.pi/lib` 在迁移期继续复制。产物是否提交进 git 需要决策：推荐**提交**，保证 CLI 用户 `git clone` 后直接可用，CI 检查产物和源码一致。在 `docs/DECISIONS` 或本文执行日志里记录决定。
  - 验收：先用一个最小扩展（`subagent-research`）走通全流程；`check-knowledge-package.mjs`、`check-research-packaging.cjs` 通过；在 CLI 模式下 `.pi/settings.json` 能加载。
- [ ] **A5-1 @drone/knowledge**：把 `.pi/lib/knowledge/*` 迁到 `packages/knowledge/src/*.ts`（先 `git mv` 移动文件，再改成 TS）。worker（`worker.mjs`）单独作为一个构建入口。55 个后端测试的 import 从 `.pi/lib/...` 改为 `@drone/knowledge`。验收：§5 不变量 1–3 相关测试全部通过；`scripts/benchmark-knowledge.mjs` 和 `benchmark-semantic.mjs` 能运行，结果量级与迁移前一致（把数字记进执行日志）。
- [ ] **A5-2 @drone/tasks**：`.pi/lib/tasks/*` 迁移。验收：全部 `task-*` 测试通过，包括 `example-tasks-one-authorization-sdk.test.mjs`。
- [ ] **A5-3 @drone/research**：source-archive、open-access、zotero-*、institutional-access、literature-*、run-provenance、research-receipt-journal 等迁移。验收：`zotero-*`、`source-archive-*`、`institutional`、`literature-*` 测试通过。
- [ ] **A5-4 扩展适配层**：`.pi/extensions/*.mjs` 的源码移到 `packages/extensions/src/`，只保留参数映射和注册逻辑，领域逻辑全部调用领域包。`runner.ts` 里两处 `../../../../../.pi/…` 改为包引用或构建产物的解析函数。验收：R5 基线清零；`.pi/lib` 从 extraResources 移除后，打包冒烟通过。

## A6 · DroneRuntime 注入

- [ ] **A6-1**：在 `shared/src/runtime.ts` 定义 `DroneRuntime` 接口；`create-backend.ts` 构造实现，第一方扩展改为内联工厂并注入 runtime（桌面模式）；`@drone/extensions` 的入口在 CLI 模式下调用 `createStandaloneRuntime()`。
- [ ] **A6-2**：逐个替换 10 个 `Symbol.for("drone.*")`：锁和队列类（`wiki-review-locks`、`topic-memory-queues`、`semantic-lock`）统一换成 `runtime.scheduler`（带 dispose）；单例类（worker-pool、binding、ui、specialists）改由 runtime 持有；`tool-manifest`、`acceptance-verifiers` 改为通过 `pi.events` 的版本化注册事件收集。
- [ ] **A6-3**：`knowledge-publication.ts` 改为从 runtime 取投影器；`failClosedEvent` 保留，只作为抛异常时的兜底。验收：R4 基线清零；`knowledge-publication-fallback.test.ts` 改为覆盖"投影器抛异常"场景并通过；测试可以在同一进程里创建两个互不干扰的 runtime（新增测试）。

## A7 · StorageRegistry 与诊断

- [ ] **A7-1**：新建 `backend/src/storage/registry.ts`，登记所有落盘状态（逐个排查 `JsonStore` 的使用点、userData、`DRONE_KNOWLEDGE_DIR`、traces、审计、会话 jsonl、机构会话分区），字段包括 id、path、owner、schema、migrate、sensitivity。验收：新增测试断言：凡是用到 `JsonStore` 的地方都能在注册表里找到对应条目（静态扫描或运行时断言皆可）。
- [ ] **A7-2 诊断包**：新增 `app:diagnostics` 契约方法和设置 → 关于页的"导出诊断包"（i18n 双语）。内容：版本、平台、各存储的 schema 与损坏状态、最近的 incident 快照、日志尾部（脱敏）。**不含**凭据、auth.json 内容、Vault 正文、会话正文。验收：脱敏单测（放入假 key、假路径，断言输出中不出现）；UI 冒烟截图。

---

## 执行日志

| 日期 | 任务 | 结果 / 数字 | 遗留 |
|---|---|---|---|
| 2026-09-30 | 基线 | typecheck 通过；backend 1,320 / desktop 528 / shared 102 测试通过；backend 测试 336 s | — |
| 2026-10-01 | A1-3 | `.pi/lib/knowledge/**/*.mjs` 与 `.pi/lib/tasks/**/*.mjs` 共 42 个文件纳入 `checkJs`；`npm run check:pi` 通过；根 `typecheck` 已串接该检查 | — |
