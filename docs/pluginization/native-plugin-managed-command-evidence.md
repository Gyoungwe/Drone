# Managed native command：真实 SDK 切片

源代码 `cce5d55f`，公共类型 `b80b5537`，基于通用身份/取消与 Node 合同 `8d766ad6`；[机器证据](../releases/native-plugin-managed-commands-2026-10-28.json)。本片仅验收通用命令机制，不关闭 P0、P2、P4 或正式安装包验收。

受限 worker 现在接受官方 `pi.registerCommand(name, { description?, handler })`。工具、命令和事件仍由同一 application owner 创建每会话 adapter；JSON 注册回执保留名称和描述，实际 SDK 注册 handler。重复名称、不可跨进程传输的 `getArgumentCompletions` 在加载时报错，不能静默丢弃。

新增可选 `PluginNativeSession.commandEffects`；没有声明的命令按 write 授权。调用 `native:command:<name>` 由当前实际 SDK Context 解析会话身份，沿用 registry 的作用域、信任、只读、代次、取消和 capability broker。声明 read 的命令仍不能调用 write 能力，renderer 或命令参数不能声称另一个会话的身份。

`sessions.command` 的真实 command signal 经 Proxy 保留 SDK 动态 getter，传入 registry 与隔离进程；pending 命令归 attachment 管理。abort、会话关闭和插件停用等待在途请求排空；迟到的 capability 请求不能重新获得权限。关掉旧 owner 后真实 SDK reload 可创建不同 PID，再读回新 owner；不是 UI toggle 状态演示。

worker 的 Context 只支持 `cwd`、`signal`、`sessionManager.getSessionId()` 与真实能力范围下的 `hasUI:false`。`isIdle`、`waitForIdle`、`newSession` 和其他未实现 Context/UI 方法明确失败；没有用快照或立即成功冒充同步跨进程 API。前台领域操作通过通用 async `session.inspect` 自行实施 idle 策略。

官方 command handler 保持 void，`sessions.command` 返回既有 `{kind:"command"}`。完整文本呈现仍需后续通用 `sendMessage` 能力与 publication 边界；本片不创造一个虚假文本回执。原生 Pi 根入口仍可使用其实际 SDK API。普通 typed `/command` 保持 SDK 原语义执行；本片的命令取消证明针对 explicit `sessions.command`，不宣称普通 prompt 路径的取消全部相同。

## 实际检查

- `native-command-protocol-sdk.test.mjs`：生产 createBackend → native bootstrap → coordinator → registry → 受限 Node worker → 实际 Pi 1.1.0 SDK，7/7。覆盖两会话同 owner、真实 session.inspect 身份、描述保留、typed 命令无模型调用、未知效果写审批、read 拒绝 write、handler 每次诊断一次、unsupported 后真正 builtin read、精确取消与关闭排空、停用/新 PID 恢复、迟到批准不写。
- 连同现有 native 工具协议、共享 owner 和明确命令回归，4 文件 20/20；registry/capability/coordinator/process 4 文件 37/37。
- backend 类型、lint、架构和完整 plugin-api 门禁通过。lint 保留历史 HTML 过大 warning；API 生命周期为本地候选 tar 的安装/升级/回滚/卸载，不代表 npm 发布。

这次新增检查均位于插件注册/JSON 协议或活跃调用授权边界；默认 write 与 unsupported 错误保留拒绝语义，没有新重试、缓存、空 catch 或兼容路径。实际领域包及正式 macOS 安装包必须消费本合同后独立验收，双仓库最终根门禁仍由主集成执行。
