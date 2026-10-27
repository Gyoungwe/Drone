# 原生插件能力发现与 clean-prefix 包验收

日期：2026-10-27。整理基线：宿主 `c29c5037`、插件 `9646a53`。本页汇总已提交切片，不给进行中的代码或未结束检查补写 PASS。完整原始记录（含所有 receipt 路径、哈希、历史门禁和当时的未完成声明）已[归档](../archive/native-plugin-capability-slice-evidence-through-2026-10-27.md)。

本轮 P0–P7 仍未全部完成；阶段清单以[执行计划](native-plugin-implementation-plan.md)为准。历史 PASS 继续有效，但只证明其记录的版本、数据与路径，不能外推到当前候选或整个领域。

## 当前证据覆盖

| 范围 | 已有证据 | 不能据此宣称完成 |
| --- | --- | --- |
| 能力发现与来源 | 通用 manifest/capability loader、空 managed root、安装代次内容哈希和权限撤销回归 | 全部领域迁移和最终零插件宿主 |
| 原生 Pi / 包独立性 | research-suite clean-prefix tarball：4 extensions、22 tools；锁定 1.1.0/latest 1.4.0 部分真实会话；pi-core 独立 check | 所有 API、所有候选 tarball 的最终兼容与发布后干净安装 |
| 正式包通用宿主 | 隔离 profile、空 optional UI/npm roots 的 generic session create/close；应用 owner、会话切换、停用/恢复和退出切片 | 最新领域候选包的完整 UI / Vault 写入工作流 |
| 正式包生命周期 | 临时 registry 1.0.0→1.1.0→1.0.0→remove→restore→remove；真实活跃会话 reload 与 reload-deferred；公开 pi-evidence 0.1.1 install/update/remove | 公开包跨版本回滚、销毁失败、同一候选 tarball 的完整 GUI |
| knowledge 迁移 | 包内 worker/reviewer、host operations、Vault CAS、topic/memory/maintenance 等定向测试 | 全部宿主装配/旧资源删除和正式包完整领域验收 |
| research/tasks/discovery | research fail-closed 与 façade 删除；tasks acceptance/workbench host 注入；pi-discovery 只读包和 Desktop 路由 | 完整 Zotero/研究/任务工作流、B5d–B5f 执行迁移与完整 GUI |
| 已记录门禁 | 历史 backend 全量曾记录 259 files/2087 passed/18 skipped；插件完整 check；各切片类型检查与构建 | 当前候选锁文件的根命令/干净安装最终全量通过 |

历史 pi-knowledge 0.2.1 源码锁缺失新 worker exports 的问题已由 `74fe57e2` 修正；候选 0.3.0 通过默认远程 fetch 和冻结宿主 `c29c5037` 的独立根门禁。后续在途领域迁移与 UI 分支整合尚未包含在该冻结结果中；不同提交的测试计数分别保留，不合并为同一次运行。

## 未关闭项

1. P2–P5 完整领域实现/UI ownership 及宿主装配删除，包含任务状态机、discovery B5d–B5f 和旧知识资源生成/打包链。
2. 候选插件版本、锁文件和干净依赖闭包同步；最终根命令及双仓库完整门禁。
3. 同候选 tarball 的原生真实会话和正式包领域 GUI、Vault apply/rollback、销毁失败与公开包跨版本回滚。通用零插件正式包和临时 registry 生命周期切片已取得真实证据，不在此重复列为“完全未验收”。
4. 最终领域边界扫描仍为 `INCOMPLETE`。WebDAV/inquiry 的既有归属记录不在本次文档整理中重新决策。

四项外部真实验收（Zotero 云端/身份冲突、用户认证 MCP、Protocols.io 写入、其他平台真实桌面）保持未完成，属于旧计划保留事项，**不属于本轮 P0–P7 目标**。MinerU/GROBID、B8/B8-2 保持暂缓，不新增基础代码。配置导航见[阶段状态汇总](../plan-final-status-2026-10-26.md)。

## 最近验收与迁移记录

以下为最近 30 条去重后的历史记录；内容中的“仍未提供”“仍保留”等描述属于该次提交，当前结论以上表与未关闭项为准。更早的记录、重复原文及全部证据细节见[完整历史](../archive/native-plugin-capability-slice-evidence-through-2026-10-27.md)。

- 2026-10-27：knowledge worker fallback 收窄：`createBackend` 删除无 loader 的 legacy worker 自动配置；在缺少插件且 `DRONE_RESEARCH_WORKBENCH_ROOT` 指向不存在目录时，backend 仍可启动并对知识操作 fail-closed。显式 `configureBackendKnowledgeWorker` 仍只用于兼容/测试入口；backend typecheck、create-backend/knowledge-host-ui-reading/worker-lifecycle 34 项、Biome 与 `check:arch` 通过。该切片不代表 worker 本体、compat composition 或正式安装包 GUI 已迁移完成。
- 2026-10-27：knowledge worker package-local seam：插件 host loader 固定选择 `lib/knowledge/runtime/worker.mjs`，并在 runtime metadata 读取时校验相邻 `.knowledge-worker-manifest.json`；host `createBackendKnowledgeWorkerSetup` 验证 loader 传入的 `file:` URL 与同目录 manifest/hash 后才创建 Worker，新增匹配/篡改回归。legacy `configureBackendKnowledgeWorker` 使用独立 host-root setup，worker lifecycle 3 项保持通过。由于 `.pi` bundled extensions、`fetch-plugins` 和 release fixtures 仍需旧资源树，本轮未删除 electron-builder/`.pi` copies，完整所有权迁移继续保持未完成。
- 2026-10-27：backend legacy worker 路径收窄：生产 `knowledge/ui.ts` 删除 `configureBackendKnowledgeWorker`、host-root `.pi` worker resolver 和对应 index exports，仅保留安装 loader 传入 URL 的 manifest/hash 校验；旧 worker 配置与 host-root fixture 移到 `packages/backend/test/knowledge-compat-fixture.ts`。backend typecheck、create-backend/knowledge UI/worker host+lifecycle 39 项、Biome 通过；`.pi`/electron-builder 复制链和正式 GUI 仍未完成。
- 2026-10-27：扩展运行时收口到已安装 `pi-knowledge`：`knowledge-runtime` 不再解析 `.pi/extensions/knowledge-worker.mjs`，而经 host 导出的 package-local URL/metadata 启动并校验 worker；本地桌面产物检查与 FTS 资源 fixture 统一检查 `vendor/plugins/pi-knowledge/lib/knowledge/runtime`。扩展/backend typecheck、Biome、create-backend 32 项、worker lifecycle 3 项及 architecture/host-independence 门禁通过；knowledge-service 全套中既有 maintenance timing case 仍失败，未计作全套 PASS。旧 `.pi` copies、fetch-plugins/electron-builder 复制和显式 legacy fixtures 保留，待 bundled/release 生成链独立迁移。
- 2026-10-27：P6 依赖收窄：`1044fedf` 确认 backend 生产源码已无 `@gyoungwe/pi-core` runtime import，删除 `packages/backend` 的生产依赖并同步锁文件；backend typecheck、memory-save/deliver-files/todo 11 项回归与 `check:arch` 通过。宿主运行时追踪项降为 `@gyoungwe/pi-knowledge`，knowledge compatibility/worker 迁移仍未完成。
- 2026-10-27：P2/P6 默认边界收窄：knowledge UI helper 与 `KnowledgeUiService` 的默认 compatibility 统一改为 backend 内置 `unavailableKnowledgeCompatibility`；无插件直接构造服务不会触发 legacy background reviewer，overview 等操作返回明确 unavailable。`knowledge-host-ui-reading` 的兼容回归显式注入 `defaultKnowledgeCompatibility`，避免测试适配伪装成宿主默认行为；backend typecheck、create-backend/knowledge-host-ui-reading/worker-lifecycle 35 项、Biome 通过。`pi-knowledge` runtime dependency、compat.ts/compat-adapter 与 worker 本体仍是未关闭迁移边界。
- 2026-10-27：P2/P6 兼容组合移出生产：删除 `packages/backend/src/knowledge/compat.ts` 与 `compat-adapter.ts`，将旧 package composition 限定到 `packages/backend/test/knowledge-compat-fixture.ts`；`configureBackendKnowledgeWorker` 现在必须由显式迁移/测试调用方注入 setup，生产 `createBackend`/UI 源码不再 static import `@gyoungwe/pi-knowledge/host`。backend 将 `@gyoungwe/pi-knowledge` 下移至 devDependency 并同步 lockfile；backend typecheck、create-backend/knowledge-host-ui-reading/worker-lifecycle 36 项、Biome、`check:arch` 通过，`check:host-domain-deps` 返回 `trackedRuntimeDependencies: []`，native boundary runtime import 从 4 降至 2（仅 discovery/inquiry）。worker 本体、完整 knowledge UI ownership 与正式 GUI 仍未完成。
- 2026-10-27：剩余 discovery/inquiry 边界复核：`@drone/inquiry` 由 backend 无条件组合并供 compute/task/local execution 与 Desktop decisions/inquiry IPC 共用，定位为宿主证据基础设施；`@drone/discovery` 的 B5d–B5f kernel/exploration/critic/evaluation 属科研业务，后续迁入 optional plugin，但需先提供 host-owned 容器执行、授权、KernelRunner 和 Inquiry 端口。两者当前不改为 devDependency；本轮没有用静态计数掩盖这两个 runtime 边界，`check:native-plugin-boundary` 继续保持 `INCOMPLETE`。
- 2026-10-27：discovery host seam contract：`@gyoungwe/plugin-api` 新增版本化 `DiscoveryHostLoader`/`DiscoveryHostPort`（status、kernel session 基础操作），backend 通过 `BackendOptions.discoveryHostLoader` 暴露显式 `discoveryHost`。现有 backend `DiscoveryService` 仍是权威实现，loader 只建立注入合同，不替换 IPC 或宣称插件行为 PASS；plugin-api build、backend typecheck、create-backend 32 项回归与 Biome 通过。
- 2026-10-27：Desktop discovery wiring：通用 `discoverPluginHostLoader` 现在按 `capability: "discovery"` 发现任意已安装包的 `discoveryHostLoader`，并把它注入 backend 的显式 seam；新增声明包 fixture 回归与 Desktop source wiring 断言。native `DiscoveryService` 仍保持权威实现，尚未迁移 B5d–B5f 行为或切换 IPC。
- 2026-10-27：research host-neutral cleanup：`36a2569f` 删除 backend 的 `research-connector-compat.ts`/`research-write-compat.ts` 两个兼容 facade，把无插件 fail-closed registry 收回领域 service 的明确构造函数；create-backend、research-resource、research-write 共 46 项回归、backend typecheck 与 targeted Biome 通过，真实 connector/写入仍需安装插件和外部账户。
- 2026-10-27：discovery migration seam：`30646945` 扩展 `@gyoungwe/plugin-api` 的 `DiscoveryHostPort`（export/critic/multipath/exploration/evaluation）并增加可选 host-owned `DiscoveryHostLoader.create(input)`；plugin-api build 与 migration/lifecycle gate 通过。native `DiscoveryService`、IPC 和 B5d–B5f 实现仍在宿主，完整 optional discovery 插件迁移未完成。
- 2026-10-27：discovery read routing：`c7ca4736` 将 critic/multipath/exploration/evaluation 列表 IPC 改为已安装 `discoveryHost` 优先、未提供时回退 native service；新增 host-priority/native-fallback 回归 2 项，Desktop typecheck/Biome 通过。kernel 与执行类 IPC、B5d–B5f 算法仍在宿主。
- 2026-10-27：tasks/workbench host slice：`5f10468f` 让 `createBackend` 接收可选 `TaskHostLoader`，安装任务 host 时直接复用其 acceptance registry，并把 capability provider 标为 `plugin:tasks`；无 loader 继续使用隔离 host registry。create-backend 回归 35 项与 Biome 通过，完整任务状态机和正式 GUI 仍未完成。
- 2026-10-27：tasks Desktop discovery：`d07ec700` 让通用安装包发现器按 `tasks` capability/`taskHostLoader` export 发现并注入宿主，optional-plugin-hosts 11/11、Desktop typecheck/Biome 通过。当前 pi-core manifest 尚未声明该 capability，因此真实任务插件发现与完整 workbench 迁移仍未完成。
- 2026-10-27：插件 `drone-plugins@279268e` 为 `pi-core@0.1.9` 增加 `tasks` capability 与 `taskHostLoader`，复用包内 acceptance registry；pi-core manifest/smoke/host-entry/15 tests 与 workspace plugin check 通过。与宿主 `d07ec700` 接线后，真实任务 host 可被发现；任务状态机、桌面完整 workbench 和正式 GUI 仍未完成。
- 2026-10-27：合并 discovery/tasks/research/reviewer seams 后，host backend 全量复跑为 259 files/2087 passed/18 skipped；`npm run lint`（既有 2 warnings）、直接 workspace typecheck、Desktop build、`check:arch` 与 `check:plugin-api -- --migration --lifecycle` 均通过。插件仓库 HEAD `279268e` 的完整 `npm run check` exit 0，pi-core tasks host、knowledge reviewer/worker、locked/latest SDK、clean-install/smoke/pack checks 均覆盖；`plugins.lock.json` 仍未切换到候选 knowledge 0.3.0，故 clean-install/release gate 继续保留未完成。
- 2026-10-27：`b3895779` 扩展 `TaskAcceptanceHostPort` 的可选 `workbench` client；`createBackend` 在已安装 task host 提供 client 时把它接入 runtime/SessionService，未提供时保持原 host registry/fail-closed。create-backend 35/35、backend tsc 与 Biome 通过；pi-core 当前 loader 尚未提供 workbench client，因此 P4 仍未完成。
- 2026-10-27：Knowledge topic vertical：插件 `d1ccc2e` 将 `getKnowledgeTopics`/`archiveKnowledgeTopic` 暴露为 `knowledgeHostLoader.topics`；宿主 `d8f7b731` 同步 plugin-api 合同并让 `KnowledgeUiService.topics/archiveTopic` 已安装 host 优先、无插件继续 fail-closed。pi-knowledge host-loader 5/5、create-backend 36/36、backend tsc/Biome 通过；其余 knowledge write/UI/legacy compatibility 仍未完成。
- 2026-10-27：插件 `8ce3ab7` 新增 `@gyoungwe/pi-discovery@0.1.0`，manifest 声明 `discovery` capability，host loader 按 projectRoot/agentDir 读取 critics/multipath/plans/evaluations 四组只读记录；插件 workspace `npm run check`（9 manifests）通过。该候选包尚未写入宿主 `plugins.lock.json`，kernel 执行、授权、Inquiry 写入和原生 B5d–B5f 计算仍在宿主。
- 2026-10-27：`4f327fb` 让 pi-core 的 task host loader 接收宿主 `PluginRuntimeClient` 并导出 workbench status/plan/todo/memorySave/persist adapter；宿主 `4b5c87ac` 将 host workbench client 注入 loader，plugin-api/backend typecheck 与 create-backend 36/36 通过。完整任务状态机仍未迁移。
- 2026-10-27：正式 arm64 包公开插件生命周期复验 `6cdbc1f1`：真实 `@gyoungwe/pi-evidence@0.1.1` install/update/remove 均成功，回读确认 managed package 与配置清理；这仍不覆盖公开跨版本回滚、同候选 tarball GUI 和 destroy-failure。
- 2026-10-27：Knowledge memory vertical：插件 `212c6ef` 暴露 `memory.dailyContext/saveIdea/relatedForMemory/saveMemory`，宿主 `e5c46c16` 同步 plugin-api 并让 `KnowledgeUiService` 优先路由已安装 host；create-backend 37/37、backend tsc/Biome、pi-knowledge host-loader 5/5 与 build-check 通过。其它 compatibility.call 操作、完整知识 UI ownership 与正式 GUI 仍未完成。
- 2026-10-27：Cloud boundary audit：`KnowledgeWebDavService` 继续保留在宿主，因其拥有 credential precedence、Digest/network transport、Vault adapter、写入授权与 CAS；只把 `getStatus/probe` 拆到插件会分裂安全边界，因此没有新增伪迁移。Vault 文件操作仍经已迁移的 `KnowledgeHostPort.vault`。
- 2026-10-27：Knowledge maintenance topic/wiki slice：插件 `13ea239` 暴露绑定 revision、Vault CAS topic 更新和 Wiki proposal staging；宿主 `54de5567` 让 `setMaintenanceTopic/proposeMaintenanceWiki` 优先走安装 host，旧 `.pi/extensions/obsidian-workbench.mjs` 路径仅作为无插件兼容 fallback。host-loader 5/5、build-check、backend create-backend 38/38、tsc/Biome 通过。
- 2026-10-27：知识插件 reviewer host seam 收口：宿主提交 `9d1218ec`/`a0731632` 将 `BackgroundReviewer` 改为已安装 `knowledgeHostLoader.backgroundReviewer` 注入，无插件默认保持 fail-closed；`deliverable-reviewer`、model-review SDK、create-backend 定向回归分别通过，backend 全量复跑为 259 files/2085 passed/18 skipped。插件提交 `042ba7b` 暴露 reviewer factory 并覆盖 host-loader 回归，`8a581c5` 让 bundled `/tmp` 入口同时从 `PWD`/`INIT_CWD` 祖先安装树解析 worker；插件 `npm run check` 全部通过。正式 host worker 资源回归在当前候选插件构建产物下 2/2 通过。
- 2026-10-27：本轮宿主验证中 `npm run lint` 通过（仅既有 2 个 warning）、直接 workspace typecheck、`check:pi`、Desktop build 和 `check:arch` 通过；`check:native-plugin-boundary` 继续诚实输出 `INCOMPLETE`，discovery/inquiry 与 required-domain-plugin 计数仍保留。根 `npm run typecheck` 的 pretypecheck 会按历史 `plugins.lock.json` 拉取 `pi-knowledge@0.2.1`，该包没有当前 worker host exports，因此在锁定候选发布前不计作 clean-install PASS；候选插件工作树构建产物已用于上述真实 backend/worker 回归。P2–P7、正式安装包同 tarball GUI 和四项外部账户验收仍未关闭。
- 2026-10-27：知识 maintenance 真实 worker 回归补齐 canonical/mirror 标题、metadata、revision、CAS、并发编辑保留、symlink 拒绝与 Wiki proposal staging；插件 `11154ae` 的 knowledge 45 files/356 tests 通过。宿主 `ee52a9c3` 删除无插件时的 `.pi` maintenance 动态导入，create-backend 39/39、backend tsc/Biome/arch 通过。未将 fixture 当作正式 GUI。
- 2026-10-27：discovery 历史记录四类投影与 native writer 的候选 tarball 回归 2/2 通过（宿主 `86d7e972`、插件 `11154ae`）；插件 `9646a53` 修正 suite event bus fixture 后，独立 archive+clean npm ci 的完整 `npm run check` exit 0，真实 SDK 1.1.0/latest 1.4.0、clean install/smoke/pack 均通过。完整 B5d–B5f 仍未关闭。
- 2026-10-27：宿主 `c29c5037` 独立 checkout 的 npm ci、lint/typecheck/test/build/check:arch/check:plugin-api 全部通过，未设置 DRONE_PLUGINS_DIR。知识源码锁固定 `11154ae`/0.3.0/SHA-256 `fa122723…e4fd71`，默认远程 fetch 通过；backend 2091 passed/21 skipped、Desktop 910 passed/1 skipped，公开 UI 包单独干净安装 gate 通过。初次环境缺失与 GitHub TLS 失败及重跑结果均保留；该结果不覆盖在途任务/discovery/UI 整合，见[机器回执](../releases/native-plugin-clean-host-2026-10-27.json)。
