# 原生 Pi API 兼容盘点与未关闭项

2026-10-28，状态 **INCOMPLETE**。按已安装的 `@earendil-works/pi-coding-agent@1.1.0/dist/core/extensions/types.d.ts` 逐项盘点：33 个 ExtensionAPI 成员、41 种 on 事件、18 个基础 Context 成员、28 个 UI 成员。这些数字是声明范围，不是通过数量；latest 1.4.0 的完整逐项矩阵仍未完成。

标准 Pi package 格式接入、原生 CLI 使用真实 SDK、Drone 的受限进程适配必须分开。官方格式相同不能推导运行 API 全部可用。旧内置扩展直连 SDK 的路径也不能替代第三方沙箱验收；其 Desktop UI 仍有 no-op。主计划见[执行计划](native-plugin-implementation-plan.md)。

## ExtensionAPI 完整声明表

| 成员 | managed native | 普通第三方 process sandbox |
| --- | --- | --- |
| `on` | 12 种事件；见下表 | 显式不支持 |
| `registerTool` | 标准 JSON 声明与 execute/onUpdate；不可跨进程回调明确拒绝 | 支持已验证 JSON 声明及 execute；回调限制见下文 |
| `registerCommand` | 显式不支持 | 显式不支持 |
| `registerShortcut` | 显式不支持 | 显式不支持 |
| `registerFlag` | 显式不支持 | 显式不支持 |
| `getFlag` | 显式不支持 | 显式不支持 |
| `registerMessageRenderer` | 显式不支持 | 显式不支持 |
| `registerMarkdownTransformer` | 显式不支持 | 显式不支持 |
| `registerEntryRenderer` | 显式不支持 | 显式不支持 |
| `registerToolRenderer` | 显式不支持 | 显式不支持 |
| `sendMessage` | 显式不支持 | 显式不支持 |
| `sendUserMessage` | 显式不支持 | 显式不支持 |
| `appendEntry` | 显式不支持 | 显式不支持 |
| `setSessionName` | 显式不支持 | 显式不支持 |
| `getSessionName` | 显式不支持 | 显式不支持 |
| `setLabel` | 显式不支持 | 显式不支持 |
| `exec` | 显式不支持 | 显式不支持 |
| `getActiveTools` | 显式不支持 | 显式不支持 |
| `getAllTools` | 显式不支持 | 显式不支持 |
| `getSettings` | 显式不支持 | 显式不支持 |
| `setActiveTools` | 显式不支持 | 显式不支持 |
| `getCommands` | 显式不支持 | 显式不支持 |
| `setModel` | 显式不支持 | 显式不支持 |
| `getThinkingLevel` | 显式不支持 | 显式不支持 |
| `setThinkingLevel` | 显式不支持 | 显式不支持 |
| `registerProvider` | 显式不支持 | 显式不支持 |
| `unregisterProvider` | 显式不支持 | 显式不支持 |
| `registerMcpServer` | 显式不支持 | 显式不支持 |
| `unregisterMcpServer` | 显式不支持 | 显式不支持 |
| `getMcpServers` | 显式不支持 | 显式不支持 |
| `registerVirtualModel` | 显式不支持 | 显式不支持 |
| `unregisterVirtualModel` | 显式不支持 | 显式不支持 |
| `events` | 显式不支持 | 显式不支持 |

普通沙箱六个 getter 不再返回假的空快照；不可跨 worker 的 `prepareArguments`、`prepareLoadout`、`renderCall`、`renderResult` 在注册时明确拒绝。`outputSchema`、`constrainedSampling`、`renderShell` 和对象型 `namespace` 保留。宿主 `c7310965` 的真实包→worker→SDK 会话回归证明拒绝后基础 read 仍正常。普通沙箱的 onUpdate 已通过同一调用的进度回执转发；两种沙箱的 nested executeTool 等仍未完成，不据此宣称全兼容。

managed process 工具声明现保留 outputSchema、constrainedSampling、renderShell、promptSnippet/guidelines、exposure、namespace、annotations、defaultActive 与 executionMode。prepareArguments/prepareLoadout/renderCall/renderResult 在注册时明确拒绝。进度回调绑定实际 invocation ID，只在 SDK 提供 observer 时创建；完成、取消后的回调不能进入另一个调用。`native-tool-protocol-sdk.test.mjs` 的真实受限 worker→SDK 回归覆盖并行进度、取消后另一 attachment 继续运行、迟到回调拒绝，以及四种回调导致加载错误后 builtin read 仍正常。普通第三方沙箱现也转发 onUpdate：通过网络授权后的真实 worker→SDK 并行工具事件，以及取消后同进程另一调用继续、未请求 observer 时保持 undefined 的回归通过。两条路径在子进程边界共用文本/图片进度 schema；该切片不代表支持 terminal rendering 或 nested executeTool。

## on 事件完整声明表

| 事件 | managed native | 普通第三方沙箱 |
| --- | --- | --- |
| `session_start` | 白名单（不代表全部语义已验收） | 显式拒绝 |
| `session_shutdown` | 白名单（不代表全部语义已验收） | 显式拒绝 |
| `session_tree` | 白名单（不代表全部语义已验收） | 显式拒绝 |
| `context` | 白名单（不代表全部语义已验收） | 显式拒绝 |
| `before_agent_start` | 白名单（不代表全部语义已验收） | 显式拒绝 |
| `agent_start` | 白名单（不代表全部语义已验收） | 显式拒绝 |
| `agent_end` | 白名单（不代表全部语义已验收） | 显式拒绝 |
| `message_start` | 白名单（不代表全部语义已验收） | 显式拒绝 |
| `message_end` | 白名单（不代表全部语义已验收） | 显式拒绝 |
| `tool_execution_start` | 白名单（不代表全部语义已验收） | 显式拒绝 |
| `tool_execution_end` | 白名单（不代表全部语义已验收） | 显式拒绝 |
| `tool_result` | 白名单（不代表全部语义已验收） | 显式拒绝 |
| `project_trust` | 显式拒绝 | 显式拒绝 |
| `resources_discover` | 显式拒绝 | 显式拒绝 |
| `session_info_changed` | 显式拒绝 | 显式拒绝 |
| `session_before_switch` | 显式拒绝 | 显式拒绝 |
| `session_before_fork` | 显式拒绝 | 显式拒绝 |
| `session_before_compact` | 显式拒绝 | 显式拒绝 |
| `session_compact` | 显式拒绝 | 显式拒绝 |
| `session_compact_failed` | 显式拒绝 | 显式拒绝 |
| `mcp_servers_change` | 显式拒绝 | 显式拒绝 |
| `session_before_tree` | 显式拒绝 | 显式拒绝 |
| `context_with_system` | 显式拒绝 | 显式拒绝 |
| `cache_warming_decision` | 显式拒绝 | 显式拒绝 |
| `before_provider_request` | 显式拒绝 | 显式拒绝 |
| `before_provider_headers` | 显式拒绝 | 显式拒绝 |
| `after_provider_response` | 显式拒绝 | 显式拒绝 |
| `provider_stream_event` | 显式拒绝 | 显式拒绝 |
| `agent_before_settle` | 显式拒绝 | 显式拒绝 |
| `agent_settled` | 显式拒绝 | 显式拒绝 |
| `ui_prompt_start` | 显式拒绝 | 显式拒绝 |
| `ui_prompt_end` | 显式拒绝 | 显式拒绝 |
| `turn_start` | 显式拒绝 | 显式拒绝 |
| `turn_end` | 显式拒绝 | 显式拒绝 |
| `message_update` | 显式拒绝 | 显式拒绝 |
| `tool_execution_update` | 显式拒绝 | 显式拒绝 |
| `model_select` | 显式拒绝 | 显式拒绝 |
| `thinking_level_select` | 显式拒绝 | 显式拒绝 |
| `tool_call` | 显式拒绝 | 显式拒绝 |
| `user_bash` | 显式拒绝 | 显式拒绝 |
| `input` | 显式拒绝 | 显式拒绝 |

`context`、`message_end`、`tool_result` 已有真实 SDK 链式回归。`89570262` 补齐 `before_agent_start.systemPromptOptions` 原对象修改、删除和返回值链，覆盖 SDK 对象身份、重赋值无效、模型实际提示词与 SessionManager 持久化；IPC 字段写入不触发原型 setter。同一 worker handler 内的 `event.systemPrompt` 仍是 JSON snapshot，实时 getter 未实现。

## Context 与 UI 声明范围

基础 Context 的完整成员：`ui`、`mode`、`hasUI`、`cwd`、`sessionManager`、`modelRegistry`、`model`、`scopedModels`、`thinkingLevel`、`isIdle`、`isProjectTrusted`、`signal`、`abort`、`hasPendingMessages`、`shutdown`、`getContextUsage`、`compact`、`getSystemPrompt`。managed worker 仅投影 cwd、hasUI=false、signal 和 sessionManager.getSessionId；其余 Context、ToolContext.tools/executeTool、CommandContext 与 SessionManager API 仍有拒绝或未验收项。Registry 对 in-process factory 的真实 Context 不等于进程 worker 的能力。

UI 完整成员：`select`、`confirm`、`input`、`notify`、`onTerminalInput`、`setStatus`、`setWorkingMessage`、`setWorkingVisible`、`setWorkingIndicator`、`setHiddenThinkingLabel`、`setWidget`、`setFooter`、`setHeader`、`setTitle`、`custom`、`pasteToEditor`、`setEditorText`、`getEditorText`、`editor`、`addAutocompleteProvider`、`setEditorComponent`、`getEditorComponent`、`theme`、`getAllThemes`、`getTheme`、`setTheme`、`getToolsExpanded`、`setToolsExpanded`。普通沙箱已桥接 select/confirm/input/notify；managed native 的 hasUI=false。旧直连 SDK 的 Desktop makeUiContext 仅实现基础询问/通知并提供 theme 对象，其余终端/编辑/状态方法多为 no-op。宿主 `9a5471d5` 已将 custom 改为明确拒绝、setTheme 改为 success:false；真实 SDK 的两个工具分别得到错误/失败结果，后续基础 read 正常。theme 对象存在也不等于终端渲染能出现在 Desktop。

## 必须继续处理

主/子会话的持续 onError 已由 `2f9b6d16` 接入日志与 traces；真实 SDK create/reload/restore 与子会话覆盖权限门禁开关、错误后继续 read、关闭退订。日志记录非致命 hook 异常，不把 loader.errors 为空当作 hook 成功。

1. 收口完整 native core+knowledge 组合中的 publication 事件投影：bridge 缺失时不能破坏 toolCall/usage/官方 metadata，provider 私有协议重放与公开 tool-only/最终 fail-closed 均须保留。该组合仍在隔离分支验证；既有 onError 切片不代表全部 41 种事件已验收。
2. 删除旧 Desktop UI 的静默 no-op/假成功，按支持能力返回真实结果或明确拒绝；核对 bind mode 与 hasUI。
3. managed JSON metadata 与 onUpdate 已有真实 SDK 切片；继续补 Context/getter 完整声明矩阵与 nested executeTool，不增加同步跨进程缓存来伪装支持。
4. 用完整 33/41/28 探针及 locked/latest 真 SDK 回归固定支持/拒绝清单，补格式相同但 API 不兼容包的实际安装诊断。

本页是源码审计和定向 SDK 证据，不关闭 P0/P1，也不替代最终同 tarball 正式安装包 GUI。四项外部验收及暂缓项保持原状态。
