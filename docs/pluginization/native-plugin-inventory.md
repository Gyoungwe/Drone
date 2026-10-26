# 原生 Pi 插件架构：P0 迁移清单与兼容基线

日期：2026-10-26。范围依据：[已批准设计](../superpowers/specs/2026-10-26-native-pi-plugin-architecture-design.md)。本页是实现前源码盘点，不是迁移完成或新安装包验收报告。宿主盘点基线 `a8f004bf`，插件仓库基线 `d2f76a0`；并行实现后的状态以重新执行检查及后续验收为准。

**当前结论：INCOMPLETE。** 已发布包能够在原生 Pi 中加载，部分真实 AgentSession 工作流已有回执；但宿主仍强制构建、导入、打包领域功能，不能称为“无科研插件也可用的通用宿主”。旧 `check:arch`、`check:native-pi` 的通过不代表新架构完成。

## 可执行盘点

```sh
node --test scripts/check-native-plugin-boundary.test.mjs
node scripts/check-native-plugin-boundary.mjs > /tmp/drone-native-plugin-boundary.json
```

第二条命令有发现时退出码为 **1**，输出完整 JSON（`file`、`line` 或 manifest 字段、依赖/命令、分类）。没有允许现状通过的 baseline 或豁免名单，也不修改已有门禁。无发现时仅返回 `STATIC_CLEAR_RUNTIME_UNVERIFIED`、`runtimeAcceptance: NOT_RUN`；这仍须完成真实无插件安装包启动和聊天验收。

首次盘点为 110 条：构建步骤 15、manifest 领域依赖 12、运行时导入 36、类型导入 21、打包资源行 23、必需插件锁 3。数量是静态边的数量，**不是 110 个独立缺陷**。根 manifest 的开发依赖与 backend 的生产依赖分别记录；类型导入属于契约所有权问题，不冒充运行时加载。

扫描覆盖 backend、desktop、shared 的生产源码中的字面量 import / export / dynamic import / require，三个 host manifest、`plugins.lock.json` 和 Electron 打包资源。不覆盖计算出的导入路径、相对导入指向的本地业务实现及任意运行时副作用。以下人工清单补足这部分，不能仅消掉脚本中的包名便宣布完成。

## 所有权与删除条件

| 边界 | 当前源码与耦合 | 迁移目标和删除条件 |
| --- | --- | --- |
| 组合根 | `packages/backend/src/create-backend.ts` 的 BackendServices 强制拥有 knowledge、knowledgeSession、research、researchWrites、dailyDiscovery、knowledgeMaintenance、zotero、institutional、inquiry、analysis、analysisEvidence、analysisTasks、dataDesign 等 | 领域工厂由已安装包注册；组合根仅管理实例生命周期、受限权限与路由。无领域包时不能构造这些服务、开启定时器或导入领域代码。 |
| 知识领域 | `backend/src/knowledge/{ui,webdav,webdav-sync,specialist-bridge}.ts`；`services/{knowledge-session,knowledge-maintenance,daily-discovery,deliverable-reviewer}.ts`；`session/knowledge-publication.ts` | 领域行为、worker、队列和审核语义进入知识插件；宿主保留通用文件/持久化/授权/事件机制。不能把原模块改名为 adapter 就保留业务实现。 |
| 研究与连接器 | `services/{research-resource,research-write,reversible-write-adapters,zotero,institutional}.ts`、`backend/src/zotero/`、`institutional/`；宿主 workspace `research`、`discovery`、`inquiry` | 搜索、捕获、写入方案与写后回读、连接器策略及协议 DTO 归相应插件；通用网络授权、凭据引用和实际执行边界由宿主提供。真实账户四项保持原未完成状态。 |
| 任务编排 | `packages/tasks/src/runtime/register.ts`；`packages/pi-core/src/index.ts` 导入 `@drone/tasks/runtime`；`scripts/build-pi-core.mjs` | 已发布自包含 bundle 不等于源码独立。任务图、调度、交付/审核规则及原生 extension 构建迁往插件仓库，宿主不再构建 pi-core。通用会话/子进程机制留宿主。 |
| 分析与证据 | `backend/src/services/analysis-*`、`compute-data-design.ts`、`compute-experience.ts`；`@gyoungwe/pi-analysis` 必需依赖 | 方案、分析编排、证据审核与可视化归插件；`@drone/compute` 的本地/SSH 执行机制保持独立、由组合根提供通用端口。不可把整套领域 DTO 塞进 compute 或插件 API。 |
| 共享协议 | `packages/shared/src/ipc.ts`、`host-api/{knowledge,research,institutional,inquiry,discovery,evidence,compute}.ts`、`shared/src/knowledge*` | 把业务 schema 与操作名迁到插件；宿主仅校验通用请求信封、可信调用者和贡献者边界。compute 中的通用执行契约与领域契约需逐项拆分。 |
| Desktop 传输 | `desktop/src/preload/index.ts`、`main/ipc/{knowledge,research,institutional,inquiry,discovery,evidence,compute}.ts`、`main/ipc/index.ts` | 插件调用改为声明并登记的通用 operations/events；preload 仍为 CJS。不能允许 UI 任意拼 IPC channel，也不能让 UI 自报 packageId 冒充调用者。 |
| Desktop 页面 | `renderer/src/plugins/knowledge-api.ts` 将 KnowledgeUiPort 绑定到约 56 个具名 PiApi 方法；`components/research/`、`components/panel/EvidencePane.tsx`、知识侧栏/overlay 注册 | 新页面/侧栏由插件贡献，协议和业务状态由插件拥有。现有整页知识 UI 已在 desktop-ui-pack，但具名端口与后端所有权尚未迁移。卸载所有领域包后只保留通用聊天、设置、插件管理和无破损导航。 |
| 构建 | 根 `prebuild`/`pretypecheck`/`pretest` 调用 fetch；build/test 调用 build:pi-core/build:pi-research；`plugins.lock.json` 强制 knowledge/research/analysis | 无领域包的 clean install/build/typecheck/test 不再需要 vendor、领域 workspace 或生成的 `.pi/extensions`。默认推荐安装配置可包含套件，但不是宿主编译前提。 |
| 安装包资源 | `desktop/electron-builder.yml` 打包 research-workbench、知识 worker/manifest、研究技能；beforePack 为 `verify-research-release.cjs` | 包内资源随插件 tarball 和版本发现；宿主发行检查检查通用壳及插件安装完整性，不硬编码知识 worker/研究 bundle。保留 Pi SDK 官方资源、通用计算 runner、沙箱 Node runtime。 |
| 数据与迁移 | `backend/src/storage/registry.ts` 静态登记领域 schema/路径 | 宿主保留 StorageRegistry/JsonStore 的原子写入、损坏处理及敏感度机制；插件登记领域 schema/版本，接管既有路径，不能偷偷搬库或创建第二份账本。 |

### P2 知识垂直切片的具体删除要求

1. 将 `backend/src/knowledge/ui.ts` 的工厂实现与无会话 UI 服务迁到知识插件。该文件当前**导入即调用** `configureBackendKnowledgeWorker()`，注册 `process.on(KNOWLEDGE_WORKER_LIFECYCLE_EVENT, ...)`，共享 `workerLifecycle` 和插件配置。必须改为 app/workspace/session 明确作用域的实例，停用/卸载撤销监听、定时器、worker 和未完成请求；不能新增 process 全局桥。
2. 删除宿主从 `.pi/extensions/knowledge-worker.mjs`、`.knowledge-worker-manifest.json`、`workspace-config.mjs` 和 `DRONE_RESEARCH_WORKBENCH_ROOT` 找知识资源的路径。worker 及完整性校验由**当前已安装插件包**的资源根解析。CLI 与 Desktop 不能分别拥有两个写入同一 Vault 的 worker。
3. 一并迁移 WebDAV、知识发布回执、维护/发现服务及 specialist 的领域逻辑。`knowledge/ui.ts` 还调用 `pi-research/host` 的研究 run 查询，须改为声明的能力调用或清晰拆出研究贡献，不能维持插件间内部导入。
4. 替换 `knowledge-api.ts` 的具名 PiApi 映射；迁移知识业务 schema 与 IPC handlers。通用传输仍要求权限检查、输入 schema、可信调用者、订阅清理。保留已发布 `pluginApi: 1` 契约兼容，按批准设计以新契约并行过渡；旧契约的明确淘汰版本和调用方清单必须登记，不能静默删除现有公开 API。
5. 删除组合根的知识必需构造和知识专属构建/资源步骤，干净安装无知识插件时不会 import、构造或启动知识 runtime。缺插件时提供通用插件安装入口；重装后读取原绑定、原笔记和原审核状态。
6. 通过原生 Pi 真会话、Desktop 实际安装包完整知识闭环、停用/重启/恢复、异常退出和双实例隔离回执后，才关闭 P2。单独 factory 测试、loader.reload 或 UI 挂载截图不足以关闭。

### 持久化接管清单

`storage/registry.ts` 中现有知识绑定、review-policy、specialists；agent 根的 `knowledge-webdav.json`、`knowledge-maintenance.json`、`daily-discovery.json`；Zotero local/web 凭据引用；`research/{captures,connectors,writes}.json`；`analysis/runs.json` 与 evidence 目录；inquiry 账本和 legacy 只读挂载；Vault、研究 results 和 Desktop research-skills 配置均需记录新 owner/schema 后再迁移。审计只读取源码，未打开这些私有数据或凭据。

保持已有数据位置与格式、写入权限和原子 JSON 语义。插件卸载撤销运行能力但保留数据；数据删除继续需要独立授权。并发写入必须通过单一 owner/协调机制，不因 Desktop + CLI 共用包而放松。

## 官方 Pi 兼容性：证据层级

| 现有检查或证据 | 实际覆盖 | 尚不能证明 |
| --- | --- | --- |
| `scripts/check-native-pi.mjs` + fixture | 静态注册映射、工具归属及遗漏/陈旧映射检查 | 没有 import extension、没有会话、没有工具派发。 |
| `scripts/check-pi-compat.mjs` | throwaway prefix 安装锁定 1.1.0/latest/next，官方 DefaultResourceLoader 注册 extension/tools | 没有真实 AgentSession 和 ctx 行为；latest/next 不是固定版本证据。 |
| `scripts/check-host-independence.mjs` | 检查四个“optional”包名字和空包目录；仍允许 core/knowledge/research/analysis | 没有构建或启动无领域包宿主。不能据其输出宣称零插件通过。 |
| `scripts/check-public-plugin-host.mjs` | 已发布 tarball 安装、官方 loader、connector 进程沙箱测试、版本安装升级回滚与 UI 宿主管理器测试 | 脚本固定历史 evidence/connectors/UI 0.1.1；不是当前 UI 0.2.0 的全面验收，也没有覆盖完整 Pi API。 |
| `scripts/check-research-host-session.mjs` | 生成的 research-loop host adapter + 真实 AgentSession、SDK faux provider、两个会话隔离、实际读取回执与持久化 gate | 依赖宿主生成 bundle；不是迁移后包的独立性证明，也不是联网科研质量验收。 |
| 插件仓库 `pi-research/scripts/check-sdk-sessions.mjs` | 包内真实 SDK session 测试；应继续跑锁定 SDK 与当轮解析出的具体版本 | 只验证该脚本执行的研究操作，不代表全部官方 ExtensionAPI。 |
| `remaining-closure-2026-10-26.json` 的 `publicPackages`/`npmPublicationCompletion` | core 0.1.9 在 SDK 1.1.0/1.4.0 的真实任务派发与交付回读；suite 0.1.11 双 SDK 每轮 13 次派发、两来源、批准与知识沉淀回读；真实会话但使用离线确定性模型 | 不自动覆盖新架构代码；不代表公网账户或其他桌面平台通过。 |
| 同一历史证据的 `formalInstalledApp` | macOS arm64 正式 DMG、UI 0.2.0 公开包、PDF 原文页码、停用/恢复、绑定保留 | 没有“完全卸载领域包之后构建并使用通用聊天”证据。 |

历史证据入口：[最终状态](../plan-final-status-2026-10-26.md)、[发布后回执](../releases/remaining-closure-2026-10-26.json)。这里引用既有观察，不把历史 PASS 复制成新架构 PASS。P0 本次仅运行新静态检查与其回归测试，未重新执行以上安装/会话/GUI 矩阵。

### 当前 SDK patch 与沙箱兼容差异

宿主锁定 `@earendil-works/pi-coding-agent@1.1.0`。`patches/@earendil-works+pi-coding-agent+1.1.0.patch` 修改两类行为：

- package manager 的 npm/pnpm/bun 安装与卸载加 `--ignore-scripts`；这是安全策略，不是插件格式变更。依赖 install scripts 的第三方包必须得到明确诊断，不能虚报原样兼容。
- DefaultResourceLoader 增加非上游参数 `extensionFactoryForPath`，在两次扩展加载路径执行前截获并注入 extension factory。`session-engine/sandbox-loader.ts` 对可信包返回原生加载，对其他包构造工具代理。

工具代理路径不能等同官方完整 API。P1/P7 仍须验证工具与命令、flags、events、provider/model 注册、ctx.ui 交互、消息/session 生命周期、技能/提示资源在 Drone 中各自的支持方式；未支持的路径必须给明确兼容诊断，不能静默吞掉注册。原生 Pi 对照使用未打 Drone patch 的官方安装，以免同一补丁同时成为实现和验收依据。

## 后续关闭矩阵与边界

| 检查 | 本轮状态 | 关闭所需证据 |
| --- | --- | --- |
| 静态 P0 inventory + 回归 | 已执行；发现 110 条边；2 个测试通过 | 后续代码变化重新生成 JSON，不能手改数量绕过门禁。 |
| 零领域包 build / start / chat | 未完成 | 全新依赖根，移除领域包和 vendor 前提，构建后的正式安装包真实启动及真实会话；输出具体包清单和产物指纹。 |
| 单插件与全套件生命周期 | 未完成（新架构） | 各包独立安装/启停/重启/卸载/重装、数据回读、故障隔离、无残留资源。 |
| 官方第三方 Pi API 对照 | 未完成（完整 API） | 固定来源/版本、未修改包，官方 Pi 与 Drone 的实际会话行为；原生与沙箱路径分别登记支持/不支持。 |
| 正式安装包 GUI | 未完成（新架构） | 知识、研究、任务、分析/证据贡献及通用壳，截图与操作/回读回执对应。 |
| 四项外部验收 | 按用户要求保留未完成 | Zotero 云端、用户认证 MCP、Protocols.io 写入、其他桌面平台的原配置要求不变，本次不开展。 |
| B8/B8-2、MinerU/GROBID | 暂缓，不实施 | 不新增实现、入口或基础占位代码。 |

执行记录：2026-10-26 新增静态盘点脚本和两项行为回归，检查返回 INCOMPLETE（预期）；没有 npm 发布、账户写入、Vault 写入或正式安装包验收。
