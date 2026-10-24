# 下一阶段 P1：第三方扩展、外部 MCP 与 Protocols.io

本轮完成真实公开 npm 包、真实本地外部 MCP 进程和 Protocols.io 公开只读 GET；不使用第三方凭据、不执行 Protocols.io 写入，也不把离线 fixture 当作真实验收。

## 官方第三方扩展接入

`packages/shared/src/plugin-admission.ts` 提供安装前来源门禁：

- npm 来源必须来自允许的 registry，并携带完整性字段；
- package 名称和版本必须符合 npm/semver 形状；
- Desktop UI 包必须声明 Drone manifest，普通 L0 Pi 包仍允许无 manifest；
- 当前宿主不支持的 host、Git 来源和未声明完整性会在安装前阻断；
- `@gyoungwe/*` 被标为 official，其他 npm 作用域被标为 community，本地路径被标为 local。

该模块只判断已读取的元数据；安装确认、生命周期、停用和回滚仍由宿主 PackageService 负责。未加入签名或自动信任绕过。公开 `@gyoungwe/pi-connectors@0.1.1` 在临时 npm prefix 安装后，通过 `PluginSandboxSession` 在独立 Node 进程中注册并调用 `connector_list`，工具清单和结果均通过代理回执。

## 外部用户 MCP

`packages/shared/src/mcp-external.ts` 提供不含凭据和服务器正文的诊断与隔离合同：

- 项目级服务器没有显式批准时报告 `project-approval-required`；
- 未知 transport、缺少 stdio command、非法 URL 和未在 allowlist 中的 origin 会报告错误；
- `mcpIsolationKey` 以作用域、服务器名和项目路径生成不透明命名空间，避免跨项目共享状态。

`McpService.getConfig()` 将这些诊断作为可选 metadata 返回；原有 server 列表和启停行为保持兼容。`packages/backend/test/mcp-connector-gates.test.ts` 启动独立 stdio MCP 进程，用唯一 marker 完成启用→真实工具调用→停用→重载反证；没有读取用户 MCP 配置或凭据。

## Protocols.io 写入

现有 backend `createProtocolsBookmarkWriteAdapter` / `createProtocolsBookmarkWritePort` 已接入研究写入服务：

1. `prepareWrite` 只生成带目标、payload hash 和 `external-write` 标记的预览计划；
2. `executeWrite` 每次都要求一次性明确授权，拒绝授权会消费计划并生成 blocked 审计回执；
3. 注入的 host port 执行 Protocols.io bookmark `GET → POST → GET → DELETE → GET` 闭环，并验证 bookmark 状态探针；
4. 缺少授权 port、bookmark 状态无法证明为空、回读或删除验证失败时均 fail closed；
5. 环境变量不会自动开启写入，因为 Protocols.io 没有可用的文档化 bookmark 状态读取接口。

Protocols.io 写入仍按当前红线保持 **BLOCKED（只读计划，不执行账户写入）**；`scripts/check-protocols-readonly.mjs` 对公开协议页面完成一次无凭据 GET，确认 200、页面标题和 `mutations: 0`。离线 fake port 和 HTTP fixture 只证明未来写入合同，不等同于写入验收。

## 离线验证

```sh
npx vitest run packages/shared/src/plugin-admission.test.ts packages/shared/src/mcp-external.test.ts packages/shared/src/host-api/mcp.test.ts packages/backend/test/mcp-service.test.ts packages/backend/test/reversible-write-adapters.test.ts packages/backend/test/research-write.test.ts
```

本证据不得包含 npm token、Protocols.io token、MCP env、Vault 正文、会话正文或 `results/`。

## 真实验收命令

```sh
npm run check:public-plugin-host
npm test -w @drone/backend -- test/mcp-connector-gates.test.ts --reporter dot
npm run check:protocols-readonly
```

三项均在 2026-10-24 通过；公开包脚本最后输出 `cleanPrefix: true`，MCP 回执包含唯一 marker，Protocols.io 回执明确 `credentials: "none"` 和 `mutations: 0`。

本轮宿主门禁也已通过：`DRONE_PLUGINS_DIR=/Users/gaoyangwei/Documents/ChatGPT/drone-plugins npm run typecheck`、`npm test` 和 `npm run build` 均返回 0；随后 `npm run check:arch`、`npm run check:plugin-api -- --migration --lifecycle`、`npm run check:desktop-artifact -- --strict`、`npm run check:pi-core` 与 `npm run check:pi-research` 均 PASS。构建与全量测试使用本地插件源覆盖，只用于复现，不改变 `plugins.lock.json`。
