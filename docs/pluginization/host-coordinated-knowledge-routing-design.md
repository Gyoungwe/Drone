# 宿主统筹的知识域路由（破坏性）

> 计划行：`P7-cut2-uiwire`。决策日期 2026-11-25，用户拍板「破坏性更新，走能统筹，后续只改插件不改宿主的方式」。
> 路由粒度由用户选定：**按域分组的中性路由**；schema 归属由用户选定：**宿主留操作名清单，域内 schema 归插件**。

## 问题

宿主在两个层面各具名了一遍知识域：

- `packages/shared/src/knowledge.ts` 的 `KnowledgeApi`：48 个具名方法。
- `packages/shared/src/ipc.ts` 的 `IpcChannels`：50 个 `knowledge:*` / `zotero:*` 具名通道。
- `packages/shared/src/host-api/knowledge.ts` 的 `KnowledgeContract`：48 个具名方法（带 TypeBox schema）。
- `packages/plugin-api/src/ui-wire.ts`：56 方法 / 44 类型的生成物，2088 行。

这意味着**插件每加一个知识方法，宿主要改四处**：`KnowledgeApi`、`IpcChannels`、`KnowledgeContract`、`knowledge-ui-contract.json`。这正是「后续只改插件不改宿主」要消灭的耦合。

## 既有事实（已核实，非假设）

**宿主已经是统筹者，不需要新建架构。**

- `packages/backend/src/create-backend.ts:331` 只做 `knowledgeHostLoader?.load()`，拿到的 `KnowledgeHostPort` 是**已安装插件注入的能力端口**。
- 宿主代码里没有一个知识域方法名。`overview` / `search` / `read` / `graph` / `reviews` / `decide` 全部是 `KnowledgeHostPort` 上的**可选方法**，缺失即 fail-closed（`packages/backend/src/knowledge/ui.ts` 的 `unavailable()`）。
- `packages/backend/src/knowledge/ui.ts` 已有一层按名转发 `compatibility.call(name, input)`。
- 插件侧 `packages/pi-knowledge/src/core/index-runtime.ts` 的 `dispatch(op, args)` 已经是按名的操作表。

**具名通道是历史包袱，不是架构必需。**

宿主唯一「认识」知识域的地方，就是上面那 56/48/50 三个具名清单。

## 设计

### 宿主侧

实际落地形态是**三个 IPC 通道**（不是一个），因为域边界要落在通道上：

| 位置 | 改造 |
| --- | --- |
| `shared/src/ipc.ts` `IpcChannels` | 50 个 `knowledge:*` / `zotero:*` → 3 个：`knowledge:invoke`、`daily:invoke`、`zotero:invoke` |
| `shared/src/knowledge.ts` `PiApi` | 48 个具名方法 → `invokeKnowledge` / `invokeDaily` / `invokeZotero`，各带 `{ operation, input? }` 信封 |
| `desktop/src/main/ipc/knowledge-routes.ts` | **路由表**（新增文件）：按域分三张表，每张表一个操作名 → 实现的映射；表外操作名在进入实现前就被拒 |
| `desktop/src/main/ipc/knowledge.ts` | 只负责解析宿主实际有的服务、挂载三张路由表、转发知识事件 |
| `desktop/src/preload/index.ts` | 三个 `invoke*` 转发 |
| `desktop/src/renderer/src/plugins/knowledge-api.ts` | 三个中性通道适配：`knowledge` / `daily` / `zotero`，各只有 `invoke(operation, input)` |
| `desktop/src/renderer/src/plugins/host-api.manifest.json` | knowledge 命名空间 56 条 → 3 条（三个通道各一条） |
| `desktop/src/renderer/src/plugins/host-api.ts` / `env.d.ts` / `resources/ui-plugins/drone-ui.d.ts` / `main/ui-plugins/plugin-api-shim.generated.ts` | 生成物，随 manifest 重生成 |

路由表放在 `desktop/src/main/ipc/` 而不是 backend，因为 `openTarget` 需要 `shell.openExternal` / `shell.openPath`，
而架构规则 R2 禁止 backend 依赖 Electron。

### 插件侧

| 位置 | 改造 |
| --- | --- |
| `plugin-api/scripts/knowledge-ui-contract.json` | 56 方法 / 44 类型 → 中性契约（3 通道 + 少量类型） |
| `plugin-api/src/ui-ports.ts` | **新增**：定义 `KnowledgeUiRoute` / `KnowledgeUiPort`（三个通道各一个 `invoke`） |
| `plugin-api/src/ui-wire*.ts` | 生成物：2088 行单文件 → 5 个模块（`ui-wire` / `-knowledge` / `-review` / `-daily` / `-services`），每个声明由**第一个需要它的模块**拥有，后续模块 `import type` |
| `pi-knowledge/ui/**` | `getKnowledgeApi().<method>(...)` → `getKnowledgeApi().<domain>.invoke("<op>", ...)` |

生成器按模块切分而不是单文件，是为了每个文件都不越过结构基线的 400 行上限；
「每个声明归第一个需要的模块」这条规则避免了同一类型在多处重复声明。

### 域边界

知识域按既有语义分成三组，宿主每组一个中性通道：

- **knowledge**：overview / search / read / graph / reviews / semantic / topics / maintenance / setup / specialist / jobs / cloud
- **daily**：日常发现（`getDailyDiscovery` / `updateDailyDiscovery` / `decideDailyIdea` / `decideDailyRadarPaper`）
- **zotero**：Zotero 本机写入授权与状态

**宿主自有能力移出知识域**，落在 `plugin-api/src/ui-ports.ts` 里两个独立的宿主端口：

- `AppUiPort`（宿主机制）：`pickDirectory` / `formalKnowledgeVault`
- `InstitutionalUiPort`（机构访问）：配置、会话、可达性

`openExternal` / `openResourceExternal` 归 `helpers`，`prompt` / `command` 归 `sessions`。
`onKnowledgeEvent` 是宿主内部事件桥，**不再暴露给插件**。

### 操作名清单

宿主保留每个域的路由表（操作名 → 实现的映射）。它是**授权边界**，不是领域知识：

- 宿主拒绝路由表外的操作名（`Unknown knowledge operation: <op>`），在任何实现运行之前。
- 新增操作名要在宿主加一行——但只加**一个字符串**，不改 schema、不改类型、不改 IPC 通道、不改生成物。

域内 schema 与校验归插件（计划行要求：keep domain schemas with validation with plugin owners）。

## 为什么不是「一个全局 catch-all」

计划行原文警告 `not a catch-all call`。按域分组同时满足两点：

1. **域的边界在宿主**——`knowledge:` / `daily:` / `zotero:` 三个独立通道，操作名拼错不会落到别的域。
2. **域的内容在插件**——域内操作名和 schema 都由插件拥有。

单一全局 `invoke(op, input)` 会丢掉域这个隔离维度，授权与校验只能全靠插件自报；保留具名方法则完全达不到「只改插件」。

三个通道之间靠 IPC 通道名隔离，宿主在**路由表**这一层再挡一次：通道内的操作名不在表里就拒绝。

## 破坏性范围

- `plugin-api` 的公开导出面变化（`KnowledgeUiPort` 形状变了）——必须走 **下一个 major**，不能随 1.3.0 发。
- 插件 UI 与宿主必须**同批升级**。旧插件 + 新宿主会因操作名不在清单里而被拒。
- `pi-knowledge` 与宿主跨仓协同：宿主先合，插件后合，或按同一批次发。

## 验证

- `npm run lint && npm run typecheck && npm test && npm run build && npm run check:arch` 全绿。
- `node scripts/generate-knowledge-ui-contract.mjs --check` 与 `packages/desktop/scripts/gen-plugin-api.mjs --check` 幂等。
- 结构基线 `scripts/fixtures/structure-baseline.json` 的 ui-wire 行收紧。
- 真实安装包验收：知识面板读路径、评审写入路径、日常发现、Zotero 授权状态四条。

## 未完成

宿主侧已落地（本分支）。插件侧 `pi-knowledge/ui/**` 的 134 处 `getKnowledgeApi()` 调用点尚未迁移，
它依赖宿主先发布新 major 的 `@gyoungwe/plugin-api`——见工单队列的 `T493`。

## 已知坑

`barrel-shadowing.test.ts` 原来用 `ts.createProgram` + `checker.getExportsOfModule` 解析
「barrel 到底从 plugin-api 转发了哪些名字」，在 `origin/main` 上就要 4.4 秒，逼近 vitest 的 5 秒上限；
本分支新增模块后超时。改为**语法层**读 barrel 的具名导出声明（`ts.createSourceFile`），
耗时 5 毫秒。`checker.getExportsOfModule` 在 1178 个导出的 barrel 上单次就要 1.2 秒。
