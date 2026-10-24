# 独立第三方科研扩展与公开远端 MCP 验收

范围：用户授权自行选择科研扩展后，选择独立维护的 `nicobailon/pi-web-access`（MIT），以 PubMed 文献检索作为可核实的科研用途。版本固定为 `0.43.0 → 0.44.0 → 0.43.0`；原生 Pi SDK 固定 `1.1.0`。机器回执见 [JSON](scientific-external-acceptance-2026-10-24.json)，复现入口是 `scripts/check-scientific-external.mjs`。

脚本清空继承环境，仅保留 PATH，并把 HOME、Pi agent、项目、npm 用户配置和安装目录全部隔离；安装不执行 lifecycle scripts，不使用生产 Vault、模型令牌、浏览器 cookie 或用户 MCP 配置。联网仅发出公开文献查询；只保存结果摘要、公开来源 URL 和哈希，不保存会话正文。

## 验收口径

- 扩展必须在真正创建并绑定的 Pi session 中调用 `web_search`，收到实际 PubMed URL 和非空结构化结果；单独 loader 加载不算成功。
- 安装、升级、恢复启用、回滚均重新创建独立进程与会话，避免旧模块缓存伪装版本变更。停用和卸载检查无该扩展工具；卸载还核实 npm 安装目录已删除。
- 公开 Exa MCP 通过与 Drone 相同版本的 `pi-mcp-adapter@5.1.0` 加载，在 Pi session 中调用远端 `web_search_exa`；停用后的新会话必须拒绝调用，恢复后重新收到文献结果与状态事件。
- 没有调用模型，工具调用由验收驱动器发起；这证明实际 SDK、扩展和远端服务，不证明模型选择工具的质量，也不替代正式 Drone GUI 权限提示/安装/诊断验收。
- 公共 Exa 服务不是用户自有账户服务；OAuth、私有资源和凭据隔离的账户级验收仍需要真实测试账户。

## 实测限制

- 本机 TUN fake-IP DNS 使直接网页 `fetch_content` 命中扩展的 SSRF 拒绝。没有关闭或放宽 SSRF 保护；本轮科研功能以实际 Exa 检索结果验收。
- Exa 当前 `web_search_exa` schema 要求 `objective`。旧参数调用返回缺少该字段的诊断；验收按实际参数合同提供研究目标。
- `pi-web-access` 注册快捷键和命令，Drone 当前 process sandbox 明确不支持这些 Extension API。原生 SDK 接入成功不能当作此扩展进程沙箱兼容证据；不通过忽略 API 调用来假装成功。

## Protocols.io：只读接口核实

[官方 API 文档](https://apidoc.protocols.io/) 已列出 `https://www.protocols.io/mcp`，采用 Streamable HTTP，支持 OAuth 2.0 或 client Bearer token。[开发者入口](https://www.protocols.io/developers) 提供账户授权配置。

官方 REST 文档提供 `POST /api/v3/protocols/<protocol_uri>/bookmarks` 与相同路径的 `DELETE`，两者都需要 Bearer token。协议内容读回使用官方 Get Protocol 接口；书签是否存在应通过账户的 File Manager 查询实际确认，不能把公开内容 GET 成功当作书签写后读回。此次仅核实文档，未发起任何写入、删除、OAuth 注册或账户变更，写入状态保持 **BLOCKED：缺测试账户授权凭据及可核实的写后账户状态**。

## 官方来源

- [Pi 官方包目录](https://pi.dev/packages?name=web-access)
- [扩展源码](https://github.com/nicobailon/pi-web-access)、[MIT 许可证](https://github.com/nicobailon/pi-web-access/blob/main/LICENSE)
- [npm 元数据](https://registry.npmjs.org/pi-web-access/0.44.0)
- [Exa 官方 MCP 文档](https://exa.ai/docs/get-started/exa-mcp)：公开托管入口无需 API key；本轮不启用需要认证的 Agent 工具。
