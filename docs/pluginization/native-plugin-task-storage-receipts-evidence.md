# P4 真实存储回执与活授权切片

状态 **PARTIAL**。本片关闭 memory/lazy/durable 的已实现回执与恢复授权切片；实际 managed TaskApplication、data provider、opaque acceptance/consent 角色、旧 startup 删除和新正式安装包仍未完成。没有新增 flush、boundary staging ledger、宿主 TaskView 字段或专用 IPC。

宿主 `db50ef36` / `f5b71cf6` 为已有 records.read 增加 actual `mode:persistent|memory`，只读公开 SDK getSessionFile；lazy persistent 与真正 inMemory 不再混淆。状态仍独立为 durable/deferred/needs-reopen，memory 不报告 durable。

插件 `af902cf` 在真正恢复 checkpoint 时删除 executionConsent。正常同 owner/scope 的活 book 仍由原 early-return 保留一次授权；新 owner、reload 或 branch 恢复仅取得记录，不从 JSON 取得执行权。历史计划与文件观察保留，新的实际用户授权另取。

`d468846` 让 Native persist 返回真实 mode/state，TaskSession 保存 accepted live 与 last durable 两个派生投影，只有实际 append/磁盘回读成功才标 durable。真正 SDK 顺序是 input → before_agent_start/turn_start → user message_end 保存 → context；因此 context/tool 边界刷新实际 branch/文件，不在 input 中等待未来保存。persistent deferred 拒绝外部效果；memory 允许当前 owner 的明确未保存实时状态。存储失败显示 last confirmed 及 needs-reopen，authorization/writeAuthorization/readRoots 全部撤销；不会把 last durable 的旧授权继续交出。

`85285e7` 的自有 view.storage 经既有 task-view decoder 以原对象保留，随后经过 production history/transcript mapper 到插件 UI；插件用 `ui/storage.ts` 在展示边界校验，面板与消息决策区域显示双语 memory/deferred/unknown/failed 提示。Core 0.1.9 和早期 0.2.0 历史没有回执时显示 unknown，不猜 durable。相关旧保存文案按实际回执收窄，恢复记录不宣称旧授权继续有效。官方构建产物 `d614099`。

## 实际验证

候选 core 0.2.0 tarball SHA256：`40489c45c031c11113b427751c6eef5ab977c166906b3402a49c3b783d6b2fee`，未发布 npm。core package check：Node **29/29**、runtime/UI **215/215**（新增展示回执与双语两页面验收）。

实际安装该 tarball 后，production Backend/SDK 五文件 **38/38**：task-session-commit 11、task-plugin-activation 12、task-manifest-session 1、zotero-save-tool 7、plugin-session-records 7。lazy 实际文件不存在且状态 deferred，实际 SDK tool_call guard 拒绝外部写入、零模型调用；正常 user append 后无死锁进入 durable，真实 history/transcript mapper 保留插件自有 storage 扩展。真实 SessionManager.inMemory 无文件并明确 unsaved。

恢复案例的授权来自实际 AskGate，先真正批准并写出文件，再复制该真实 checkpoint 到 SDK inMemory。same-manager reload 前后，SDK branch 中仍有原 JSON executionConsent，但新的实际 owner 两次状态均不恢复该授权；persistent SDK reload 与磁盘 reopen 同样清除活授权，保留文件观察，不重放已接受写入。文件字节不变，原本正常运行的一次问题次数保持 1。

records/provider 实际 SDK **17/17**，覆盖 lazy persistent deferred 与 actual memory deferred、既有 source namespace/取消/phantom/真实 reopen。API package check、Backend/Desktop Node TSC、architecture、changed-file lint/diff 均通过。日志 `/tmp/task-storage-receipt-sdk-final.log`、`/tmp/task-storage-receipt-core-verified.log`、`/tmp/task-storage-mode-sdk-final.log`；[机器回执](../releases/native-plugin-task-storage-receipts-2026-10-28.json)。

这些是实际会话和包切片，组件测试不等于正式安装包 GUI。TaskSession 的 live 状态也不产生宿主文件/模型或科学 publication 权威；下一步需要真正 same-owner managed Adapter、受控 live-object provider 角色与真实会话授权，随后删除旧 taskHost/coreHost 装配。
