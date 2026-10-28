# 当前来源的真实会话记录端口

父基线 `788e02f6`（含 root `8f15fe6a`），公共纯 JSON 合同 `1d057120`；[机器回执](../releases/native-plugin-session-records-2026-10-28.json)。本片是 P4/P2 共用端口，尚未切换完整任务 owner，没有新正式安装包或 npm 发布。

`session.records.read(null)` 只读实际 live SDK branch 中当前 verified pluginId namespace 的每 type 最后一个 checkpoint。`append({type,data})` 每次走现有 write broker 授权，宿主派生 `plugin-record:<encoded pluginId>:<logicalType>`，不能冒充别包或旧全局 tag。无任意 sessionId、路径、legacyTypes 或消息读取，普通 assistant 正文不会通过该端口旁路 publication。

`session.notify({content})` 是普通 write 文本通知，来源类型由宿主派生，无 details/状态/授权字段，固定 display:true、triggerTurn:false。实际 SDK active 时拒绝，不 waitForIdle 或声称 queued 已显示，不新增模型调用。所有写入前后复核同实际 caller、signal、可信/可写状态；同一 backend 的 SessionServiceApi 持有一个 store，重复构造 handlers 不丢失故障状态。

Pi 1.1.0 的 public appendCustomEntry 先改内存后写 JSONL，lazy/inMemory 则可以完全未 flush。driver 仅读 SDK getSessionFile 指向的自身 JSONL 并校验实际 branch identity/content，不用会创建文件的 SessionManager.open 做读取校验。正常回执区分 durable/deferred；deferred 不代表已保存，领域审批/UI 不得据此确认 durable。实际失败后 per-entry WeakMap 保留 needs-reopen 与最后 durable custom entries，所有来源的后续 append/notify 拒绝；SDK.reload、UI 重激活和重复 getPluginSessionCapabilities 不能延长 phantom chain。

## 真实回归

`plugin-session-records-sdk.test.mjs` **6/6**：两个实际 source namespace、同 branch 每 type latest、实际 branch 切换、旧全局 task tag 冒充无效、无聊天正文；lazy 不创建文件、真实 createAgentSession+SessionManager.inMemory 明示 deferred；SDK 内真实 EISDIR（在 public append 调用内替换真实文件为目录）产生 phantom，恢复文件后同 entry/reload 继续拒绝、read 返回 last committed，fresh backend+实际 SessionManager.open 仅见旧 committed；原 coordinator 单请求取消/晚批准、只读/信任撤销、无会话拒绝；实际被持有的模型 turn 中通知拒绝且不会污染健康 entry。一个案例通过生产受限 Node worker 往返实际 SDK checkpoint/通知，验证无额外模型调用。

连同问答 9、模型 8，3 文件 **23/23**；backend/Desktop node TSC、public API check、架构门禁及本片定向 lint 通过。机器回执保留实际命令与日志。受限 worker fixture 不是正式第三方包/新安装包 GUI，本片不借此标记整体 P4 PASS。

新增校验仅发生在 capability JSON 与 SDK-owned JSONL 边界；两个 driver catch 分别明确返回 needs-reopen 或向调用方抛出失败，文件 ENOENT 只在无 conversation 的 SDK lazy 语义下返回 deferred；队列 tail 的 rejection handler 仅排空调度，原结果仍 reject。没有空 catch、重试、SDK 私有数组修改或 process 全局状态。

下一块：同一 actual installed source catalog 的 service-only provider；经真实授权的一次性旧版本 checkpoint adoption；原生 adapter 的磁盘 generation fence；迁入受限同包 owner 后删除 startup task/coreHost 装配。旧四项外部验收和 B8 保留原状态。
