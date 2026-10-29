# 受管原生 Pi 事件适配

2026-10-26。此片扩展 P2 所需的事件运输，不代表完整官方 ExtensionAPI 或知识 publication 迁移完成。

支持 `session_start`、`session_shutdown`、`session_tree`、`context`、`before_agent_start`、`agent_start`、`agent_end`、`message_start`、`message_end`、`tool_execution_start`、`tool_execution_end`、`tool_result` 的 JSON 事件边界。每次 `pi.on` 注册保留独立 handler 标识，宿主分别向真实 SDK 注册回调；context、工具结果和最终消息的多处理器合并由 SDK 执行，不在 worker 自行合并成最后一个返回值。原地修改 context 消息列表或最终 message 的处理器会返回其实际修改供 SDK 接续及持久化。取消注册后该处理器不再执行。

`PluginNativeSession.eventEffects` 明确声明每种事件的 read/write；既有 `session_start` 默认为 read，新增未声明事件按 write 处理。逐调用身份、scope、撤销与 capability broker 和工具/UI 相同。`session_shutdown` 仅释放会话，不签发新的能力授权；每个关闭回调结算后仍等待 attachment disposal，失败不报告成功。

真实 SDK 1.1.0 回归覆盖两个同时存活会话共用独立后台、各自 context 身份、同事件两次注册的顺序转换、取消注册、多 `tool_result` 结果串联、最终 `message_end` 转换，以及 native-first / host-first / 原批准窗口关闭后的关闭顺序。回归同时加载真正任务守卫，模型实际调用工具。相关 26 项测试通过；额外事件名仅属于所列运输支持，不把它们逐项宣称为已完成业务验收。

受管 native context 当前提供官方 `cwd`、`hasUI:false`、`signal` 与 `sessionManager.getSessionId()`。`signal` 是当前调用在子进程中的实际 AbortSignal；非 shutdown hooks 的真实 SDK run signal 贯穿 registry 与进程调用，并与会话 attachment / activation 撤销组合，不通过 JSON 伪造 signal。用户中止只影响当前会话，关闭会话会中止其等待中的 hook，迟到 capability 调用拒绝；`session_shutdown` 仍独立清理，不继承已中止 run 的 signal。新增真实 SDK 回归覆盖 context hook 等待用户中止、同 owner 第二会话仍可调用工具、关闭第一会话释放等待与迟到能力拒绝。

跨进程 live publication proof 仍明确拒绝；序列化的 JSON 不具备 WeakSet 身份。命令、通用 UI 交互、provider、自定义终端组件及完整 sessionManager 上下文仍未接通。尚未宣称 full knowledge hooks 可运行，也没有回退到宿主内直接加载该受管插件。

## 完整知识 hooks 的后续接入条件

1. **先接真实消费者所用 API。** 完整知识注册会调用 `registerCommand`、`pi.events`；恢复流程使用 `appendEntry` 和真实 `sessionManager.getBranch()`，审核使用 `ctx.ui`。这些当前明确不支持。下一片须逐个围绕实际准备、阅读、检查、恢复或审核流程接线，保留逐操作权限及 session 关闭撤销；不得整体加载后吞掉 unsupported 错误。不能复制旧 runtime 全局握手或把模型/文件权限直接交给 worker。
2. **追踪官方 SDK 消息对象与持久化顺序后，再实现 publication 协议。** 当前每个 JSON round-trip 都丢失原对象身份，包括相邻 `message_end` handler；官方 `context` 还会 structuredClone 消息。必须先用真实 SDK 跟踪最终消息、事件、live polling、历史分支和导出各入口的对象/克隆关系，确认哪里可以在持久化前完成投影。SDK 会捕获 hook 错误并继续处理原消息，不能把 hook 报错、权限拒绝或超时当成失败关闭的发布网关。
3. **身份留在原 session adapter。** `PluginNativeSession.projection` 需要绑定真实 SessionRegistry entry 与 attachment 代次，投影在创建 WeakSet proof 的子进程执行。可验证的最小方向是传输层 opaque 引用：子进程保存已投影原对象，宿主在私有对象绑定中保存引用，后续只用宿主已绑定引用恢复原对象。不得从消息 JSON 接收引用，不得按 `proof.id`、时间戳或内容 hash 重建 live proof。遇到没有可证明原对象关联的 SDK 克隆应保持未验证，而不是补造身份。该协议尚未验证，不是可直接上线的既定实现。
4. **统一所有交付入口。** 投影须覆盖显示、trace、live polling、持久化和导出；异步 IPC 要保持每会话顺序并失败关闭。`snapshot(messages,persisted)` 的 persisted 只能来自宿主实际 SDK 分支历史，不能把当前 live messages 自身当白名单。关闭会话撤销所有 live 引用；重开历史使用既有持久化恢复规则，不伪造 WeakSet 成员。
5. **用真实完整流程证明边界。** 下一协议验收必须启动实际 SDK，运行准备 → 阅读 → 检查 → 发布，并覆盖复制/篡改 proof JSON、跨会话引用、关闭后的旧引用、多个消息处理器、SDK 克隆、流式草稿、验证期间轮询、历史重载与导出。正式安装包随后重复交付路径；普通 loader、仅两只读工具或合成投影函数不能关闭这项缺口。
