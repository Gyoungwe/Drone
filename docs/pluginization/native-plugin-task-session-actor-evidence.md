# P4 S1：canonical TaskSession / TaskApplication 切片

源码：插件结构提取 `6e30876`、结构构建 `b365dd8`；行为 `46b74fe`、正式构建 `ed660fc`。宿主实际 SDK 回归 `004c994e`；[机器回执](../releases/native-plugin-task-session-actor-2026-10-28.json)。这是 S1 切片，P4 和整个目标仍未完成。

`pi-core/src/task-runtime/task-session.mjs` 现在拥有输入、回合、工具观察、动作、只读状态与关闭六类行为。每会话 actor 串行执行事务，复用原 workbench/evidence 算法，成功等待实际持久化后才发布 revision 与状态。一次事务把工作台及证据写为 `drone-task-session-v1` 一个 SDK entry；旧记录只读迁入，没有第二个写入器。取消或失败的未提交事务撤销私有领域草稿，不修改 SDK 私有字段。

`TaskApplication` 创建真正 native session owner；官方 Pi 根入口与旧 `taskHostLoader` 委托同一模块。原生适配器经实际 SDK context 注入持久化、检查和授权，调用范围通过 AsyncLocalStorage 与保留 lazy getters 的 Proxy 隔离；审批及恢复读取消后不得提交迟到结果。知识 publication 等待真实 advanceStage/takeReport；报告消费仍只是 transient 状态，不写磁盘。task_status 不再隐式启动 reconcile。

## 真实 SDK 写入失败

Pi 1.1.0 的 appendCustomEntry 先更新 SessionManager 内存，再执行磁盘 append。测试真实把已有会话文件临时替换为目录，使实际 append 返回 EISDIR：命令拒绝，工作台 revision 和 UI 消息保持最后成功状态，SDK 分支却留下 phantom entry。TaskSession 随即 fail closed；该 TaskApplication 持有 needs-reopen 诊断，后续 mutation 拒绝。状态消息也拒绝继续写入损坏的 manager，避免以 phantom leaf 为 parent 延长磁盘分支。

长生命周期宿主 TaskApplication 在真正 SDK reload 后仍保留故障；同一 SessionManager 仍有 phantom，不能视为恢复。实际 SessionManager.open 从磁盘只读到最后 committed entry；新的 SDK application/event bus 重开后才读回正常状态。回归不重建 fixture manager、不回滚私有 arrays，也没有 process/Symbol 全局账本。

**历史 S1：独立 raw CLI reload 当时仍是 S2 缺口。** 标准 extension API 的 events.on 经 runtime.trackEventBusSubscription 包装，invalidate 会解除全部监听；纯插件 bus listener 不能跨 reload 保留 tombstone。最初“双入口 reload 应安全”的实际 SDK 回归确实失败，保留 RED 日志 `/tmp/task-session-commit-sdk-first.log`、`second.log`。当前官方入口仅证明 reload 前拒绝与真实磁盘重开恢复；没有把其 reload 后 phantom 接受标为 PASS。后继 [native storage fence](native-plugin-native-storage-evidence.md) 现已用公开 SDK branch/自身 JSONL 对此 append-phantom 实际 RED→GREEN；更完整的 managed 生命周期和 deferred actor 策略仍未完成。

## 已验证范围

- 独立 npm ci 后，显式安装本地 Plugin API 1.3 tar；pi-core 正式 check 通过：typecheck、build:check、smoke、29 项 Node（含干净 packed TypeScript consumer）及 180 项规则 + 30 项 UI。
- 实际安装的 core/knowledge tar → 生产 Backend/Pi 1.1.0 SDK → renderer contribution：4 文件 15/15。新 6 项覆盖真实存储失败、SDK phantom、磁盘重开、双会话并行动作和实际审批取消；既有命令 6、任务 progress 2、installed UI 1。
- backend 类型、定向 lint、架构通过；本切片未重跑双仓库根命令，也未新建正式 macOS 安装包。最终组合根门禁和 GUI 仍由主集成执行。

下一块 S2：共享 installed package source index、同 source/hash/epoch 的真实应用 owner 生命周期、provider/记录与问答机制，然后删除启动时 taskHost 注入；不得用 UI 停用代替 native package stop。旧四项外部验收与 B8 不变。
