# P0 权限执行与 plugin-api 治理切片

日期：2026-10-24

> **本轮复核更正**：旧 Node 22 网络拒绝测试连接 `127.0.0.1:9`，得到的是 fetch 的 bad-port 错误，不能证明权限拒绝。可达端点已复现旧沙箱仍可联网。Node 的网络权限控制从 v25 才提供，且 `--allow-net` 是全网布尔授权，不能把 hostname 参数当成域名白名单。正式 Electron 43 内置 Node 24.18.1，因此此前“Node 22 网络隔离 PASS”作废；当前正式包的完整第三方进程沙箱验收保持 BLOCKED。见 [Node 官方 CLI](https://nodejs.org/api/cli.html#--allow-net) 与本轮 [研究边界证据](../releases/research-boundary-acceptance-2026-10-24.json)。

## 本轮修复验证

- 加载插件前检查运行时网络权限能力；不具备能力直接拒绝。使用 `--permission`，空列表禁网，仅明确 `["*"]` 授予全网，拒绝不能兑现的域名范围。
- Node 22：5 项安全拒绝测试通过，3 项依赖支持运行时的正例跳过；Node 26.12.1：8/8 通过，以父进程可达的 HTTP 端点验证 `ERR_ACCESS_DENIED` 与服务端零新增请求。
- Electron 43 / Node 24.18.1：真实可执行文件 Node 模式验证加载插件前拒绝；这是一项安全拒绝回执，不能标为插件功能可用。
- 独立科研扩展完整性、真实独立进程 Europe PMC 读取及关闭/恢复见 [Node 26 验收](../releases/scientific-sandbox-acceptance-2026-10-24.json)。初次运行时失败记录保留为[历史失败](../releases/scientific-sandbox-candidate-2026-10-24.json)。

## 已交付

- `@gyoungwe/plugin-api@1.1.0` 保持不变，没有执行 npm 发布或访问第三方账户。
- `packages/plugin-api/src/index.ts` 新增 `PluginPermissionDeclaration`、`PluginPermissionOperation`、`PluginPermissionAuditEvent` 和 `createPermissionedHostPort`。
- 宿主把插件声明传给 `createPermissionedHostPort` 后，`write`、`delete`、`publish`、`network`、`subprocess` 和文件读写动作会先经过声明门禁；未声明的动作返回 `granted: false`，不会调用宿主授权端口，并写入不含凭据/正文的审计回执。
- 已声明的动作仍由宿主授权端口决定，授权结果同样写入审计回执。未知动作保持原有授权流程，避免把任意业务动作误分类为权限。
- 增加回归测试覆盖：未声明外部写入拒绝与审计、已声明外部写入委托与审计。
- `packages/backend/src/plugin-sandbox.ts` 增加进程级插件代理：permission model 限制文件读写和子进程，环境变量通过明确清单隔离（原 Node 22 网络限制声明已由上方更正作废），插件只在子进程注册可序列化工具，宿主通过 JSON-RPC 代理执行；启动/调用超时会终止子进程。
- `packages/backend/test/plugin-sandbox.test.ts` 覆盖跨进程 PID、环境变量脱敏、文件/网络/子进程拒绝、代理注册和调用超时。
- `packages/plugin-api/README.md` 记录了 API v1 只增不删、公共版本治理、干净消费者验收，以及权限合同与宿主进程沙箱能力的边界。

## 检查结果

| 检查 | 结果 |
| --- | --- |
| `npm run build --workspace @gyoungwe/plugin-api` | PASS |
| `node --test packages/plugin-api/test/index.test.mjs` | PASS（7/7） |
| npm publish / registry 登录 | NOT_RUN（本轮明确禁止） |
| 进程级插件沙箱 | PARTIAL：历史进程/文件回执保留，网络隔离旧 PASS 作废；不具备网络限制能力的运行时必须拒绝启动 |

## 2026-10-24 插件仓库权限声明门禁合入

`drone-plugins` 的 `codex/next-stage-implementation` 已快进合入并推送到
`main=046f8cbb5d0b3e9d7534e0dd7252b1c91d61ad2a`。本次包含：

- manifest 检查器拒绝 `externalWrites` 与 `readWrite.write` 互相矛盾的声明；
- 两个反例回归测试；
- `PLUGIN-SPEC.md` 补充声明门禁与进程沙箱边界。

插件仓库完整门禁 `npm run check` 通过：6 个 manifest、14 个清单测试、workspace
typecheck、各插件 build/check/test/smoke、干净安装、UI smoke 和 pack check 均通过。

以该插件 `main` 作为 `DRONE_PLUGINS_DIR` 运行的宿主门禁也通过：

- `npm run check:plugin-api -- --migration --lifecycle`：PASS；插件仓库 head 为
  `046f8cbb`，生命周期为 `0.9.0 → 1.1.0 → 0.9.0 → uninstall`；
- `npm run check:public-plugin-host`：PASS；公开包 loader、进程沙箱和 UI 生命周期均通过，
  `cleanPrefix=true`；
- `npm run check:arch`：PASS，0 baseline finding，宿主独立性通过。

本次没有改变公开包版本、`plugins.lock.json` 或执行 npm publish。

## 约束与后续

`createPermissionedHostPort` 仍只约束通过 `DroneHostPort` 发起的宿主操作。可选扩展通过 `createProcessSandboxedExtension` 进入子进程代理；当前代理支持工具注册/调用，宿主在 `session_shutdown` 时回收子进程，命令、快捷键、渲染器、provider、MCP 注册等不支持的 Pi 扩展 API 会 fail closed。Node permission model 是运行时边界，仍不替代操作系统级容器/seatbelt；正式宿主应在启动时记录平台能力和沙箱策略。API 合同没有升级版本号，因为本次新增仅为宿主实现，不改变 `pluginApi: 1`。
