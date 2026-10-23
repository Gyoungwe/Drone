# P0 权限执行与 plugin-api 治理切片

日期：2026-10-24

## 已交付

- `@gyoungwe/plugin-api@1.1.0` 保持不变，没有执行 npm 发布或访问第三方账户。
- `packages/plugin-api/src/index.ts` 新增 `PluginPermissionDeclaration`、`PluginPermissionOperation`、`PluginPermissionAuditEvent` 和 `createPermissionedHostPort`。
- 宿主把插件声明传给 `createPermissionedHostPort` 后，`write`、`delete`、`publish`、`network`、`subprocess` 和文件读写动作会先经过声明门禁；未声明的动作返回 `granted: false`，不会调用宿主授权端口，并写入不含凭据/正文的审计回执。
- 已声明的动作仍由宿主授权端口决定，授权结果同样写入审计回执。未知动作保持原有授权流程，避免把任意业务动作误分类为权限。
- 增加回归测试覆盖：未声明外部写入拒绝与审计、已声明外部写入委托与审计。
- `packages/plugin-api/README.md` 记录了 API v1 只增不删、公共版本治理、干净消费者验收和当前切片不等于进程沙箱的边界。

## 检查结果

| 检查 | 结果 |
| --- | --- |
| `npm run build --workspace @gyoungwe/plugin-api` | PASS |
| `node --test packages/plugin-api/test/index.test.mjs` | PASS（7/7） |
| npm publish / registry 登录 | NOT_RUN（本轮明确禁止） |
| 真实进程级沙箱 | BLOCKED / 后续任务：需要宿主进程隔离方案、策略继承、资源限制和正式安装包验收 |

## 约束与后续

`createPermissionedHostPort` 只约束通过 `DroneHostPort` 发起的宿主操作。插件若绕过该端口直接使用 Node 文件、网络或子进程 API，当前版本不能声称已被隔离；第三方扩展接入前必须完成进程级沙箱设计和真实安装包验收。API 合同没有升级版本号，因为本次新增仅为向后兼容的导出，不改变 `pluginApi: 1`。
