# Desktop 官方扩展 UI 能力切片（2026-10-28）

范围：在 `fd4c5040` 上清理旧 terminal no-op；这是实际 SDK 自动化证据，不是正式安装包 GUI 终验，也不代表 P0 全部运行 API 已完成。

## 锁定合同与实际行为

- Pi SDK `@earendil-works/pi-coding-agent@1.1.0` 的 `ExtensionUIContext` 有 28 个不同成员（`setWidget` 两个重载计一个）。主会话、恢复会话、子会话均绑定 `mode: "rpc"`；SDK 的 `hasUI` 仍为 true，扩展可据 mode 避免终端组件。
- 8 个实际支持成员：`select`、`confirm`、`input`、`notify`、`setStatus`、`theme`、`getAllThemes`、`getTheme`。Theme 是真实中性色 `Theme` 实例，仅声明实际存在的 `drone-desktop`；未知名称查询返回 SDK 合法的 undefined。
- 19 个终端专属成员明确抛错：`onTerminalInput`、`setWorkingMessage`、`setWorkingVisible`、`setWorkingIndicator`、`setHiddenThinkingLabel`、`setWidget`、`setFooter`、`setHeader`、`setTitle`、`custom`、`pasteToEditor`、`setEditorText`、`getEditorText`、`editor`、`addAutocompleteProvider`、`setEditorComponent`、`getEditorComponent`、`getToolsExpanded`、`setToolsExpanded`。
- `setTheme` 按官方结果合同返回 `{ success: false, error }`；不声称切换了桌面或终端主题。
- 三种对话的 `timeout` 倒计时尚无桌面实现，明确拒绝。`select/input` 的 signal 经 AskGate 取消；子会话没有 AskGate 时明确拒绝这两个成员。`confirm.signal` 经 PermissionGate 单请求取消，不影响同 gate 的其他请求；取消通过既有 PermissionResolved(`answered:false`) 撤掉审批卡片，迟到的 allowAlways 不持久化授权。
- 通用 `extension_status` 事件沿既有 SessionEvent→main→preload→renderer 运输，复用 transcript 瞬时状态和 ComposerStatusBar。文本用 Node `stripVTControlCharacters` 清除 ANSI；undefined 删除对应 key；撤销/关闭清除会话状态。事件不进入 trace 或会话 JSONL。无通知/状态运输时明确拒绝对应输出。

## 真实回归

- `terminal-ui-capabilities-sdk.test.mjs` 使用真实 SDK、离线 faux provider、真实 PermissionGate/AskGate，逐项执行 28 成员；19 个 terminal tool 失败及 event hook 抛错后，普通 read 仍成功，onError 收到真实回执。
- `extension-notifications-sdk.test.mjs` 验证主/恢复/子会话身份、状态清除、关闭后旧 context 无输出，以及 trace/JSONL 不记录 UI 输出；renderer 的 `ComposerStatusBar.test.tsx` 经真实 event bridge 验证状态替换、会话切换、clear、历史消息重载保留活跃状态及取消监听。
- 实际安装的 `pi-mcp-adapter@5.1.0` 在 `mcp-enabled-adapter-sdk.test.ts` 中以 RPC UI 连接独立 stdio echo：工具调用成功，停用服务器不启动，MCP 状态被真实消费且无 ANSI。未读取用户账户配置或连接真实账户服务。
- `plugin-sandbox-ui-sdk.test.mjs` 使用实际 makeUiContext/ApprovalService/PermissionGate，经生产 sandboxExtensionFactory 授权后启动真实 worker，确认两次真实审批、独立本地 HTTP fetch、普通 SDK read 与 worker 关闭；拒绝 confirm.signal 的错误实现先真实 RED，再由单请求取消修复为 GREEN。
- 本片没有新增 MCP 专用兼容分支。真实 Theme 和通用状态运输依据 SDK 1.1.0 合同保留；只有正式 SDK 改变该合同或桌面提供真实终端能力时，才可调整对应支持边界，不能因移除旧 MCP 问题说明而恢复 no-op。

完整官方 ExtensionAPI、ExtensionContext 和全部事件的运行语义矩阵、领域迁移及正式安装包 GUI 验收仍按主计划保留未完成状态；本证据不把方法存在或 loader.errors 为空当作成功。
