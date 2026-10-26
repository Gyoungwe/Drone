# 受管原生 Pi 事件适配

2026-10-26。此片扩展 P2 所需的事件运输，不代表完整官方 ExtensionAPI 或知识 publication 迁移完成。

支持 `session_start`、`session_shutdown`、`session_tree`、`context`、`before_agent_start`、`agent_start`、`agent_end`、`message_start`、`message_end`、`tool_execution_start`、`tool_execution_end`、`tool_result` 的 JSON 事件边界。每次 `pi.on` 注册保留独立 handler 标识，宿主分别向真实 SDK 注册回调；context、工具结果和最终消息的多处理器合并由 SDK 执行，不在 worker 自行合并成最后一个返回值。原地修改 context 消息列表或最终 message 的处理器会返回其实际修改供 SDK 接续及持久化。取消注册后该处理器不再执行。

`PluginNativeSession.eventEffects` 明确声明每种事件的 read/write；既有 `session_start` 默认为 read，新增未声明事件按 write 处理。逐调用身份、scope、撤销与 capability broker 和工具/UI 相同。`session_shutdown` 仅释放会话，不签发新的能力授权；每个关闭回调结算后仍等待 attachment disposal，失败不报告成功。

真实 SDK 1.1.0 回归覆盖两个同时存活会话共用独立后台、各自 context 身份、同事件两次注册的顺序转换、取消注册、多 `tool_result` 结果串联、最终 `message_end` 转换，以及 native-first / host-first / 原批准窗口关闭后的关闭顺序。回归同时加载真正任务守卫，模型实际调用工具。相关 26 项测试通过；额外事件名仅属于所列运输支持，不把它们逐项宣称为已完成业务验收。

受管 native context 当前提供官方 `cwd`、`hasUI:false`、`signal` 与 `sessionManager.getSessionId()`。`signal` 是当前调用在子进程中的实际 AbortSignal；非 shutdown hooks 的真实 SDK run signal 贯穿 registry 与进程调用，并与会话 attachment / activation 撤销组合，不通过 JSON 伪造 signal。用户中止只影响当前会话，关闭会话会中止其等待中的 hook，迟到 capability 调用拒绝；`session_shutdown` 仍独立清理，不继承已中止 run 的 signal。新增真实 SDK 回归覆盖 context hook 等待用户中止、同 owner 第二会话仍可调用工具、关闭第一会话释放等待与迟到能力拒绝。

跨进程 live publication proof 仍明确拒绝；序列化的 JSON 不具备 WeakSet 身份。命令、通用 UI 交互、provider、自定义终端组件及完整 sessionManager 上下文仍未接通。尚未宣称 full knowledge hooks 可运行，也没有回退到宿主内直接加载该受管插件。
