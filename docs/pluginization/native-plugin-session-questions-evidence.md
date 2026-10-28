# 通用真实会话问答：实现与验收切片

父基线 `e299a5f9`；公共类型 `df1339f6`、实现 `1709ae4d`、空输入修复及受限 worker 回归 `1398c0e6`。主集成已接收源码；[机器回执](../releases/native-plugin-session-questions-2026-10-28.json)。本片没有新建正式安装包，也不关闭 P4 或整个架构目标。

`session-capabilities.ts` 独立提供 session.inspect/select/input/confirm。inspect 为 read；三个交互都是 write，仅使用当前调用的实际 registry entry、sessionIdentity、真实 SDK UI context 与有效 signal。输入只含标题、选项、placeholder 或 message，不接受会话、窗口、请求 ID。模型模块只保留 selection/generate 两项；Desktop 分别显式登记四个 session key，且只有声明 configured-services 才登记这两项模型能力。

select/input 走真实 SDK ui binding 到既有 AskGate；confirm 也走 AskGate 二选项，返回普通数据，绝不触发 PermissionGate allowRun/allowAlways。真实 entry、可信/可写状态、调用 signal 和 SDK runner 在回答后再次核对。idle SDK signal 可能 undefined，此时使用真实 caller signal；活动 SDK signal 存在时合并，取消不得继续下一动作。

窗口路由是 host-only metadata，沿现有 caller/broker 到该 entry 的 AskGate；原 pending 仅增加 ownerId，未新增请求账本。AskRespond 从真实 IPC event.sender.id 验证答复来源，renderer 没有自报身份字段。通用 AskResolved 由原 owner 移除对应 requestId/sessionId 的卡片，旧答复不能完成或清除新问题。shared IPC、preload、main、backend、renderer 已同步；其他旧非 broker 问答发送策略没有借本片扩大范围。

## 空输入的真实 SDK 语义

锁定 Pi 1.1.0 的 ExtensionInputComponent 在 Enter 时提交 input.getValue()，InteractiveMode.showExtensionInput 原样 resolve；只有取消才返回 undefined。旧 Desktop binding 的 trim() || undefined 丢掉了有效空串和空格。本片恢复原字符串、input 为允许空值的 text，AskDialog 未输入也提交明确 customText:""；结果 schema 允许空字符串，取消仍是独立 tagged result。

## 已通过的检查

- 问答实际 SDK 9 项：生产 bridge/broker → actual SDK UI/AskGate，覆盖 select/input/confirm、同实际会话两个 host window-owner lease、原 sender、单请求取消、旧答案、会话关闭、只读/信任撤销、无 session/UI、实际 SDK reload、活动 signal 和空字符串/空格。一个案例经真正受限 Node worker、IPC capability 往返，并在取消后读回确认没有晚接收记录。
- 连同 models 8、ui-context 13、AskGate 1、coordinator 4，5 文件 **35/35**。这些使用真实 SDK 会话；两个 owner lease 与 IPC sender 测试不等同于两台物理窗口的正式 Electron GUI。
- Desktop IPC/preload、资源/模型精确分流 5 文件 **31/31**；真实 AskDialog 点击空提交与空格保留 + SSR 为 **5/5**。DOM 与 Electron 边界测试各自标注范围，没有冒充正式安装包截图。
- backend 与 Desktop node/web 类型、plugin-api package check、API 生成一致性、架构与本次改动定向 lint 通过。父基线全仓 lint 的两份历史 JSON 格式错误已交主集成；本片不声称最终组合根门禁通过。

剩余：P4/knowledge 消费同一泛型 records/provider 端口、真实 managed owner 与原生 UI 映射、移除 startup task/coreHost 装配、raw CLI reload generation fence及正式安装包 GUI。worker 其他 UI/hasUI 的既有 unsupported 事实不变；没有复制 Fake SDKContext。旧四项外部验收及 B8 不变。
