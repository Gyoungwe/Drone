# 下一阶段 P1：第三方扩展、外部 MCP 与 Protocols.io

本轮实现离线合同和宿主边界，不使用第三方凭据、不执行真实外部写入，也不把网络探测当作验收通过。

## 官方第三方扩展接入

`packages/shared/src/plugin-admission.ts` 提供安装前来源门禁：

- npm 来源必须来自允许的 registry，并携带完整性字段；
- package 名称和版本必须符合 npm/semver 形状；
- Desktop UI 包必须声明 Drone manifest，普通 L0 Pi 包仍允许无 manifest；
- 当前宿主不支持的 host、Git 来源和未声明完整性会在安装前阻断；
- `@gyoungwe/*` 被标为 official，其他 npm 作用域被标为 community，本地路径被标为 local。

该模块只判断已读取的元数据；安装确认、生命周期、停用和回滚仍由宿主 PackageService 负责。未加入签名或自动信任绕过。

## 外部用户 MCP

`packages/shared/src/mcp-external.ts` 提供不含凭据和服务器正文的诊断与隔离合同：

- 项目级服务器没有显式批准时报告 `project-approval-required`；
- 未知 transport、缺少 stdio command、非法 URL 和未在 allowlist 中的 origin 会报告错误；
- `mcpIsolationKey` 以作用域、服务器名和项目路径生成不透明命名空间，避免跨项目共享状态。

`McpService.getConfig()` 将这些诊断作为可选 metadata 返回；原有 server 列表和启停行为保持兼容。真实用户 MCP 地址、工具调用和凭据不在本证据中。

## Protocols.io 写入

现有 backend `createProtocolsBookmarkWriteAdapter` / `createProtocolsBookmarkWritePort` 已接入研究写入服务：

1. `prepareWrite` 只生成带目标、payload hash 和 `external-write` 标记的预览计划；
2. `executeWrite` 每次都要求一次性明确授权，拒绝授权会消费计划并生成 blocked 审计回执；
3. 注入的 host port 执行 Protocols.io bookmark `GET → POST → GET → DELETE → GET` 闭环，并验证 bookmark 状态探针；
4. 缺少授权 port、bookmark 状态无法证明为空、回读或删除验证失败时均 fail closed；
5. 环境变量不会自动开启写入，因为 Protocols.io 没有可用的文档化 bookmark 状态读取接口。

真实 Protocols.io 账户写入仍为 **BLOCKED（缺少用户授权和凭据）**；离线 fake port 和 HTTP fixture 只证明合同，不等同于真实验收。

## 离线验证

```sh
npx vitest run packages/shared/src/plugin-admission.test.ts packages/shared/src/mcp-external.test.ts packages/shared/src/host-api/mcp.test.ts packages/backend/test/mcp-service.test.ts packages/backend/test/reversible-write-adapters.test.ts packages/backend/test/research-write.test.ts
```

本证据不得包含 npm token、Protocols.io token、MCP env、Vault 正文、会话正文或 `results/`。
