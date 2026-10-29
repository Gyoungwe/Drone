# P4 TaskController 结构提取切片

状态：结构提取 PASS；完整 managed owner cutover 仍未完成。此切片不增加宿主任务算法，不修改权限和事件语义，不声称正式安装包 GUI 通过。

`pi-core/src/task-runtime/task-controller.mjs` 提供现有 journal/evidence 转发，所有状态仍由唯一 `TaskSession` actor 管理。实际 Native Adapter 在每次调用读取自己的 invocation signal，deferred 显示仍留在 Native Adapter。没有模拟 Pi API/SDK Context，没有第二份状态机，也没有将 JSON 状态升级为权限。

插件源码 `2f3f217`；官方构建产物 `ed0f6f5`。构建后 `npm pack` 的 core 0.2.0 候选 SHA256 为 `ae8734afecb66a577be29e0e514d9d54b4cc976e7f5e9a080675c5bd0779fb4d`，仅供本轮验证，未发布 npm。

| 验证 | 结果 |
| --- | --- |
| core typecheck / build:check / smoke / 完整 package check | PASS |
| Node tests（包含 clean packed types consumer） | 29/29 |
| runtime/UI Vitest | 210/210 |
| 实际安装上述 tarball 后 production Backend + SDK | 4 文件，29/29 |

SDK cohort 为 `task-session-commit-sdk`、`task-plugin-activation-sdk`、`task-manifest-session`、`zotero-save-tool`。覆盖真实 append 失败及 phantom/reload/fresh disk reopen、lazy/inMemory deferred、两个真实会话/loader 隔离、取消晚批准、一次任务授权、文件回读、旧任务恢复及当前 source 工具只读声明。未用 loader 单独加载冒充最终安装包。

本地完整日志：`/tmp/task-controller-core-check.log`、`/tmp/task-controller-sdk-cohort.log`。首次误用 Node runner 执行 Vitest 测试没有进入测试行为；随后使用各仓库实际 Vitest 配置完成上述通过结果。机器回执见[JSON](../releases/native-plugin-task-controller-2026-10-28.json)。

下一执行块是同一 TaskApplication 的 managed Adapter 和数据 provider；缺失的链式 input/tool_call/turn 事件、实际工具事实、自动续作与特权 owner courier 必须逐项以实际 SDK 定义。旧 startup taskHost/coreHost、旧记录领域迁移器和完整 deferred 提交策略仍保留未完成，不能把此结构提取作为 P4 完成。具体端口及最终删除清单见[设计](../superpowers/specs/2026-10-28-task-managed-owner-cutover-design.md)。
