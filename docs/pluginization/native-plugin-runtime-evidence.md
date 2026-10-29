# 原生插件运行时证据

日期：2026-10-26。本文为 P1 的 **latest 独立 SDK 对照附录**；正式 DMG 的通用后台/UI 生命周期切片见[安装包证据](native-plugin-p1-packaged-evidence.md)。完整领域迁移仍未完成，不得将 P0–P7 总计划标为完成。

## latest 独立 SDK 对照

2026-10-26 从公开 npm registry 查询得到 `@earendil-works/pi-coding-agent`、`@earendil-works/pi-ai` 的 `latest` 均为 **1.4.0**。随后在独立 npm prefix 中按精确版本干净安装；未升级宿主锁定的 1.1.0，未修改 latest SDK，安装时使用 `--ignore-scripts --no-audit --no-fund`。运行进程使用隔离的 agent/auth/model 路径及环境变量，不继承宿主模型凭据；模型由官方 `fauxProvider` 离线产生真实工具调用。

公开版本来源：[Pi coding agent 1.4.0 registry metadata](https://registry.npmjs.org/@earendil-works%2fpi-coding-agent/1.4.0)、[Pi AI 1.4.0 registry metadata](https://registry.npmjs.org/@earendil-works%2fpi-ai/1.4.0)。检查时间和返回原文保存在下述 `registry.json`。

| 对照项 | 结果 | 实际证明范围 |
| --- | --- | --- |
| 原生 Pi 1.4.0 | **PASS** | 未修改的官方 `DefaultResourceLoader` 通过 `additionalExtensionPaths` 加载扩展；真实 `AgentSession.prompt()` 运行工具、完成基础 UI 交互、记录工具结果，再收到模型最终答复 |
| Drone 沙箱执行适配 + Pi 1.4.0 | **PASS** | 使用官方 `extensionFactories` 加载宿主 `sandboxExtensionFactory(...)` 返回的工厂，工具在打包 Node 受限子进程执行；基础 UI 请求由真实调用上下文处理 |
| 两路径扩展一致性 | **PASS** | 从锁定版本测试中的源码常量提取同一字节内容；原生路径与沙箱路径未分别改写扩展 |
| 停用清理 | **PASS** | 通过官方 `session_shutdown(reason: quit) → abort → dispose` 顺序清理；沙箱 worker PID 已不存在 |
| latest 自动发现时的导入前隔离拦截 | **未实现 / 未验收** | 官方 1.4.0 的 `DefaultResourceLoaderOptions` 无 `extensionFactoryForPath`；本次没有 patch latest，也没有用执行适配测试冒充自动发现兼容 |
| 正式安装包交互式 GUI | **未在本次运行** | UI 回答是本地验收回调；不能据此宣称 macOS 安装包人工交互完成 |

扩展通过的具体调用序列为：`ctx.hasUI` 检查 → `ctx.ui.confirm` → `ctx.ui.select` → `ctx.ui.input` → `ctx.ui.notify` → `toolResult` → assistant 最终答复。沙箱路径额外执行既有网络权限确认；原有权限检查没有绕过。探针本身不调用网络，不读取用户文献，不产生外部写入。

两路径均回读到选择值 `synthetic-b`、输入值 `test-label`；原生结果 PID 等于测试进程，沙箱结果 PID 与测试进程不同，关闭后沙箱 PID 消失。扩展源码为普通 Pi `registerTool` 入口；没有依赖 Drone 增强清单、renderer API 或私有领域服务。本次验证的是真实 SDK 会话执行，不是仅 loader 注册，也不是 npm 插件 tarball 安装验收。

## 版本与完整性

| 项目 | 值 |
| --- | --- |
| 测试平台 | macOS / darwin arm64 |
| SDK 运行 Node | v22.23.0 |
| 沙箱运行 Node | 已打包并由既有 `runtime.json` 校验的 runtime；本机版本 26.12.1 |
| latest SDK / AI | 1.4.0 / 1.4.0 |
| 完成时间 | 2026-10-26T06:04:10.167Z |
| 宿主执行适配器 bundle SHA-256 | `42d4f20250c94949316dad977f1cda278257b251cc72401f8732ef09b4db2edd` |
| 扩展 SHA-256 | `7964a611d446fff16f8c55f730fc5cfa1e676dabb515ec0d1d99b8f2d3eb960a` |
| latest `resource-loader.d.ts` SHA-256 | `948ac95e0eb67f29f78046404afdc94f4a12ade38a3a2f838a2628069bf70a8a` |
| 执行期间未变化的宿主 `package-lock.json` SHA-256 | `266f4c57ea076e270fa56efc549b72ce1ef68c48a73a6587d7af90ce88d81d61` |
| Pi SDK npm integrity | `sha512-Z41LpZ3yYHSC/UUps6Mr39UMFPwH8elhJBG9DY1P7kuzsE5qSK/6eMj2EHzO5evJRQWLbKSqUMw+4nCNtIyiQg==` |
| Pi AI npm integrity | `sha512-hQM/C4+1w8rHYACzDDf+0vQMnEnpzIop1tptIERVgR3ZeT/hHSzBNG8PaWPgxWQjqSeKCyBZSyp8uTT6eKK1pQ==` |

宿主执行适配器由当前 `packages/backend/src/session-engine/sandbox-loader.ts` 构建为独立测试模块。构建输入已检查不包含任何 `@earendil-works` 运行时，所以此路径没有偷偷复用宿主 node_modules 中的锁定 SDK。

## 本机原始产物与复验

原始目录为 `.local/acceptance/native-plugin-latest-2026-10-26/`，受 Git ignore 保护；其中只包含本次独立安装和合成验收数据。

| 文件 | 内容 |
| --- | --- |
| `registry.json` | npm latest 查询时间、精确版本和 integrity |
| `install.log`、`npm-cache/_logs/` | 干净安装输出和 npm 诊断 |
| `clean-sdk/package.json`、`clean-sdk/package-lock.json` | 独立 SDK 依赖与完整安装解析结果 |
| `fixture/package.json`、`fixture/extension.mjs` | 普通 Pi 探针包和同字节扩展 |
| `adapter-build.json`、`sandbox-adapter.mjs` | 当前宿主执行适配器构建及输入清单 |
| `clean-sdk/probe.mjs`、`run.mjs` | 真实 AgentSession 对照脚本与隔离运行入口 |
| `execution.log`、`receipt.json` | 最终执行输出与结构化回执；未包含凭据或用户会话正文 |
| `before.json` | 开始时宿主锁文件与探针哈希 |

保留目录存在时，在 Drone 仓库根执行：

```sh
node .local/acceptance/native-plugin-latest-2026-10-26/run.mjs
```

`prepare.mjs` 只用于最初建立空 prefix，不覆盖已有安装；需要重新证明干净安装时，应使用新的空目录并重新查询 npm tag，保留每轮独立回执。宿主当前持续回归仍运行 `packages/backend/test/plugin-sandbox-ui-sdk.test.mjs` 的锁定 1.1.0 测试；latest 结果是上述日期的一次精确版本对照，不等于未来 tag 自动兼容。

## 明确保留的边界

本次仅扩展普通工具执行上下文中的基础 UI，不代表任意官方 ExtensionAPI 全兼容。未受支持的事件钩子、命令、快捷键、flags、providers、MCP 注册及自定义终端 UI 仍需逐项适配或明确诊断；本次不将这些项目改成 PASS。`ctx.ui.custom()` 的不支持行为已有单独回归。

P2 所需的同一作用域 UI/模型共享领域 runtime、受授权 Vault/文件持久化端口、领域清单与具名 IPC 删除，以及各领域完整迁移仍是独立后续工作。此前用户暂缓的外部账户与设备验收、MinerU/GROBID 和 B8 不因本次对照恢复执行。
