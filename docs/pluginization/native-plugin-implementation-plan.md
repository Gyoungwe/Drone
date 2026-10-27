# 原生 Pi 插件架构执行计划

2026-10-27 整理。用户已批准「通用宿主 + 可卸载功能插件」并要求 P0–P7 并行实现。依据：[架构设计](../superpowers/specs/2026-10-26-native-pi-plugin-architecture-design.md)。目标仍是完整功能与 UI 同包迁移，当前没有关闭整个目标。

本页当前状态以宿主已提交基线 `3cd2b246` 与插件已提交基线 `13ea239` 为限；进行中的代码与尚未取得终态的检查不计入完成结论。完整历史、旧门禁输出和切片证据已[归档](../archive/native-plugin-implementation-plan-through-2026-10-27.md)；各次真实验收的 PASS 只适用于当时记录的版本与范围。

## 当前阶段状态

| 阶段 | 完成条件 | 当前已证明 | 仍未完成 | 依赖 |
| --- | --- | --- | --- | --- |
| P0 | 依赖/数据归属清单、原生 Pi 兼容矩阵、可重复领域扫描 | 清单与扫描已建立；锁定 1.1.0/latest 1.4.0 的真实会话基础 UI 对照通过 | 全 API 兼容矩阵；按最终迁移结果清零或明确登记边界，当前扫描仍为 `INCOMPLETE` | 无 |
| P1 | 通用 runtime 生命周期、来源绑定、权限、隔离、UI 调用与撤销 | 正式包应用 owner、会话切换、停用/拒绝/恢复/退出切片；来源内容变化使旧授权失效 | 正式包的销毁失败回执；后续领域包在同一候选版本上的完整生命周期复验 | P0 |
| P2 | knowledge 服务、worker、schema 和 UI 同包；删除宿主领域装配与专用路径 | 已安装 host 覆盖阅读/审核/semantic/Vault/capture/publication/reviewer/topic/memory/maintenance 等切片；worker 已选用插件包内资源；生产 compatibility composition 已移到测试 fixture | 剩余宿主领域操作与完整 UI ownership；旧资源生成/打包链删除；正式包 Vault apply/rollback GUI 与全流程；候选版本和锁文件同步后的干净安装 | P1 |
| P3 | research、来源连接器、引用/Zotero 的领域 API 与页面迁移 | connector/write host loader 与停用传播；无插件 fail-closed；backend 已无 research runtime dependency 和两处生产兼容 façade | 完整 Zotero/研究工作流与页面归属；本轮候选包的连接器、写入与正式 GUI 证据 | P2 |
| P4 | tasks、编排、领域记忆及 UI 迁移 | pi-core 已保留历史迁到插件仓库并独立检查；CoreHostLoader、taskHostLoader、acceptance registry 与 workbench client 已接线；生产宿主不再 runtime import pi-core | 完整 workbench 状态机与任务领域装配迁移；原生会话及正式包完整工作流和 UI 验收 | P2 |
| P5 | analysis/evidence 与 discovery 的可卸载实现；依赖经显式合同管理 | analysis/evidence 合同与通用发现；discovery host 合同、Desktop 发现、四组只读 IPC 路由及独立 pi-discovery 包 | discovery B5d–B5f 执行能力和无条件宿主构造的迁移；完整分析/证据工作流与声明矩阵；同候选包实际验收 | P3/P4 |
| P6 | 科研能力成为可卸载预设；删除构建/锁文件必需依赖与旧路径 | `trackedRuntimeDependencies=[]`；UI 安装代次按包内容哈希绑定；knowledge/core/research 的生产 runtime 依赖已收窄 | 锁文件与候选包同步；hoisted/dev/build/resource 闭包审计；剩余领域装配与旧生成链删除；零领域插件最终构建验证 | P2–P5 |
| P7 | 双仓库最终门禁、同 tarball 原生会话、正式包零插件及升级/停用/回滚 | 正式 arm64 通用零插件会话；临时 registry 跨版本升级/回滚/移除/恢复及活跃会话 reload；公开 pi-evidence 0.1.1 同版安装/更新/移除切片 | 最终同候选 tarball 的真实会话与 GUI；销毁失败；公开跨版本回滚；候选锁文件干净安装与双仓库最终全量门禁 | P6 |

## 当前未完成项

1. 完成 P2–P5 的领域实现和 UI ownership，删除对应宿主装配与临时路径；切片合同、loader 与定向测试通过不等于领域迁移完成。
2. 完成 discovery B5d–B5f 和任务 workbench 全流程，验证未安装/停用时的明确 unavailable 行为。既有 WebDAV、inquiry 归属记录保留，本页整理不新增或扩大宿主边界决定。
3. 同步候选插件版本、`plugins.lock.json`、构建资源与依赖闭包。当前锁定的 pi-knowledge 0.2.1 不含新增 worker host exports，不能用工作树构建产物代替干净安装验收。
4. 使用同一候选 tarball 完成原生 Pi 真实会话、正式安装包的领域 GUI、Vault 写入回读/回滚与完整生命周期，包括销毁失败。既有通用宿主和公开 pi-evidence 切片保留其已证明范围。
5. 在上述结果固定后运行宿主 lint/typecheck/test/build/check:arch、插件仓库完整 check 和最终领域边界门禁，保存终态与来源版本。历史全量或直接 workspace 检查不替代最终根命令的干净安装门禁。

## 检查与证据规则

- `check:native-plugin-boundary` 当前仍为 `INCOMPLETE`；静态清零也不能替代真实启动与安装包证据。
- 单元/fixture/loader 测试只写“测试通过”；只有真实会话或正式安装包实际覆盖的行为可标记对应切片 PASS。
- 包来源与授权按持久化的 packageName→{root,hash} 安装代次绑定；入口或嵌套依赖内容变化需重新授权。
- 新接口按设计版本化，旧 npm 版本不可变；未发布候选与已发布版本必须区分。
- 主代理负责集成、共享合同、端到端和最终门禁；子代理按 runtime、UI、领域迁移分工，共享文件先明确 ownership。

## 保留但不属于本目标

旧计划的四项外部真实验收保持未完成：Zotero 云端/身份冲突、用户自有认证 MCP、Protocols.io 写入、其他平台真实桌面。它们不属于本轮 P0–P7 的完成条件，也不能被本轮本地测试改写为 PASS。恢复配置见[阶段状态汇总](../plan-final-status-2026-10-26.md)。

MinerU/GROBID、B8 云端协作及 B8-2 保持暂缓/按用户要求暂不实施，不新增基础代码。

## 执行记录

只保留最近 30 条去重记录，描述各切片发生时的状态；后续替代关系以本页“当前阶段状态”为准。更早及重复原始记录见[完整历史](../archive/native-plugin-implementation-plan-through-2026-10-27.md)。

- 2026-10-27：重新运行 arm64 正式 `Drone.app` 的 `check-packaged-desktop.mjs`，全新 HOME/profile、空 optional UI 根、空 managed npm 根和空 auth/model 存储下通过实际 Electron 启动、preload、知识未绑定、semantic/topic IPC、研究命令及 generic Pi session 创建/关闭；回执为 `passed:true`。安装/停用/恢复/升级/回滚/销毁失败仍为 `NOT_RUN`，不计为完整 P7 验收。
- 2026-10-27：同一正式包隔离 profile 运行 `check-packaged-desktop.mjs --lifecycle-package=@gyoungwe/pi-evidence`：真实安装 `0.1.1` 回执为 `staged → verified → enabled`，随后移除回执为 `disabled → drained → disabled`，读回确认 managed package 目录和配置入口已消失。该切片仅关闭 packaged install/remove，restore/upgrade/rollback/destroy-failure 仍未运行。
- 2026-10-27：正式包生命周期脚本扩展为 install→update→remove；隔离 profile 对 `@gyoungwe/pi-evidence` 收到三组成功回执，update 重新安装并回读 `previousVersion=version=0.1.1`。这证明真实 update/disable 清理路径，但不是跨版本升级；restore/跨版本 rollback/destroy-failure 仍未运行。
- 2026-10-27：正式 arm64 包通过隔离临时 registry fixture，以真实 generic Pi session 作为 reload 目标，完成 `1.0.0 → 1.1.0 → 1.0.0 → remove → restore(1.0.0) → remove`；显式 `rollbackPackage(name, version)` 产生 `previousVersion=1.1.0`、`version=1.0.0` 和 `rolled_back` 回执，六步均回读同一 `reloadedSessionIds`，restore 再次返回 `staged → verified → enabled`，最终 remove 清理包目录和配置。该结果关闭 P7 的跨版本升级/回滚/停用恢复/活动会话 reload 切片；reload-deferred、销毁失败和同 tarball GUI 仍未完成。
- 2026-10-27：本轮生命周期合同的 focused Vitest 15 项、shared/backend/desktop typecheck、Biome、`check:arch`、`check:plugin-api -- --migration --lifecycle` 和 `npm run lint` 通过；`npm run dist --workspace=@drone/desktop` 以 `CSC_IDENTITY_AUTO_DISCOVERY=false` 成功生成 arm64/x64 包。默认 `npm test` 的 `fetch:plugins` 因 GitHub SSL 网络失败，绑定当前插件 checkout 的重跑又因 checkout 版本高于 `plugins.lock.json`（`pi-knowledge@0.3.0` vs lock `0.2.1`）停止，均未冒充全量门禁 PASS；已保留这些阻塞原因。
- 2026-10-27：P2 worker seam 最小切片：`@gyoungwe/plugin-api` 的 `KnowledgeHostLoader` 增加可选 `configureWorker`，backend 仅提供经过 worker manifest 校验的 host-owned factory/metadata，安装 loader 自行决定何时配置 worker；无 loader 仍走 legacy `configureBackendKnowledgeWorker`。backend create-backend 28 项、plugin-api package gate、插件 knowledge host-loader 3 项、backend typecheck 与 `check:arch` 通过。worker 本体、完整 compatibility 删除、锁定插件版本及正式安装包 GUI 仍未完成，P2/P6 保持部分完成。
- 2026-10-27：P2 worker fallback 收窄：`createBackend` 不再在无 loader 时自动调用 `configureBackendKnowledgeWorker`；通用宿主不会解析或启动 legacy worker，缺少 knowledge plugin 保持 fail-closed。显式兼容/测试调用仍可使用公开 `configureBackendKnowledgeWorker`，已补缺失 worker 根目录下的无插件启动回归；backend typecheck、create-backend/worker lifecycle 34 项、Biome 与 `check:arch` 通过。worker 本体和 compatibility 模块仍保留为显式迁移边界，P2/P6 不标记完成。
- 2026-10-27：P2 worker package-local seam：`KnowledgeHostLoader.configureWorker` 现在由 pi-knowledge 选择其包内 `lib/knowledge/runtime/worker.mjs`，host factory 尊重该 `file:` URL 并按相邻 manifest 校验字节哈希后再启动；legacy `configureBackendKnowledgeWorker` 拆出独立 host-root 适配，避免旧测试/兼容服务被新 URL 语义改变。插件 host-loader 4 项、backend worker/create-backend 34 项与 typecheck 通过；electron-builder/`.pi` bundled worker 复制暂保留，因为现有 bundled extensions 和 release fixtures 仍依赖旧资源树，待单独迁移。
- 2026-10-27：worker package-local ownership 收口：`packages/extensions/src/internal/knowledge-runtime.ts` 改为调用已安装 `@gyoungwe/pi-knowledge/host` 的 worker URL/metadata，`check-local-desktop-artifact` 和 knowledge FTS fixture 改校验 `vendor/plugins/pi-knowledge/lib/knowledge/runtime/worker.mjs` 及其 manifest。`.pi/extensions`、`fetch-plugins` 与 electron-builder 的旧复制仍作为显式 legacy/release fixture 保留，尚未宣称资源树完全删除；需要后续迁移 bundled/release 生成链后再清理。
- 2026-10-27：backend legacy worker 路径收窄：生产 knowledge UI 不再导出或执行 host-root `.pi` worker 配置/解析，package-local setup 是唯一 production worker seam；旧兼容配置与资源校验限定在 `packages/backend/test/knowledge-compat-fixture.ts`。backend typecheck、39 项 focused worker/knowledge 回归、Biome 通过；electron-builder/`.pi` 复制链与正式 GUI 继续保持未完成。
- 2026-10-27：P6 依赖收窄：`1044fedf` 删除 backend 对 `@gyoungwe/pi-core` 的生产运行时依赖并同步 `package-lock.json`；backend typecheck、memory-save/deliver-files/todo 11 项回归与 `check:arch` 通过。当前宿主仍追踪 `@gyoungwe/pi-knowledge`，compatibility/worker 迁移继续保持未完成。
- 2026-10-27：知识默认构造 fail-closed：`KnowledgeUiService` 及所有 knowledge operation helper 的默认 compatibility 改为 backend 内置 `unavailableKnowledgeCompatibility`；无插件时直接构造服务不会加载或实例化 legacy background reviewer，默认 overview 返回明确 unavailable。显式迁移测试仍可注入 `defaultKnowledgeCompatibility`。backend typecheck、create-backend/knowledge-host-ui-reading/worker-lifecycle 35 项、Biome 通过；`pi-knowledge` compatibility/worker 删除与正式 GUI 仍未完成。
- 2026-10-27：P2/P6 runtime dependency 收窄：删除生产源码 `knowledge/compat.ts` 与 `compat-adapter.ts`，legacy package composition 移到 `packages/backend/test/knowledge-compat-fixture.ts`，`configureBackendKnowledgeWorker` 改为显式接收迁移测试 setup；backend 对 `@gyoungwe/pi-knowledge` 从 dependencies 下移到 devDependencies，锁文件同步。backend typecheck、create-backend/knowledge-host-ui-reading/worker-lifecycle 36 项、Biome、`check:arch` 通过；`check:host-domain-deps` 的 `trackedRuntimeDependencies` 已为空，native boundary 的 knowledge runtime import 已清零，剩余 runtime import 仅 discovery/inquiry，worker 本体迁移与正式 GUI 仍未完成。
- 2026-10-27：native boundary 决策：`@drone/inquiry` 暂保 host foundation，负责跨 compute/tasks/local execution 的 artifact/finding/question/attempt/decision 账本、项目隔离与 decisions/inquiry IPC；不把它误下移为可选插件。`@drone/discovery` 归入下一阶段 optional plugin 迁移（可新建 `pi-discovery` 或并入 `pi-research`），先拆出 host-owned 容器/授权/KernelRunner 与 Inquiry 注入合同，再迁移 B5d–B5f exploration/critic/evaluation/UI 并删除 backend 的无条件构造。当前两项均不改 manifest，native boundary 仍保留 discovery/inquiry runtime findings。
- 2026-10-27：discovery host seam contract：`@gyoungwe/plugin-api` 新增版本化 `DiscoveryHostLoader`/`DiscoveryHostPort`（status、kernel session 基础操作），backend 通过 `BackendOptions.discoveryHostLoader` 暴露显式 `discoveryHost`；当前 native `DiscoveryService` 仍为权威实现，loader 只建立注入合同，未切换默认 IPC 或 runtime 依赖。plugin-api build、backend typecheck、create-backend 32 项回归与 Biome 通过，完整 discovery 插件迁移仍未完成。
- 2026-10-27：Desktop discovery wiring：通用已安装包发现器按 `discovery` capability/export 发现 host loader 并注入 backend；optional-plugin-hosts 10 项回归、Desktop typecheck/Biome 通过。当前仅完成发现/注入边界，B5d–B5f 算法与 native IPC 仍由宿主实现。
- 2026-10-27：`30646945` 扩展 DiscoveryHostPort 与可选 host-owned factory，固定后续把 B5d–B5f 从宿主移入可卸载插件的合同；`36a2569f` 同时删除 research connector/write 的重复兼容 facade，保留领域服务中的空 registry fail-closed。两片均通过针对性回归与类型检查，完整实现和真实账户验收继续列为未完成。
- 2026-10-27：`c7ca4736` 将 discovery 的四组只读列表 IPC 接入已安装 host 优先路由，并保留 native fallback；`5f10468f` 让 tasks/workbench 接收已安装 `TaskHostLoader` 并复用其 registry。两片分别通过 2 项 Desktop IPC 回归与 35 项 create-backend 回归，完整 discovery B5d–B5f 和任务状态机仍未关闭。
- 2026-10-27：`d07ec700` 完成 tasks capability 的 Desktop 通用发现与宿主注入，11 项 optional-plugin-hosts 回归、Desktop typecheck/Biome 通过；pi-core 仍未声明 tasks host entry，因此暂不标记真实任务插件或 P4 完成。
- 2026-10-27：插件 `279268e` 已补齐 pi-core 的 tasks capability/`taskHostLoader`，pi-core 独立 check 通过；宿主发现链现在具备实际包入口，但完整 workbench 状态机与正式安装包 GUI 仍未关闭。
- 2026-10-27：合并后宿主 backend 全量 259 files/2087 passed/18 skipped，插件仓库 `279268e` 全量 check exit 0；当前仍按计划保留 knowledge 锁定版本同步、完整 discovery/workbench 迁移、正式 GUI 与外部账户验收缺口。
- 2026-10-27：`b3895779` 为 tasks host contract 增加可选 workbench client 并接入宿主 runtime；未安装或未提供 client 时继续 fail-closed/兼容 registry。该 slice 通过 create-backend 35/35，但 pi-core workbench host 实现和完整 P4 仍待后续。
- 2026-10-27：插件 `8ce3ab7` 新增可独立安装的 `pi-discovery@0.1.0` 只读 host 包，workspace check 通过；宿主锁定、执行类能力和完整 B5d–B5f 迁移仍未完成。
- 2026-10-27：`4f327fb`/`4b5c87ac` 完成 task host workbench client 的首条接线，`d1ccc2e`/`d8f7b731` 完成 knowledge topic list/archive 的安装 host 路由；这些切片均通过定向测试，P2/P4 完整领域迁移仍保持部分完成。
- 2026-10-27：正式 arm64 包公开 `pi-evidence@0.1.1` install/update/remove 回执已补入 `6cdbc1f1`，跨版本公开回滚、同候选 tarball GUI 和销毁失败继续保持未完成。
- 2026-10-27：`212c6ef`/`e5c46c16` 将 knowledge memory/daily-discovery 四项操作接入安装 host，create-backend 37/37 与插件 host-loader 5/5 通过；P2 其它 compatibility.call、完整 UI ownership 和正式 GUI 仍未完成。
- 2026-10-27：Cloud boundary audit 确认 WebDAV credential/network/write/CAS 仍是宿主基础设施，未拆出只读假垂直；P2 后续继续处理剩余 compatibility.call 与完整 knowledge UI ownership。
- 2026-10-27：`13ea239`/`54de5567` 将 knowledge maintenance topic 与 Wiki proposal staging 接入安装 host，保留 revision/CAS 与无插件 fallback；create-backend 38/38、插件 host-loader 5/5 通过，P2 仍未完成全部 UI/compatibility 删除。
- 2026-10-27：P2 reviewer/worker 接缝继续收口：宿主 `9d1218ec`/`a0731632` 通过 `knowledgeHostLoader.backgroundReviewer` 注入已安装知识插件的后台审阅器，并以显式 compatibility fixture 保留单元测试；插件 `042ba7b`/`8a581c5` 同步 reviewer factory、临时 bundled host worker 查找和 host-loader 回归。backend 全量测试 259 files/2085 passed/18 skipped，插件完整 `npm run check` 通过；正式插件版本与 `plugins.lock.json` 的 0.2.1 仍未同步，因此 clean-install gate 继续保持未完成。
- 2026-10-27：P3 research host-neutral cleanup：`36a2569f` 将无插件 connector/write registry 直接收拢到领域 service，删除 backend 生产路径上的两个 compatibility façade；不改变 host loader 注入优先级或 fail-closed 行为。定向 46 项回归与 typecheck/Biome 通过，P3 真实来源连接器和写入验收仍保持部分完成。
