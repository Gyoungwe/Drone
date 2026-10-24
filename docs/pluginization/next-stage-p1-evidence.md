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

## 2026-10-24 第 3–4 项收口复验

本次补充复验只使用公开 registry 和本地临时目录，不读取用户凭据、不连接用户自有 MCP 服务，也不执行外部写入。

- `npm run check:public-plugin-host`：**PASS**。从 npm registry 的干净 prefix 安装 `@gyoungwe/pi-evidence@0.1.1`、`@gyoungwe/pi-connectors@0.1.1` 和 `@gyoungwe/desktop-ui-pack@0.1.1`；Pi loader 发现并核对工具清单，进程沙箱完成 `connector_list` 调用，Desktop UI 生命周期通过。
- 同一脚本的公开包生命周期：**PASS**。在另一个干净 prefix 中完成 `@gyoungwe/pi-connectors@0.1.0 → 0.1.1 → rollback:0.1.0 → uninstall`，卸载后包目录不存在；回执为 `cleanPrefix: true`。
- `npx vitest run packages/backend/test/mcp-external-policy.test.ts packages/shared/src/mcp-external.test.ts packages/backend/test/mcp-connector-gates.test.ts --reporter dot`：**PASS**，3 个测试文件、8 个测试通过。覆盖本地独立 stdio MCP 的真实 marker 调用与停用重载、用户级 HTTP MCP 的无凭据元数据诊断、非法 URL fail-closed 和隔离键；测试不会探测远端 URL，且回执不包含环境变量中的 token。

边界状态保持明确：`@gyoungwe/*` 是 Drone 维护的公开包，不构成独立第三方扩展来源。未提供独立第三方包名、来源、许可和版本范围前，**真实第三方扩展验收为 BLOCKED**。同样，未提供用户自有 MCP 的 URL、账户和凭据范围前，**外部用户 MCP 的网络连接验收为 BLOCKED**；本地 stdio 和配置诊断切片不升级为真实账户 PASS。

本轮宿主门禁也已通过：`DRONE_PLUGINS_DIR=/Users/gaoyangwei/Documents/ChatGPT/drone-plugins npm run typecheck`、`npm test` 和 `npm run build` 均返回 0；随后 `npm run check:arch`、`npm run check:plugin-api -- --migration --lifecycle`、`npm run check:desktop-artifact -- --strict`、`npm run check:pi-core` 与 `npm run check:pi-research` 均 PASS。构建与全量测试使用本地插件源覆盖，只用于复现，不改变 `plugins.lock.json`。

## 2026-10-24 Protocols.io 与整页知识 UI 收口审计

本次审计没有使用 OAuth、Protocols.io 账户或用户 Vault，也没有执行任何外部写入。

### Protocols.io

- `createProtocolsBookmarkWritePortFromEnv` 在只有 API token、没有宿主注入的 bookmark-state probe 时仍返回 `undefined`；环境变量不会把写入端口自动打开。
- `ResearchWritePanel` 只允许生成本地写入计划；当 `protocols-bookmark-write.writeEnabled=false` 时，执行按钮保持禁用，不会调用 `executeWrite`。
- 现有 host port 仍要求 `GET → POST → GET → DELETE → GET`，每次执行要求一次性明确批准，并对目标身份、读回和删除结果做 fail-closed 校验。真正启用仍需要 OAuth/账户授权和可证明 bookmark 状态的 host probe。
- 新增 UI 回归：`packages/desktop/src/renderer/src/components/research/ResearchWritePanel.test.tsx`，覆盖无授权端口时可预览但不可执行。
- 只读验收仍为 PASS：`npm run check:protocols-readonly`，`credentials: "none"`，`mutations: 0`。写入状态保持 **BLOCKED**。

### 整页 knowledge UI 插件化

- `knowledge.page` 仍由第一个启用贡献接管；无贡献或插件停用时回到内置知识库页。
- `PluginEntryHost` 现在接受可选 `fallback`，整页贡献渲染抛错时也回退内置知识页，避免页面空白；其他区域继续保留原有无默认贡献语义。
- 新增 `PluginRegions.test.tsx` 回归，覆盖 `knowledge.page` 贡献崩溃后的默认页回退；原有四区域挂载/卸载和总开关关闭测试继续通过。
- 该项仍是 **PARTIAL**：宿主挂载点、停用回退和故障回退已具备，完整产品页面所有权迁移和真实第三方知识工作台仍需单独产品范围授权与正式包人工验收。

离线验证：

```sh
npx vitest run packages/desktop/src/renderer/src/plugins/PluginRegions.test.tsx \
  packages/desktop/src/renderer/src/components/research/ResearchWritePanel.test.tsx \
  --config packages/desktop/vitest.config.ts
```

结果：2 个测试文件、7 个测试通过；未访问外部账户、凭据或 Vault。
