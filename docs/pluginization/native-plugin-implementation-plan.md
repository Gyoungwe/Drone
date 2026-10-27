# 原生 Pi 插件架构执行计划

2026-10-28 更新。用户已批准「通用宿主 + 可卸载功能插件」并要求 P0–P7 并行实现。依据：[架构设计](../superpowers/specs/2026-10-26-native-pi-plugin-architecture-design.md)。目标仍是完整功能与 UI 同包迁移，当前没有关闭整个目标。

当前门禁基线为宿主 `fd4c5040`、插件 `dd7effc`：完整 Wiki 审核/history/undo 与 canonical task owner 已整合，插件完整检查、固定源码 archive/clean ci 重建、默认远程取包与宿主独立 checkout 的六项标准门禁通过；backend 1957 passed/17 skipped、Desktop 912 passed/1 skipped、根 Node 25/25。首次根脚本的旧任务包依赖缓存残留及完整重跑均保存在[本轮回执](../releases/native-plugin-owner-migration-2026-10-28.json)。旧 `5e0c9aab/f4a530a` [回执](../releases/native-plugin-task-owner-host-2026-10-28.json)保留历史范围。native boundary 仍 exit 1/INCOMPLETE，整个目标未关闭。更早历史已[归档](../archive/native-plugin-implementation-plan-through-2026-10-27.md)。

## 当前阶段状态

| 阶段 | 完成条件 | 当前已证明 | 仍未完成 | 依赖 |
| --- | --- | --- | --- | --- |
| P0 | 依赖/数据归属清单、原生 Pi 兼容矩阵、可重复领域扫描 | 33 API/41 事件/28 UI 声明盘点；真实 SDK 主/恢复/子会话 onError 与通用通知、custom/theme 明确失败、沙箱诊断、managed prompt mutation、两条 process 路径的工具 metadata/进度与真实拒绝 | 其余 terminal no-op、managed ctx/getter；locked/latest 完整矩阵；扫描仍 `INCOMPLETE` | 无 |
| P1 | 通用 runtime 生命周期、来源绑定、权限、隔离、UI 调用与撤销 | 正式包应用 owner、会话切换、停用/拒绝/恢复/退出切片；来源内容变化使旧授权失效 | 正式包的销毁失败回执；后续领域包在同一候选版本上的完整生命周期复验 | P0 |
| P2 | knowledge 服务、worker、schema 和 UI 同包；删除宿主领域装配与专用路径 | maintenance plan/run 安装 loader 与调度回归；dd7 同 tarball 的真实受限双进程/SDK owner、UI 读写授权；canonical 审核/history/undo 已整合，partial→retry 仅写 Vault 一次及完整退出已验收 | 完整 hooks/publication proof、模型审核与其余 UI、宿主领域操作/IPC与旧资源删除；正式 GUI | P1 |
| P3 | research、来源连接器、引用/Zotero 的领域 API 与页面迁移 | 安装 host fail-closed；真实生产 summary review→delivery→回读→receipt；4 个隔离 specialist 与单独摘要 reviewer、拒绝/rollback/CAS/路径回归 | 仍有迁移期宿主 FS writer；完整 Zotero/研究 owner 与页面归属；本候选连接器/写入正式 GUI；上述测试不覆盖全部 protected Wiki reviewer | P2 |
| P4 | tasks、编排、领域记忆及 UI 迁移 | knowledge 停止隐式任务 guard；真实 SDK 无 core 的基础 read/write/bash 与权限拒绝、两种安装加载顺序及 24 项任务回归；typed core 与 milestone 规则；canonical 状态机/guard/owner 已归插件，宿主 tasks 与反向 workbench port 删除，真实多会话/registry 隔离与恢复通过 | 任务 UI ownership、动态启停与正式 GUI；通用 UI seam 和 core UI 迁移仍在隔离分支 | P2 |
| P5 | analysis/evidence 与 discovery 的可卸载实现；依赖经显式合同管理 | discovery 算法/状态归插件，宿主仅注入机制；无插件不构造旧实现/登记存储；真实包后端 73 项定向测试 | native discovery 工具、真实容器和 B5 GUI；完整分析/证据控制器与 UI 迁移、同候选工作流验收 | P3/P4 |
| P6 | 科研能力成为可卸载预设；删除构建/锁文件必需依赖与旧路径 | 四包同提交候选已独立重建；core 与 tasks 旧源码删除，任务不再生成宿主 runtime；discovery runtime 依赖下移；`trackedRuntimeDependencies=[]` | 4 个必需领域源码锁及 hoisted/dev/build/resource 闭包删除；旧 bundled 装配、领域 schema/IPC 与预设卸载；零领域独立构建 | P2–P5 |
| P7 | 双仓库最终门禁、同 tarball 原生会话、正式包零插件及升级/停用/回滚 | 当前 fd4c5040/dd7effc 标准门禁通过，opt-in packed core/knowledge/discovery 与私有 API 1.3 tarball 已启用；真实 knowledge 审核写入与双进程完整退出 | 全领域最终候选、正式安装包 GUI、销毁失败/公开跨版本回滚、真正无领域资源宿主；本轮未新建正式安装包 | P6 |

## 当前未完成项

1. 完成 P2–P5 的领域实现和 UI ownership，删除对应宿主装配与临时路径；切片合同、loader 与定向测试通过不等于领域迁移完成。
2. 完成 discovery 原生工具/容器/B5 GUI 与任务界面；无 core 的隐式 guard 阻断已修复，canonical 任务 owner 已整合，继续迁移任务 UI。WebDAV/inquiry 的既有归属记录保留，不借本次状态同步扩大边界。
3. 四包源码锁已同步为 `dd7effc`；它仍是迁移期构建必需依赖。继续删除这些领域锁与旧资源闭包，证明不下载科研插件也能独立构建，而不是仅把版本同步当作 P6 完成。
4. 使用同一候选 tarball 完成原生 Pi 真实会话、正式安装包的领域 GUI、Vault 写入回读/回滚与完整生命周期，包括销毁失败。既有通用宿主和公开 pi-evidence 切片保留其已证明范围。
5. 当前候选的双仓库标准门禁已完成；后续迁移仍须固定来源后复验，并清理最终领域边界门禁。历史全量或直接 workspace 检查不替代未来最终候选的根命令与正式包验收。

## 后继并行工作

- P2 完整审核与 native SDK envelope/private replay 已整合到 `dd7effc/fd4c5040`。公开 tool-only、私有 signed thinking 和最终 fail-closed 保留；完整 managed hooks/proof、模型审核、其它 UI 与旧宿主 IPC 仍未迁完。
- P4 canonical task owner、170 项规则与 29 项基础测试已归插件，宿主 `packages/tasks`、隐式 singleton 与反向 workbench port 已删除。新增 native 合同使用私有 API 1.3 候选，SHA-256 `a05e593f…472fed`；它不含尚未整合的 UI seam。
- 通用 UI seam `codex/core-ui-seam@6ebf7c6` 已独立验证：sessions.prompt、稳定 useSessionMessages、chat.message 与异常/禁用/移除默认回退。桌面 911 passed/7 skipped、32 定向测试及 API/类型/build/arch/lint 通过；**不属于当前 fd4c5040 的根门禁**。core TaskRow/验收卡/任务页迁移正消费该 seam，待合并、重打统一 API/vendor/源码锁并复验。
- P0 剩余 terminal no-op/RPC/status 兼容与真实 MCP 探针、P5 discovery 原生入口/真实 journal 与关闭资源边界正在独立推进；未通过或未集成前不写 PASS。
- 顺序：保留本轮已验证来源 → 整合通用 UI seam 与任务 UI → 统一 API/候选包及双仓库门禁 → 同候选正式 GUI；P2/P3/P5 和 P6 真实零领域独立构建继续执行，目标保持 active。

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

2026-10-28 新记录的移出部分见[检查点日志归档](../archive/native-plugin-checkpoint-log-through-2026-10-28.md)。

只保留最近 30 条去重记录，描述各切片发生时的状态；后续替代关系以本页“当前阶段状态”为准。更早及重复原始记录见[完整历史](../archive/native-plugin-implementation-plan-through-2026-10-27.md)。

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
- 2026-10-27：知识 maintenance 真实 worker 回归补齐 canonical/mirror 标题、metadata、revision、CAS、并发编辑保留、symlink 拒绝与 Wiki proposal staging；插件 `11154ae` 的 knowledge 45 files/356 tests 通过。宿主 `ee52a9c3` 删除无插件时的 `.pi` maintenance 动态导入，create-backend 39/39、backend tsc/Biome/arch 通过。未将 fixture 当作正式 GUI。
- 2026-10-27：discovery 历史记录四类投影与 native writer 的候选 tarball 回归 2/2 通过（宿主 `86d7e972`、插件 `11154ae`）；插件 `9646a53` 修正 suite event bus fixture 后，独立 archive+clean npm ci 的完整 `npm run check` exit 0，真实 SDK 1.1.0/latest 1.4.0、clean install/smoke/pack 均通过。完整 B5d–B5f 仍未关闭。
- 2026-10-27：宿主 `c29c5037` 独立 checkout 的 npm ci、lint/typecheck/test/build/check:arch/check:plugin-api 全部通过，未设置 DRONE_PLUGINS_DIR。知识源码锁固定 `11154ae`/0.3.0/SHA-256 `fa122723…e4fd71`，默认远程 fetch 通过；backend 2091 passed/21 skipped、Desktop 910 passed/1 skipped，公开 UI 包单独干净安装 gate 通过。初次环境缺失与 GitHub TLS 失败及重跑结果均保留；该结果不覆盖在途任务/discovery/UI 整合，见[机器回执](../releases/native-plugin-clean-host-2026-10-27.json)。
- 2026-10-28：插件 `1d349f0` 保留 UI 历史与双亲，整合 typed core 与 actual discovery；后继 `b1c11f3` 含 worker 预检修复及真实生成物。完整 `npm run check` exit 0：knowledge 503、research 164、core 25、discovery 6，以及真实 SDK 1.1.0/latest 1.4.0、clean install/suite/PDF；同包源码恢复不等于完整 owner/UI/GUI 完成。
- 2026-10-28：宿主 `400744bf` 删除旧 pi-core 源码，build/smoke/compat 仅验证 vendor；milestone 规则归插件。discovery 算法/状态归插件，宿主仅注入 runner/授权/JsonStore/项目 Inquiry；候选 73 项定向回归覆盖重启、拒绝、路径、隔离和旧 journal 原字节。native/B5 GUI 与 legacy guard 仍未关闭。
- 2026-10-28：首次整合全测 8 项失败已修：合法 BUSCO 版本/counts、异步 policy/timeout、0.3 service constructor、真实 thread exit 观测；worker 严格预检失败保留 live writer，同时保留单 writer 约束。四包由 `b1c11f3` 独立 archive+clean ci 重建并锁 SHA-256；无开发源码 override，未执行 npm publish。
- 2026-10-28：冻结宿主 `6c9400c6` 的 lint/typecheck/test/build/check:arch/check:plugin-api 全过，backend 2107 passed/18 skipped、Desktop 910 passed/1 skipped、根 Node 24/24。沙箱真实拒绝/声明与 managed prompt mutation 的 SDK 回归已包含。native boundary 仍 exit 1/INCOMPLETE：runtime 1、type 6、required locks 4、packaged resources 21；详见[整合回执](../releases/native-plugin-integrated-host-2026-10-28.json)及[API 盘点](native-pi-api-compatibility-matrix.md)。
- 2026-10-28：P0 宿主诊断/通知收口：9a5471d5/2f9b6d16/5897667d/77ee4f8e 为 custom/theme 提供真实失败，持续记录 hook 错误，主/恢复/子会话通知沿通用 Event/preload/toast 传输并随生命周期撤销，不进 raw trace、不再依赖知识模块；真实 SDK 与 renderer/preload 回归通过，未关闭全部 33/41/28 API 矩阵。
- 2026-10-28：P4 安装激活修复：knowledge 只通过现有同会话 event bus 获取当前 core journal，不再隐式装 task guard；core 修正 session journal/验收 schema/回调 runtime 接线。24 项真实 SDK 任务回归通过，宿主状态机及 UI 迁移仍留在独立分支。
- 2026-10-28：P3 生产 delivery handle 实际接入摘要工具；真实 ledger/revision 与当前模型审阅后才写入/回读/commit receipt。4 隔离 specialist 与独立摘要 reviewer、malformed/unknown/source drift 拒绝、rollback/人工编辑/summary-history symlink 边界通过；不以旧手写 answerable metadata 充当成功。仍有宿主 FS writer，未关闭 P3。
- 2026-10-28：固定宿主 5e0c9aab、插件 f4a530a 的六项标准门禁全过，backend 2128/17 skipped、Desktop 912/1 skipped、根 Node 24/24；真实 packed knowledge 双进程/SDK 回执匹配 SHA60e6b071…5033，关闭清零。native boundary 仍 15/11/6/1/21/4、INCOMPLETE；P2 28819ba/3047f28 的完整审核进程候选待整合，正式新 GUI 未运行。
- 2026-10-28：P2 canonical Wiki review/history/undo 与 private signed replay 已整合，CLI/Desktop 共用算法与 scoped IO；同候选6d7033cb…63b5ab 真实进程/SDK验证授权拒绝、partial→retry Vault仅写一次、history/undo、双进程/SQLite/租约释放。完整 hooks/proof、模型审核和最终 GUI 仍未完成。
- 2026-10-28：P4 canonical owner/guard迁入插件，宿主 packages/tasks 与反向 workbench port 删除；无 core 基础工具、多会话/registry隔离、任务持久化恢复、9个生产SDK场景与core29+170通过。P0两条process标准metadata/onUpdate、并行/取消/迟到回调和加载失败后read通过；完整API与任务UI待后继。
- 2026-10-28：冻结宿主 fd4c5040、插件 dd7effc 的双仓库标准门禁与固定源码独立重建通过；backend1957/17 skipped、Desktop912/1 skipped、root25/25、knowledge528。首次复用checkout旧任务node_modules空壳失败与清理后完整重跑已保留；native boundary15/10/6/1/21/4仍INCOMPLETE，无新DMG/npm发布/main合并。
