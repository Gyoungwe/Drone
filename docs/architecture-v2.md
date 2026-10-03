# Drone 架构升级方案 v2

> 状态：提案（2026-09-30），基线为 `main@c4b0d80`（v0.12.0）
> 配套任务拆解：[architecture-v2-tasks.md](architecture-v2-tasks.md)
> 本文只讲**结构**：模块边界、依赖方向、契约形态和迁移路径。产品行为与信任语义（一次授权、证据门、发布门禁、Wiki 审核）**一律不变**，见 §5。

## 0. 一句话

Drone 的产品语义已经相当成熟，但代码结构还停在"一个 TS 宿主 + 一大块运行时加载的 `.mjs`"的形态。这次升级有三个目标：

1. 把信任边界相关的领域核心（知识服务、发布门禁、任务授权）搬进**有类型、可单测、显式注入**的 workspace 包；
2. 把 `PiBackend` 拆成若干领域服务；
3. 把 IPC、LAN、插件这三条跨进程通道统一到**一份带运行时校验的契约**上。

整个过程分阶段推进，每个阶段都可以单独发版，不改用户数据格式，也不影响 Pi CLI 的兼容性。

---

## 1. 现状基线（实测）

| 维度 | 数值 | 来源 |
|---|---|---|
| `packages/shared/src` | 61 个文件 / 9.0k 行 | `find … \| wc -l` |
| `packages/backend/src` | 92 个文件 / 16.7k 行 | 同上 |
| `packages/desktop/src`（main 3.7k · renderer 35.1k · lan-web 2.9k） | 314 个文件 / 41.8k 行 | 同上 |
| `.pi/lib` + `.pi/extensions`（**无类型 `.mjs`**） | 75 个文件 / 20.0k 行 | 同上 |
| `pi-backend.ts` | 1,665 行，`PiBackend` 类约 90 个方法（其中 42 个 private） | 源码 |
| IPC 通道 | 124 个（`shared/src/ipc.ts` 718 行） | `IpcChannels` |
| `globalThis[Symbol.for("drone.*")]` 桥 | 10 个不同的 key，分布在 11 个文件 | `grep Symbol.for("drone.` |
| 后端直接用相对路径穿进 `.pi/` | 2 处（`tools/subagent/runner.ts`） | `../../../../../.pi/…` |
| 后端测试直接 import `.pi/lib` | 55 个测试文件 | `grep -l .pi/lib packages/backend/test` |
| 测试 | backend 1,320 · desktop 528 · shared 102，全部通过；`typecheck` 通过 | 本地 Node 22.22 实跑 |
| backend 测试耗时 | 约 336 s（collect 100 s + tests 186 s） | vitest 汇总 |

现有设计里做对了、要保留的东西：

- Pi SDK 运行时值导入收敛到会话引擎边界（`session-engine/sdk.ts`，钉 0.84.3）；`PiBackend` 保留兼容门面
- renderer 不碰 SDK
- `INVOKE_ROUTES` 已经收敛了一部分 IPC 样板
- 五个扩展挂钩（`docs/extension-hooks.md`）已经去掉了硬编码的工具/技能表
- `emitEvent` 是事件单点（event-slim → stream-guard → 发布投影 → trace）
- `JsonStore` 统一原子写
- 发布门禁在桥缺失时失败关闭（`session/knowledge-publication.ts`）

---

## 2. 问题诊断

### P1 · 信任边界代码放在类型最弱的一层

`docs/extension-hooks.md` 明确规定"证据门 / 发布边界、同意总线……不下放到扩展"，但它们的实现实际在 `.pi/lib/knowledge/{publication,service,extension}.mjs`、`.pi/lib/tasks/{workbench,register}.mjs` 里：没有类型、运行时才加载、通过 `globalThis` Symbol 和宿主握手。于是出现了这些现象：

- 后端必须为"桥没加载"写兜底的失败关闭逻辑（`knowledge-publication.ts` 的 `failClosedEvent`）；
- shared 里要手工镜像 `.mjs` 的常量（`task-workbench.ts`："Mirrors `.pi/lib/tasks/workbench.mjs` REASON_TEXT"）；
- 重构时编译器帮不上忙，只能靠 55 个测试文件兜底。

### P2 · 两个模块世界靠全局变量握手

10 个 `Symbol.for("drone.*.v1")` key 同时承担了"单例"、"跨模块通信"、"进程级锁/队列"三种职责（比如 `worker-pool`、`semantic-lock`、`wiki-review-locks`）。它们的问题是：

- 生命周期不受宿主控制：dispose 和测试隔离都得靠约定；
- 多个实例可以并存：比如测试 import 了第二份模块；
- 依赖关系在 import 图里看不见。

### P3 · `PiBackend` 是上帝对象

同一个类里放了会话、模型、设置、权限、MCP、包管理、子代理、知识、Zotero、信任、登录、审批分发等十余个域，约 90 个方法。结果是：

- 任何一个域改动都要碰这个 1.6k 行的文件；
- 测试只能构造完整的 `PiBackend`；
- desktop main 只能 import 整个门面。

### P4 · 跨进程契约只有类型、没有运行时校验，而且要多处同步

- 新增一个 IPC 通道要同步四处（`docs/INDEX.md` 硬约束）；
- 给插件暴露一个 hook/store 要同步五处；
- `INVOKE_ROUTES` 只收敛了"方法名 ↔ 通道名"，参数和返回值**没有运行时校验**：renderer 传什么，main 就原样透传给 backend；
- LAN（`lan/server.ts` + `shared/lan.ts`）是第二套独立的投影契约。

### P5 · 事件管线是隐式的

`emitEvent` 的阶段顺序和每一步的失败语义（瘦身失败怎么办、投影失败要关闭、trace 失败要放行）只写在注释和 PITFALLS 里，没有一个可以单测的结构。新加消费方（比如子代理面板、LAN）时，很容易绕过某一个阶段。

### P6 · 持久化没有清单

目前落盘的状态包括 `~/.pi/agent/*.json`、userData、`DRONE_KNOWLEDGE_DIR/<vault>/`、SQLite 索引、会话 jsonl、traces、审计日志、机构会话分区等。每个都有自己的迁移或损坏处理方式，但没有一份"谁拥有哪个文件、schema 是什么版本、怎么迁移、敏感级别如何"的注册表。排障只能靠 PITFALLS 里散落的路径。

### P7 · 工程治理缺口

- `AGENTS.md` 在 `.gitignore` 里，外部协作者和编码 Agent（Codex 等）拿不到仓库规则；
- `.pi/lib/vault-mcp-proxy.mjs` import 了一个不存在的 `vendor/pi-web-ui/…`，而 `obsidian-workbench.mjs` 还在引用它，属于遗留死路径；
- 分层约束（renderer 不碰 SDK、SDK 只在一个地方 import）只写在文档里，没有自动化检查；
- backend 单个测试套件要跑约 5.6 分钟，单元测试和真实 SDK 测试混在一起，本地反馈很慢。

---

## 3. 目标架构

```mermaid
flowchart TB
  subgraph Contracts["@drone/shared — 契约（纯类型 + typebox schema，无副作用）"]
    HostApi[host-api/*：域契约\nmethods · events · access 级别]
    Transcript[transcript/*：UI 状态机（不变）]
  end

  subgraph Domain["领域核心（TS，不 import Pi SDK / Electron）"]
    K["@drone/knowledge\nservice · index worker · publication · wiki-review · topics · specialists-policy"]
    T["@drone/tasks\nworkbench · authorization · acceptance registry · consent"]
    R["@drone/research\nsource-archive · open-access · zotero · institutional · literature"]
  end

  subgraph Ext["@drone/extensions — Pi 适配（薄）"]
    Adapters[registerTool / hooks / commands\n只做参数映射与调用领域 API]
  end

  subgraph Backend["@drone/backend — 组合根 + 会话引擎（唯一 import Pi SDK）"]
    Root[createBackend() 组合根\n构造 DroneRuntime 并注入]
    Engine[SessionEngine\n会话生命周期 · prompt · fork]
    Pipeline[EventPipeline\nslim → guard → publication → trace → fanout]
    Services[领域服务\nmodels · settings · permissions · mcp · packages · subagents · knowledge · zotero · lan]
    Storage[StorageRegistry\n文件清单 · 版本 · 迁移 · 诊断]
  end

  subgraph Desktop["@drone/desktop"]
    Main[main：IPC 由契约生成 + 运行时校验]
    Preload[preload：由契约生成]
    Renderer[renderer：类型化客户端]
    Lan[lan-web：同一契约的 HTTP/SSE 投影]
  end

  Adapters --> K & T & R
  Root --> Engine & Services & Storage
  Engine --> Pipeline
  Root -- 内联扩展工厂（注入 DroneRuntime） --> Adapters
  Services --> K & T & R
  Main --> Services
  Main & Preload & Renderer & Lan -.-> HostApi
  Domain -.-> Contracts
```

### 3.1 包与依赖方向

```
packages/
  shared/        契约与纯函数（新增 host-api/）                 依赖：无
  knowledge/     @drone/knowledge  ← .pi/lib/knowledge/*       依赖：shared
  tasks/         @drone/tasks      ← .pi/lib/tasks/*            依赖：shared
  research/      @drone/research   ← .pi/lib/{source-archive,open-access,zotero-*,institutional-access,literature-*,…}
                                                                 依赖：shared
  extensions/    @drone/extensions ← .pi/extensions/*           依赖：shared + 领域包 + Pi 类型（type-only）
  backend/       @drone/backend                                 依赖：以上全部 + Pi SDK（运行时仅此一处）
  desktop/       @drone/desktop                                 依赖：backend、shared（renderer 只依赖 shared）
.pi/             构建产物 + 技能：extensions/*.mjs 由 @drone/extensions 打包生成（给 CLI 用，保持路径不变）
```

**依赖规则**（由 `scripts/check-architecture.mjs` 在 CI 里强制检查）：

| 规则 | 说明 |
|---|---|
| R1 | 运行时 import `@earendil-works/pi-*` 只允许出现在 `backend/src/session-engine/**`（值导出集中于 `session-engine/sdk.ts`）；其他地方只能 `import type` |
| R2 | 领域包（knowledge/tasks/research）不得 import `electron`、Pi SDK 运行时、`@drone/backend`、`@drone/desktop` |
| R3 | renderer 与 lan-web 只能 import `@drone/shared` |
| R4 | 禁止新增 `Symbol.for("drone.…")`（迁移期白名单只减不增） |
| R5 | 禁止出现穿越包边界的相对路径（`../../../…/.pi/`） |
| R6 | 领域包之间：tasks 可以依赖 knowledge 的**公开类型**；research 可以依赖 knowledge；反方向禁止 |

### 3.2 DroneRuntime：用显式注入替代全局握手

```ts
// @drone/shared/runtime.ts（接口）；实现由 backend 组合根构造
export interface DroneRuntime {
  knowledge: KnowledgeRuntime;      // service 池、binding、publication projector、wiki-review 锁
  tasks: TaskRuntime;               // workbench、acceptance registry、consent bus
  tools: ToolManifestRegistry;      // 原 drone.tool-manifest.v1
  scheduler: KeyedLocks;            // 原各类 *-lock / *-queues，统一的带 dispose 的锁/队列
  log: Logger;
  dispose(): Promise<void>;
}
```

- **桌面模式**：`createBackend()` 构造一个 `DroneRuntime`，第一方扩展用**内联工厂**注册（SDK 已经支持，现有的 `buildExtensionFactories` 就是这么做的），工厂闭包拿到 runtime。第一方扩展不再依赖文件加载，也就不存在"桥没加载"的情况。
- **CLI 模式**（`pi` 读 `.pi/settings.json`）：`@drone/extensions` 打包出来的 `.pi/extensions/*.mjs` 在入口处调用 `createStandaloneRuntime()`，自己持有 runtime。这样 CLI 行为一致，同时不再暴露全局变量。
- **第三方扩展**：继续通过工具定义上的 `drone` 元数据（挂钩 1）声明，通过 `session.getToolDefinition(name).drone` 读取，不需要全局桥。挂钩 2（验收器）改为 `pi.events` 上的版本化注册事件，由宿主收集。
- **失败关闭保持不变**：发布投影从"桥可能缺失"变成"由构造保证存在"。`failClosedEvent` 保留，作为投影器抛异常时的兜底，但不再承担"模块没加载"这一路。

### 3.3 拆分 PiBackend

```
backend/src/
  create-backend.ts        组合根：读配置 → 构造 Storage/Runtime → 构造各服务 → 返回 BackendServices
  session-engine/          SessionEngine 与会话生命周期边界（唯一运行时 import SDK）
    engine.ts              create/open/close/delete/prompt/retry/abort/fork/compact/recall
    extensions.ts          内联工厂装配（原 buildExtensionFactories / buildCustomTools）
    event-pipeline.ts      §3.5
  services/
    models.ts  settings.ts  permissions.ts  trust.ts  mcp.ts  packages.ts
    subagents.ts  knowledge.ts  zotero.ts  institutional.ts  approvals.ts（ask/permission/trust/login 分发）
  storage/                 §3.6
  session-service.ts       Host session service 实现（由组合根构造）
  pi-backend.ts            一版本兼容 re-export，标记 @deprecated
```

`BackendServices` 是一个普通对象（`{ sessions, models, settings, … }`）。desktop main 按域取用，契约层（§3.4）直接绑定到对应的服务方法上。

### 3.4 Host API 契约：一份定义，三种传输

用已经是依赖的 `typebox`，为每个域定义一个契约：

```ts
// shared/src/host-api/sessions.ts
export const SessionsContract = defineDomain("sessions", {
  methods: {
    create: { args: T.Tuple([CreateSessionOptions]), result: SessionMeta, access: "desktop" },
    prompt: { args: T.Tuple([T.String(), T.String(), T.Optional(T.Array(ImageInput))]),
              result: PromptReceipt, access: "desktop" },
    list:   { args: T.Tuple([T.Optional(T.String())]), result: T.Array(SessionMeta), access: "lan-read" },
  },
  events: { event: SessionEvent },
});
```

从这份契约出发：

| 生成 / 派生 | 替代的现状 |
|---|---|
| 通道名 `"sessions:create"` | `IpcChannels` 手写常量 |
| preload 透传 + 事件订阅 | `INVOKE_ROUTES` + 手写 `subscribe` 列表 |
| `PiApi` 类型（`Static<>` 推导） | 手写 `PiApi` 接口 |
| main 注册：`Value.Check(args)` → 服务调用 → 开发模式下校验 result | `registerInvokers` 纯透传 + 各域手写 handler |
| LAN：`access: "lan-read"` 的方法自动暴露为 GET，事件走 SSE | `shared/lan.ts` + `lan/server.ts` 的另一套投影 |
| 插件 Host API：`plugins/host-api.manifest.json` 生成 shim、`host-api.ts`、`env.d.ts`、`drone-ui.d.ts` 标记区 | 手工同步五处 |

新增一个通道，从"改四处"变成"改契约 + 实现服务方法"两处。参数不合法时返回结构化的 `UiError`（复用 `shared/errors.ts`），不再把错误抛进 backend 深处。

`access` 取值为 `desktop` / `lan-read` / `lan-control`，默认 `desktop`。LAN 依然默认只读，`lan-control` 保留给以后使用，这次不开启。

### 3.5 EventPipeline

```ts
type Stage = { name: string; failMode: "closed" | "open"; run(e: SessionEvent, ctx): SessionEvent | null };
const pipeline = [slim, streamGuard, publicationProjection, trace, fanout];
```

- 每个阶段声明自己的失败语义：`publicationProjection` 是 `closed`，抛异常时走 `failClosedEvent`；`trace` 是 `open`，失败时记日志后放行。
- **所有**消费方（desktop IPC、LAN SSE、子代理面板、历史回放）都只从 `fanout` 取事件，结构上保证不会有人绕过投影。
- 有一组表驱动测试覆盖阶段顺序和各阶段的失败语义，替代现在散落在注释里的约定。

### 3.6 StorageRegistry 与诊断

```ts
registerStore({ id: "permissions", path: agentDir("permissions.json"), owner: "services/permissions",
                schema: 3, migrate, sensitivity: "config", backup: ".bak" });
```

- 所有落盘状态都要登记，并通过 `JsonStore` 或其他已登记的适配器（比如 SQLite 索引）读写。
- 提供 `app:diagnostics` 通道和设置页里的"导出诊断包"：包含版本、schema、损坏状态、最近的 incident 快照，敏感项脱敏，**不含**凭据、Vault 正文和会话正文。
- 迁移规则沿用现有的"只做增量迁移、未知的未来 schema 拒绝覆盖"，只是集中到一处。

### 3.7 测试与 CI 分层

| 层 | 范围 | 目标耗时 |
|---|---|---|
| `unit` | shared、领域包、backend 纯逻辑（不启动 SDK） | < 60 s |
| `sdk` | `*-sdk.test.mjs`、真实 `AgentSession` + faux provider | 按现状，可并行 |
| `ui` | desktop vitest + 已有的 CDP 冒烟脚本 | 按现状 |

vitest 使用 `projects` 分组；CI 拆成 `lint+typecheck+arch`、`unit`、`sdk`、`desktop` 四个并行 job，Windows 矩阵保留。

### 3.8 工程治理

- 提交一份**公开的** `AGENTS.md`（硬约束、命令、分层规则、完成标准），私有内容继续放在 `.local/`。
- `scripts/check-architecture.mjs` 检查 R1–R6，违规基线用 ratchet 方式记录（只能减少）。
- 清理遗留死路径 `vault-mcp-proxy.mjs`。它引用的 vendor 已经不存在：要么删除并迁移 `obsidian-workbench.mjs` 里的引用，要么补回依赖。做决定之前先确认有没有用户配置还在指向它。

---

## 4. 迁移路径（绞杀式，每阶段都可发版）

| 阶段 | 内容 | 对用户可见吗 | 回滚 |
|---|---|---|---|
| A0 | 治理基线：公开 AGENTS.md、架构检查脚本（ratchet）、测试分层、死路径处理 | 否 | 直接回退提交 |
| A1 | `.pi/lib` 类型护栏：`checkJs` + JSDoc，把桥对象的类型集中到 `shared/runtime.ts` | 否 | 同上 |
| A2 | Host API 契约 + 运行时校验；先迁 sessions 域，再迁其余域；LAN 复用契约 | 否（非法参数时报错更清晰） | 契约层可以按域开关 |
| A3 | 拆分 PiBackend：组合根 + 服务 + SessionEngine；门面保留到阶段末尾 | 否 | 门面兼容 |
| A4 | EventPipeline 显式化 | 否 | 同上 |
| A5 | 领域包 TS 化：knowledge → tasks → research；`@drone/extensions` 打包生成 `.pi/extensions` | 否（打包资源布局通过校验保证一致） | 每个包单独切换 |
| A6 | DroneRuntime 注入，删除全部 `Symbol.for("drone.*")` | 否 | — |
| A7 | StorageRegistry + 诊断包 | 设置页新增"导出诊断包" | 新功能，可关 |

阶段顺序的理由：

- A0/A1 成本最低，能立刻带来护栏；
- A2 先做，是因为它把"外部接口"固定下来，后面的内部重构（A3–A6）不会影响 renderer 和 LAN；
- A5 风险最大，放在类型护栏和契约都就位之后。

---

## 5. 必须保持的不变量（每个阶段的验收都要覆盖）

1. **发布门禁失败关闭**：投影不可用或抛异常时，助手草稿不外泄（`knowledge-publication-*.test`）。
2. **证据语义**：语义检索命中不产生读回执；发布前必须读当前源（`knowledge-semantic`、`knowledge-peer-patterns`）。
3. **受保护的专家角色**：不能通过配置获得 shell、网络、递归委派或 Wiki 批准能力（`knowledge-specialists*`）。
4. **任务一次授权**：同意绑定不可变的合同哈希，合同一改授权就失效；自保护路径始终走门控（`task-*`、`permission-*`）。
5. **Pi CLI 同源**：`.pi/settings.json` 和 `.pi/extensions/*.mjs` 的路径与行为对 CLI 用户不变。
6. **打包布局**：`electron-builder.yml` 的 extraResources 布局通过 `scripts/check-knowledge-package.mjs` 和 `check-packaged-desktop.mjs` 校验。
7. **用户数据**：不改任何已落盘文件的格式；只允许增量迁移，遇到未知的未来 schema 拒绝覆盖。
8. **Desktop 与 LAN 共用 transcript reducer 和 Run Inspector 语义**。

---

## 6. 取舍与不做的事

- **不换技术栈**：Electron、React、Zustand、vitest、biome 都保留；不引入 ORM，不换数据库。
- **不引入 DI 框架**：组合根就是普通函数，依赖通过参数显式传入。
- **领域包不做成独立发布的 npm 包**：只在 workspace 内部使用，降低版本管理成本。
- **LAN 不开放写操作**：契约层预留了 `lan-control`，这次不启用。
- **不在这次升级里改产品行为**：凡是会导致行为变化的发现，单独开 issue 处理。
- 代价：A5 会一次性改动大量文件的路径，55 个测试的 import 需要跟着迁移；打包步骤多一个 esbuild 构建。这两点都由阶段性的校验脚本兜住。

## 7. 度量目标

| 指标 | 现状 | 目标 |
|---|---|---|
| 无类型的第一方运行时代码 | 20.0k 行 `.mjs` | 0（`.pi/extensions` 只剩构建产物） |
| `Symbol.for("drone.*")` | 10 个 key | 0 |
| `pi-backend.ts` / 最大的 backend 类 | 1,665 行 / 约 90 个方法 | 每个服务 ≤ 400 行；SessionEngine ≤ 600 行 |
| 新增一个 IPC 通道需要改的地方 | 4 处 | 2 处（契约 + 服务） |
| 插件 Host API 暴露需要改的地方 | 5 处 | 2 处 |
| IPC 参数运行时校验 | 0 / 124 | 124 / 124 |
| backend 单元层测试耗时 | 336 s（混合） | unit < 60 s |
| 分层规则自动化检查 | 无 | R1–R6 在 CI 中强制 |
