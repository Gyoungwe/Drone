# 原生事件服务路由验收（2026-10-28）

本片实现 `provider.native`：同一已安装来源 catalog、实际 runtime owner 和同一个 live SDK entry 中已绑定的 native attachment 之间转交当前事件。它不把函数或事件身份放进 JSON，也没有新增全局账本。公开 native 类型见 `ed8758c9`，宿主生产实现 `ec877b97`，实际 SDK 验收 `8e4be5fc`；父基线为 `a3c3351c`（非 squash 合入 `bc3da053`，保留既有 actor/records 父序）。

## 合同

接收者 `createNativeSession` 返回 `nativeOperations[name] = {event,effect,inputSchema,resultSchema,execute}`，event 仅为 `message_start` 或 `tool_execution_end`。调用沿既有 manifest `drone.requires` alias 与提供者 `drone.provides` 操作清单解析，不新增第二 catalog。只有这两个实际 SDK hook 在途时能调用 `provider.native({alias,operation,input:JSON})`；宿主经私有元数据传入原始事件，并使用既有 message courier。接收者必须已绑定到完全相同的实际 entry，缺失明确 unavailable，不隐式 attach。

普通 operation、tool、command、bootstrap、projection 与普通 provider.read/write 不携带该 authority。原 hook 的实际 effect 是接收操作上限，read 不能升级 write；写接收者审批显示真实 operation/effect。每次调用复用原窗口、真实 caller、signal、同源 hash、短 lease 和循环链校验，结束 await drain/revoke。返回 JSON 不授予文件根、模型、执行批准或科学 proof。

## 实际证据

`packages/backend/test/plugin-provider-sdk.test.mjs` 每次用 npm pack 生成两个独立包，离线无脚本安装，从生产 installed package scanner 取得来源，进入生产 Bridge、受限 Node worker 与真实 Pi SDK 1.1.0 会话；模型使用本地 faux provider，没有网络或账户正文。整个文件 19/19 通过，其中原服务/records/adoption 10 项保持，新增 9 项覆盖：

- 当前实际 message_start 与 tool_execution_end 进入同会话 native 接收者；复制 event/details/nonce 的普通调用和普通 provider 链拒绝。
- 两个实际 SDK session 的接收 attachment 独立；并发调用各自首次计数为 1，作用域不串。
- read hook 调用 write 接收者拒绝且无检查点；事件类型不符拒绝；声明服务却没有接收 attachment 时不自动启动。
- write hook 经真实目标 operation/effect 审批后写入 own namespace，并从实际 SDK branch 回读。
- 目标撤销、来源文件字节改变或原事件发送者撤销期间的迟到批准不能写入检查点或产生成功结果。
- 接收处理器抛错只进入一次真实 SDK 诊断；发送者撤销后的 user/assistant 两个实际事件各失败一次（初始 system 事件在撤销前完成），不是重复处理同一次失败。

相关既有 SDK 五文件 53/53、运行时四文件 51/51 均通过。Backend/Desktop Node TypeScript、plugin-api check（包含构建）、架构检查及改动文件 Biome 均通过。命令与临时日志位置记录在[结构化回执](../releases/native-plugin-native-provider-2026-10-28.json)。

## 仍未完成

本片不是 P4 完成，也不是正式安装包 GUI 验收。TaskApplication 的 managed adapter/data service、一次任务授权、实际 host-queued auto-continuation origin、接受者领域消费、旧版本显式迁移器和旧 startup task/core 装配删除仍须完成。这里没有实现自动续作身份，不能从 JSON nonce、历史 roots/approved/proof 或服务结果恢复活权限。候选 API 尚未统一重新打包，未发布 npm、未更新发行锁、未推送。
