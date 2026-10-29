# 会话关闭：真实 SDK 与正式安装包证据

2026-10-26，宿主源码 `0f1740d7934465115e5e4eaa49a42038b9e04b07`。关闭时并行发出官方 `session_shutdown` 与取消信号，等待两者结束后才 dispose；重复关闭复用同一 promise。Pi 1.1.0 会吞掉扩展关闭 hook 的异常，因此宿主在该阶段订阅官方错误通道，完成清理后返回聚合错误，避免把失败记成成功。

## 验证

真实 Pi SDK 会话回归通过三种行为：关闭 hook 等工具收到取消；工具等关闭 hook 释放资源；关闭 hook 抛错时仍清理会话，并报告失败。另有重复关闭及清理顺序回归。

宿主 `lint`、`typecheck`、`test`、`build`、`check:arch` 全部退出 0。backend 1952 测试通过、17 既有跳过；desktop 849 测试通过。首次门禁在拉取固定插件提交时遇到 GitHub TLS 连接错误；保留失败日志，重跑同一门禁通过，没有跳过该步骤。

正式 DMG 通过 electron-builder 构建，macOS arm64 / Drone 0.33.4，`CSC_IDENTITY_AUTO_DISCOVERY=false`、`--publish never`。只读挂载后用 ditto 复制应用、卸载挂载点，再启动复制出的二进制。未签名、公证或发布。

| 产物 | SHA-256 |
| --- | --- |
| `dist/native-plugin-shutdown/drone-mac-arm64.dmg` | `20f3edb4a2311ec6c28a2d3c98b09abbd82c41669e0504e178357d9a67c1b019` |
| 安装后的 `app.asar` | `3a25b74d3030b9f828586de722814ac540014a86295c3ff2b92a447bd333195e` |
| `example-drone-runtime-receipt-0.0.0-acceptance.2.tgz` | `556b1e1c932b52fa9c48558a4630d6fad39412d1f78e2e2d8ead9c80f2b58adb` |

GUI 使用独立 profile/agent/知识目录和空测试项目；只配置 loopback 模型及假测试 key，没有复制用户凭据或绑定正式 Vault。启动真实 Pi 会话 `01a1773e-983d-7772-9023-cbeb3085e651`，本地服务发出 SSE 首块并持续发送心跳，不结束响应。GUI 实际显示“运行中”和停止按钮，**未显示部分回复**，所以本证据不声称已验证部分文本渲染。

模型连接仍打开时，通过实际应用窗口执行正常退出快捷键。2026-10-26T08:07:47Z 系统回读确认应用 PID `88800` 和插件后台 PID `88995` 均不存在；本地模型记录客户端断开。后台先前由公开 UI 调用返回 applicationId `aa589b3c-965c-4cea-9c8a-58600423941d`、generation `d267bf71-1ca5-4f31-9615-2d47f884b303`。结束后本地模型 PID `87695` 也已停止并回读不存在。

本轮 GUI 证明实际安装包在活跃模型请求期间能够退出、结束后台并断开模型连接。两种互等 hook 及异常传播的精确行为来自真实 SDK 回归，未把测试 hook 冒充为 GUI 操作。

## 证据与范围

私有 `.local/acceptance/native-plugin-shutdown-gui-2026-10-26/` 保存安装指纹、AX、截图、进程检查及仅含请求元数据的模型日志，不提交。证据清单 SHA-256：`ec0cb974ed90efa98275e87837a2ce94f3a3f772d648802a8b49cdd1af7bd11c`。完整门禁日志 `.local/acceptance/native-plugin-shutdown-2026-10-26/full-gate.log` SHA-256：`cd9b80bbe99b8fa14abef47a3fc39d9526ab8f6ec7a19d0604bf860611e88b19`；打包日志 `/tmp/drone-shutdown-package.log` SHA-256：`82546eb791d4631df7e0ace4a0240a1ad60e3a2cc1a41d6a5edd90356822938e`。

这是关闭流程切片，不代表 P2 或 P7 完成。旧 `drone:runtime/v1` 监听警告仍存在；领域迁移、同 owner 的 native/UI、能力 broker、零领域宿主与完整回滚仍继续实施。旧四项外部验收及明确暂缓事项保持原状态。
