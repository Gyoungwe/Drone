# P2 显式状态 JSON 能力

这是一段可由知识设置页消费的通用能力，不代表完整知识 owner、模型写流程或 56 个旧宿主 API 已迁移。正式安装包 GUI 状态与完整门禁由主验收单独记录。

## 合同与权限

`state.readJson({root,path})` 返回 `{kind:"missing",version:null}`，或 `{kind:"value",value,version}`。`version` 是原始文件字节的 SHA256；它与领域文档内部的 `version:1` 不同。损坏 JSON 抛带 `ESTATECORRUPTED` 的错误，不伪装成缺失配置。调用插件可以将损坏展示为严格模式及诊断，但不得捕获授权错误并当成默认配置。

`state.list({root,path})` 返回当前目录的 `{name,kind}` 列表，不递归或跟随符号链接；读取和列目录可在已批准 state 根的 bootstrap 运行。

`state.writeJson({root,path,value,expectedVersion})` 只接受 JSON 值、`.json` 文件、已有父目录与最多 1 MiB 的序列化数据。`expectedVersion:null` 只创建缺失文件；其他值必须匹配当前字节 SHA256。冲突抛 `ESTATECONFLICT`，损坏文件拒绝覆盖。成功返回写后重新读取的 value/version，失败不得报告成功。

插件须在 `permissions.filesystem` 声明 `application-state-write`，宿主才能显示明确的 JSON 读写目录选择。旧 `application-state` 仍只读。取消选择终止本次激活。每次激活生成独立 handle，state 根登记到实际 Backend StorageRegistry；数据根仍只读，factory 的 `resource.access` 只是 UI 可用性提示。真实能力以宿主 grant 为准；bootstrap 写入、read operation 调用写能力、只读会话写入以及撤销后的调用均拒绝。每个写操作仍经过 coordinator/broker 的逐调用审批。清单权限变化会使原 source/binding 失效，需要重新激活授权。

## 原子性与边界

能力通过 `JsonStore.writeChecked` 使用现有同路径异步队列，包括既有普通 write/update；版本检查、同目录临时文件、rename 和稳定写后回读都在这个队列内。两个实例使用同一版本并发写入时只有一个成功，另一个冲突。rename 失败保留旧文件并清理临时文件；清理本身失败会与原错误共同返回。

路径必须留在批准根内；拒绝绝对路径、穿越、符号链接目标/父目录及非现有目录，授权根或父目录替换会拒绝。队列等待与提交前会重新检查 signal、根身份、父目录身份和预期版本。

这是**同宿主、同规范路径异步 JsonStore 队列**的 CAS；没有声称对任意不合作外部进程、同步 writeSync 或跨进程写入实现操作系统级 CAS。Node 没有这里可直接使用的目录 fd 相对原子 rename；同用户外部进程若可任意修改授权目录，仍存在检查与系统调用之间的竞态边界。隔离插件不拥有直接修改此 state 根或其父目录的文件系统权限，所有正常插件写入经该 broker；现有领域 owner writer lease 的生命周期边界保持原样。

## 聚焦验证

宿主真实文件系统回归涵盖创建/原字节版本/0600权限、目录列表、两个 capability 实例并发 CAS、既有普通 JsonStore 队列冲突、rename 失败保留、损坏拒绝、路径越界/符号链接/未登记根、取消与 workspace 隔离，以及真实 broker schema/read-write/审批。production manager/picker/source tests 验证新 token、独立读写选择、取消、旧只读 grant 不升级与清单变更撤销；既有 JsonStore 测试同步运行。103 项相关测试通过，backend 与 desktop node TypeScript 通过。

真实候选 tarball 的 preferences 写后回读、旧版本冲突、损坏严格诊断、撤销及重载回执由 [packed knowledge acceptance](packed-knowledge-runtime-acceptance.md) 登记。它与上述单元回归区分，不把模拟 picker 当成正式 GUI 认证。

## Explicit directory initialization

`state.ensureDirectory({ root, path })` creates one directory directly under an existing approved state parent, then checks the confined directory and returns `{ created: boolean }`. It uses the separately granted `application-state-write` root and a write-effect operation, with fresh capability approval. It is unavailable during bootstrap, to read-only calls, or without a state write grant. JSON reads never create directories; `state.writeJson` still requires its parent to exist.

The directory selector now explicitly describes JSON changes and state subdirectory creation in both languages. Traversal, symlink targets/parents, file collisions and missing ancestors fail. Creation uses mode 0700, verifies the parent identity and reads the resulting directory back. Cancellation during authorization prevents creation. As with existing state JSON operations, this is not a claim of race-free protection against an external process that shares the OS user and swaps parents between filesystem syscalls. Tests use actual temporary directories plus the real capability broker; this new operation was added after the `ad3cd189` GUI artifact and has not yet been accepted in a new installed app.

## Checked state removal

`state.removeJson({ root, path, expectedVersion })` removes an existing JSON document only when its raw-byte SHA-256 matches the prior read. The caller must hold an explicit state write grant, use a write-effect operation and pass fresh approval. Missing files, stale versions, corrupt JSON and symlink targets fail; repeat removal does not report success. `JsonStore.removeChecked` shares the same per-path async queue as ordinary JSON writers, and the operation reads absence back before resolving. This supports moving an accepted/rejected proposal from pending state into reviewed state; the plugin must write and read back the reviewed record first, then remove the exact pending version. It is not a cross-file transaction and the plugin must retain partial-operation receipts. The same external-process race limitations as state writes apply.
