# P0 权限执行与 plugin-api 治理切片

日期：2026-10-24

## 已交付

- `@gyoungwe/plugin-api@1.1.0` 保持不变，没有执行 npm 发布或访问第三方账户。
- `packages/plugin-api/src/index.ts` 新增 `PluginPermissionDeclaration`、`PluginPermissionOperation`、`PluginPermissionAuditEvent` 和 `createPermissionedHostPort`。
- 宿主把插件声明传给 `createPermissionedHostPort` 后，`write`、`delete`、`publish`、`network`、`subprocess` 和文件读写动作会先经过声明门禁；未声明的动作返回 `granted: false`，不会调用宿主授权端口，并写入不含凭据/正文的审计回执。
- 已声明的动作仍由宿主授权端口决定，授权结果同样写入审计回执。未知动作保持原有授权流程，避免把任意业务动作误分类为权限。
- 增加回归测试覆盖：未声明外部写入拒绝与审计、已声明外部写入委托与审计。
- `packages/backend/src/plugin-sandbox.ts` 增加进程级插件代理：Node 22 permission model 限制文件读写、网络、子进程和环境变量，插件只在子进程注册可序列化工具，宿主通过 JSON-RPC 代理执行；启动/调用超时会终止子进程。
- `packages/backend/test/plugin-sandbox.test.ts` 覆盖跨进程 PID、环境变量脱敏、文件/网络/子进程拒绝、代理注册和调用超时。
- `packages/plugin-api/README.md` 记录了 API v1 只增不删、公共版本治理、干净消费者验收，以及权限合同与宿主进程沙箱能力的边界。

## 检查结果

| 检查 | 结果 |
| --- | --- |
| `npm run build --workspace @gyoungwe/plugin-api` | PASS |
| `node --test packages/plugin-api/test/index.test.mjs` | PASS（7/7） |
| npm publish / registry 登录 | NOT_RUN（本轮明确禁止） |
| 进程级插件沙箱 | PASS（Node 22 子进程代理）；正式第三方包验收见 `next-stage-p1-evidence.md` |

## 约束与后续

`createPermissionedHostPort` 仍只约束通过 `DroneHostPort` 发起的宿主操作。可选扩展通过 `createProcessSandboxedExtension` 进入子进程代理；当前代理支持工具注册/调用，宿主在 `session_shutdown` 时回收子进程，命令、快捷键、渲染器、provider、MCP 注册等不支持的 Pi 扩展 API 会 fail closed。Node permission model 是运行时边界，仍不替代操作系统级容器/seatbelt；正式宿主应在启动时记录平台能力和沙箱策略。API 合同没有升级版本号，因为本次新增仅为宿主实现，不改变 `pluginApi: 1`。
