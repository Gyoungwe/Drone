# 原生 SDK 重载后的真实磁盘 fence

插件源码 `876e468` / `74311fb`，官方产物 `b2fec08` / `6e6212d`；宿主实际 SDK 测试 `63e396e1`。[机器回执](../releases/native-plugin-native-storage-2026-10-28.json)。本片关闭 S1 遗留的原生 append phantom 在 SDK.reload 后被当作已保存的路径；没有移除 startup host loader，没有关闭 P4 或正式 GUI 门禁。

`pi-core/src/task-runtime/native-storage.mjs` 只用实际 readonly SessionManager 的 getBranch/getSessionFile/getSessionId 和只读 JSONL 字节核对。它不创建/打开 manager、不 flush、不改 SDK 私有数组、不使用 process/global/Symbol/event-bus keeper。原生 adapter attach 先以实际磁盘匹配的当前 branch 前缀初始化同一个 canonical TaskSession，发现未持久化记录则登记 needs-reopen；新的 raw CLI application 因此能够重建失败屏障，不能因为旧内存 manager reload 仍包含 phantom 就恢复正常状态。

append 前后核对实际磁盘；失败后不再追加状态消息或后续任务变更。fresh backend + 真正 SessionManager.open(file) 的新 entry 仅读旧 committed 记录恢复，未把同 manager 重载称作磁盘重开。header/JSONL/branch 错误使用固定码/行号，不把 JSON.parse 引用的 assistant 正文作为诊断发出。

lazy/inMemory 会话明确输出 taskStorage.state=deferred，状态文本说明“尚未保存到磁盘，不是已保存回执”；首个真实 user 消息落盘后，在实际 SDK 后继读取/操作中确认 durable。未阻断首次 input hook，也没有等待尚未发生的 user persist 形成死锁。**完整 TaskSession 在 deferred 阶段延迟 revision/broadcast 的策略仍待后继实现；本片没有把 deferred 当成 durable 完成，也未声称整个 actor 策略已关闭。**

## 真实证据

旧 `782e7ee` core（tar SHA `9baf315...`）下，新的 raw official reload 断言实际 RED：task-status 错误地 resolve 命令回执，日志 `/tmp/native-storage-raw-reload-red.log`。新源码官方 build/pack 的 core 0.2.0 tar SHA256 为 `03d2de2b1926695f785eb910e02a85b5769d86801a23481b904d9bf0881b1d27`，位于 `/tmp/drone-native-storage-core-pack/gyoungwe-pi-core-0.2.0.tgz`。将该真实 tar 安装到隔离 Backend 依赖目录后，实际 SDK **9/9** 通过：host/raw 两入口 EISDIR 的真实 memory phantom、同 manager reload 继续拒绝、真正 disk reopen 恢复；两入口迟到审批和双会话隔离；两入口 malformed JSONL 私有正文不泄露/文件不延长；真实 lazy→persisted 和真实 SessionManager.inMemory deferred 状态。

该依赖目录是已有隔离 backend 中替换的真实包，不冒充发布后全新 clean prefix。core 自身官方 check 包含真实 packed TypeScript clean consumer（明确 API 1.3 候选 tar `6a011fc8`，SHA `a83db1c...`）、Node **29/29**、runtime/UI **210/210**。连同旧 S1 迁移契约回归，宿主 4 文件 **29/29**；旧 9baf315 下独立 test-only 修复也单独 **20/20**，不依赖本片新原生代码。

首个生成产物 stale 和未设置候选 API tar 的预检查均按实际前置条件修复后重跑；没有把前置失败抹成原先 PASS。新包未发布、正式安装包 GUI 和合并后双仓库完整门禁均待主集成。下一块继续精确旧版本 checkpoint adoption、真实 canonical provider 与 managed owner cutover、deferred actor 策略和最终 startup facade 删除；旧四项与 B8 不变。
