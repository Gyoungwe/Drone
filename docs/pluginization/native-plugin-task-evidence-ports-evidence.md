# P4 TaskSession Evidence 文件端口切片

状态 **PARTIAL**。结构提取完成；managed TaskApplication、当前权限/opaque proof、完整 deferred 策略和正式安装包验收仍未完成。

插件 `26b766e` 将 `EvidenceRecovery` 的真实文件检查与文本读取变为必需的 `files.inspect/readText`，由同一 TaskSession 的 `evidenceFiles` 传入；Native Adapter 使用原有 `inspectTaskFile` 与真实 readFile。没有默认 fake 文件数据，没有复制状态机。恢复仍先检查当前授权，再检查真实 hash，读取指定窗口，最后重新检查 hash。托管 Adapter 必须以实际来源批准的根和 broker 实现这些端口，历史路径和 hash 不产生读取权限。

`f253bd3` 单独收窄原有空 capture catch：仅可选的稳定文件观察失败时记录固定错误码并保留原成功工具结果；记录和保存错误继续往上传，不能吞掉后报告成功。官方构建产物为 `7f1674e`。

core 0.2.0 验证 tarball SHA256 为 `61c8b93b988b84c76a1cd3aa131e11dc030f9df3f679c55d6ba061d7476598f6`，未发布 npm。完整 core check：Node **29/29**、runtime/UI **210/210**。两项既有真实文件恢复测试覆盖两次窗口限制、当前授权拒绝和文件变更后拒绝。

实际安装该 tarball 后，production Backend + SDK 四文件 **31/31**。新增两个实际 Native 入口（host loader、official root）案例读取真实文件第二行，随后用真实 `SessionManager.open` 从磁盘验证 checkpoint 的 evidence receipt id/path/hash/offset/limit；源文件字节不变。它们不靠 loader-only、假 SDK context 或手造许可。既有两会话、一次授权、真实 append 失败/phantom/raw reload/fresh disk 恢复、取消与文件验收回归均保持。

日志：`/tmp/task-evidence-port-core-check.log`、`/tmp/task-evidence-port-sdk-final.log`。下一步为实际存储 mode/state、live-only unsaved 与 persistent durable 前置条件，以及 TaskApplication managed owner；不把本片作为 P4 完成。
