# 普通 domain worker 禁用 Node SQLite

2026-10-28。此次是独立的防御收窄，不构造目录外访问或绕过实验，也不新增 binary/Inquiry 端口。

Node 官方说明其 Permission Model 是受信代码的资源限制，不承诺恶意代码安全边界；FS 权限不能等同所有内置模块的文件访问隔离。参见[官方权限说明](https://github.com/nodejs/node/blob/main/doc/api/permissions.md)。官方 CLI 的 [`--no-experimental-sqlite`](https://nodejs.org/api/cli.html#--no-experimental-sqlite) 用于关闭 `node:sqlite`，自 Node 22.5.0 提供。

`createProcessPluginRuntime` 对普通 domain activation 加入该关闭参数，继续保留现有 `--permission`、包目录只读 grant、无继承 PATH/凭据、无 child/network grant。没有旧版本 fallback，也不让插件输入控制此启动参数。标准 Pi CLI 不经过这个 Desktop worker，行为保持其既有明确授权入口。

实际 staged runtime 为 Node **26.12.1 darwin-arm64**，runtime.json 的二进制 SHA256 为 `06eb3f5762c2b6890e99d03f931bf01d9b20fd341dec1a8c1ef5c1809e66102b`。实际创建的普通 worker 在生产 registry/factory 内只尝试 import，返回 `ERR_UNKNOWN_BUILTIN_MODULE`；进程实际 execArgv 含关闭参数。没有创建/访问目录外文件。

防御回归：`packages/backend/src/plugins/process-runtime.test.ts` 的 `disables the SQLite builtin in the actual ordinary domain worker`；包含其他生命周期/取消回归共 **17/17** 通过，日志 `/tmp/discovery-c-sqlite-import-defense-test.log`。真实启动参数由 `packages/backend/src/plugins/process-runtime.ts` 组装，顺序为 `--permission --no-experimental-sqlite --allow-fs-read=<packageRoot> --input-type=module --eval <worker> <entrypoint>`。

本次不修改需要 SQLite 的既有 index resource 参数，不声称其 FS 限制已覆盖 SQLite，也不声称已完成该资源的兼容/安全验收：**NOT_RUN / 需独立隔离方案**。Inquiry 的 Node SQLite resource 方案暂停；改查纯内存/WASM SQLite 是否能复用 canonical SQL 与保留原文件字节格式，未获得新端口批准前不实施原库持久化。
