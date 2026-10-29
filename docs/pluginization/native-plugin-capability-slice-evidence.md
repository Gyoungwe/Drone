# 原生插件能力发现与 clean-prefix 包验收

日期：2026-10-28。当前门禁基线：宿主 `4abdae43`、插件 `253c47e`。任务 UI/显式命令、逐调用取消与真实模型身份、Desktop RPC/状态、discovery 原生日志与容器清理已整合。插件完整检查、固定源码重建、默认远程取包与宿主独立根门禁通过；backend 1988/17 skipped、Desktop 934/1 skipped、shared347、根Node25/25。首次 channel-watch 一次性失败、20次定向通过和完整同源码重跑见[本轮回执](../releases/native-plugin-ui-model-cohort-2026-10-28.json)；未确认根因或报告修复。新私有 API SHA `03d91629…c2d185`。领域边界仍 INCOMPLETE，未执行的新正式包 GUI 不补写 PASS。旧[owner迁移回执](../releases/native-plugin-owner-migration-2026-10-28.json)及[历史归档](../archive/native-plugin-capability-slice-evidence-through-2026-10-27.md)保留原范围。

本轮 P0–P7 仍未全部完成；阶段清单以[执行计划](native-plugin-implementation-plan.md)为准。历史 PASS 继续有效，但只证明其记录的版本、数据与路径，不能外推到当前候选或整个领域。

## 当前证据覆盖

| 范围 | 已有证据 | 不能据此宣称完成 |
| --- | --- | --- |
| 能力发现与来源 | 通用 manifest/capability loader、空 managed root、安装代次内容哈希和权限撤销回归 | 全部领域迁移和最终零插件宿主 |
| 原生 Pi / 包独立性 | research-suite clean-prefix tarball：4 extensions、22 tools；锁定 1.1.0/latest 1.4.0 部分真实会话；pi-core 独立 check | 所有 API、所有候选 tarball 的最终兼容与发布后干净安装 |
| 正式包通用宿主 | 隔离 profile、空 optional UI/npm roots 的 generic session create/close；应用 owner、会话切换、停用/恢复和退出切片 | 最新领域候选包的完整 UI / Vault 写入工作流 |
| 正式包生命周期 | 临时 registry 1.0.0→1.1.0→1.0.0→remove→restore→remove；真实活跃会话 reload 与 reload-deferred；公开 pi-evidence 0.1.1 install/update/remove | 公开包跨版本回滚、销毁失败、同一候选 tarball 的完整 GUI |
| knowledge 迁移 | 安装 maintenance plan/run；当前 6266f31c…edd83 tarball/受限双进程/SDK 验证 owner、UI 读写授权；审核 apply→partial→retry→history→undo、仅写一次、进程/SQLite/租约清理通过 | 完整 hooks/publication proof、模型审核、其它 UI/IPC 与正式 GUI |
| research/tasks/discovery | 无 core 时基础读写/权限拒绝、显式加载顺序与 24 SDK 回归；生产 research review/delivery/receipt、4 specialist 与单独摘要 reviewer、拒绝/回滚；任务 canonical owner/同包 UI、显式命令与取消晚写；discovery 同包生产日志→native SDK 读回和真实 Docker 五场景清理 | 完整研究/分析 owner 与 UI；任务整个 native 包动态启停；discovery 共享 owner、执行/Inquiry、B5 GUI |
| 当前门禁 | 宿主独立根命令与 plugin-api lifecycle 全过；backend1988/17 skipped、Desktop934/1 skipped、shared347；根Node25/25；插件完整check、SDK/clean-install/suite/PDF | native boundary exit 1/INCOMPLETE；后续完整迁移与最终正式包仍未验收 |

历史 pi-knowledge 0.2.1 锁缺 exports 已修复。当前四包固定 `253c47e`，独立 archive/clean ci 可重建，宿主默认远程 fetch 校验 SHA-256。完整检查曾因 isolated npm ECONNRESET、旧 event bus fixture、生成清单格式/端口参数及旧任务/摘要 fixture 失败；真实生产缺口（提前读取不支持的 native events、未消费 delivery handle、知识依赖通知和摘要路径/提交保护）已修复，全部失败保留于回执。HTTP/1.1 保留 HTTPS/TLS 校验，未设置开发源码覆盖。不同提交的计数不合并为一次运行。

## 未关闭项

1. P2–P5 完整领域实现/UI ownership 及宿主装配删除，包含其余任务入口/引导、知识完整审核以外的剩余功能、discovery B5d–B5f 和旧知识资源生成/打包链。
2. 删除 4 个必需领域锁和旧 build/resource 闭包；当前版本/锁/标准门禁已同步，不能据此宣称零领域独立宿主。
3. 同候选 tarball 的原生真实会话和正式包领域 GUI、Vault apply/rollback、销毁失败与公开包跨版本回滚。通用零插件正式包和临时 registry 生命周期切片已取得真实证据，不在此重复列为“完全未验收”。
4. 最终领域边界扫描仍为 `INCOMPLETE`。WebDAV/inquiry 的既有归属记录不在本次文档整理中重新决策。

四项外部真实验收（Zotero 云端/身份冲突、用户认证 MCP、Protocols.io 写入、其他平台真实桌面）保持未完成，属于旧计划保留事项，**不属于本轮 P0–P7 目标**。MinerU/GROBID、B8/B8-2 保持暂缓，不新增基础代码。配置导航见[阶段状态汇总](../plan-final-status-2026-10-26.md)。

## 最近验收与迁移记录

2026-10-28 新记录的移出部分见[检查点日志归档](../archive/native-plugin-checkpoint-log-through-2026-10-28.md)。

以下为最近 30 条去重后的历史记录；内容中的“仍未提供”“仍保留”等描述属于该次提交，当前结论以上表与未关闭项为准。更早的记录、重复原文及全部证据细节见[完整历史](../archive/native-plugin-capability-slice-evidence-through-2026-10-27.md)。

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
- 2026-10-28：插件 `1d349f0` 保留 UI 历史与双亲，整合 typed core 与 actual discovery；后继 `b1c11f3` 含 worker 预检修复及真实生成物。完整 `npm run check` exit 0：knowledge 503、research 164、core 25、discovery 6，以及真实 SDK 1.1.0/latest 1.4.0、clean install/suite/PDF；同包源码恢复不等于完整 owner/UI/GUI 完成。
- 2026-10-28：宿主 `400744bf` 删除旧 pi-core 源码，build/smoke/compat 仅验证 vendor；milestone 规则归插件。discovery 算法/状态归插件，宿主仅注入 runner/授权/JsonStore/项目 Inquiry；候选 73 项定向回归覆盖重启、拒绝、路径、隔离和旧 journal 原字节。native/B5 GUI 与 legacy guard 仍未关闭。
- 2026-10-28：首次整合全测 8 项失败已修：合法 BUSCO 版本/counts、异步 policy/timeout、0.3 service constructor、真实 thread exit 观测；worker 严格预检失败保留 live writer，同时保留单 writer 约束。四包由 `b1c11f3` 独立 archive+clean ci 重建并锁 SHA-256；无开发源码 override，未执行 npm publish。
- 2026-10-28：冻结宿主 `6c9400c6` 的 lint/typecheck/test/build/check:arch/check:plugin-api 全过，backend 2107 passed/18 skipped、Desktop 910 passed/1 skipped、根 Node 24/24。沙箱真实拒绝/声明与 managed prompt mutation 的 SDK 回归已包含。native boundary 仍 exit 1/INCOMPLETE：runtime 1、type 6、required locks 4、packaged resources 21；详见[整合回执](../releases/native-plugin-integrated-host-2026-10-28.json)及[API 盘点](native-pi-api-compatibility-matrix.md)。
- 2026-10-28：P0 宿主诊断/通知收口：9a5471d5/2f9b6d16/5897667d/77ee4f8e 为 custom/theme 提供真实失败，持续记录 hook 错误，主/恢复/子会话通知沿通用 Event/preload/toast 传输并随生命周期撤销，不进 raw trace、不再依赖知识模块；真实 SDK 与 renderer/preload 回归通过，未关闭全部 33/41/28 API 矩阵。
- 2026-10-28：P4 安装激活修复：knowledge 只通过现有同会话 event bus 获取当前 core journal，不再隐式装 task guard；core 修正 session journal/验收 schema/回调 runtime 接线。24 项真实 SDK 任务回归通过，宿主状态机及 UI 迁移仍留在独立分支。
- 2026-10-28：P3 生产 delivery handle 实际接入摘要工具；真实 ledger/revision 与当前模型审阅后才写入/回读/commit receipt。4 隔离 specialist 与独立摘要 reviewer、malformed/unknown/source drift 拒绝、rollback/人工编辑/summary-history symlink 边界通过；不以旧手写 answerable metadata 充当成功。仍有宿主 FS writer，未关闭 P3。
- 2026-10-28：固定宿主 5e0c9aab、插件 f4a530a 的六项标准门禁全过，backend 1957/17 skipped、Desktop 912/1 skipped；根 Node 25/25、根 Node 24/24；真实 packed knowledge 双进程/SDK 回执匹配 SHA60e6b071…5033，关闭清零。native boundary 仍 15/11/6/1/21/4、INCOMPLETE；P2 28819ba/3047f28 的完整审核进程候选待整合，正式新 GUI 未运行。
- 2026-10-28：P2 canonical Wiki review/history/undo 与 private signed replay 已整合，CLI/Desktop 共用算法与 scoped IO；同候选6d7033cb…63b5ab 真实进程/SDK验证授权拒绝、partial→retry Vault仅写一次、history/undo、双进程/SQLite/租约释放。完整 hooks/proof、模型审核和最终 GUI 仍未完成。
- 2026-10-28：P4 canonical owner/guard迁入插件，宿主 packages/tasks 与反向 workbench port 删除；无 core 基础工具、多会话/registry隔离、任务持久化恢复、9个生产SDK场景与core29+170通过。P0两条process标准metadata/onUpdate、并行/取消/迟到回调和加载失败后read通过；完整API与任务UI待后继。
- 2026-10-28：冻结宿主 fd4c5040、插件 dd7effc 的双仓库标准门禁与固定源码独立重建通过；backend1957/17 skipped、Desktop912/1 skipped、root25/25、knowledge528。首次复用checkout旧任务node_modules空壳失败与清理后完整重跑已保留；native boundary15/10/6/1/21/4仍INCOMPLETE，无新DMG/npm发布/main合并。
