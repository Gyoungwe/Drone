# Paper2Agent 接入 Drone

Paper2Agent 生成的是一个 MCP 服务器。Drone 通过 MCP 设置加载它的工具；Paper2Agent 的工具输出是外部交付物或线索，不能直接当作原文阅读回执、知识库证据或引用。需要支持论文结论时，仍要用 Drone 的 `research_read_source` 读取原文，并保留来源回执。

## 本地 stdio 服务器

先在本机生成或安装 Paper2Agent MCP 服务器，再在 Drone 的“设置 → MCP”中添加一个服务器。配置文件使用 Pi 格式（通常是 `~/.pi/agent/mcp.json`）：

```json
{
  "mcpServers": {
    "paper2agent-local": {
      "command": "node",
      "args": ["/absolute/path/to/paper2agent-mcp/dist/server.mjs"],
      "description": "Paper2Agent local MCP server",
      "enabled": true
    }
  }
}
```

将 `args` 中的路径替换为 Paper2Agent 实际生成的入口文件。需要环境变量时，在 MCP 面板中按服务器要求配置，凭据不要写入仓库或提交到项目文件。

## 远程 URL 服务器

Paper2Agent 服务提供 HTTP MCP 地址时，在同一面板添加 URL：

```json
{
  "mcpServers": {
    "paper2agent-remote": {
      "url": "https://your-paper2agent.example/mcp",
      "description": "Paper2Agent hosted MCP server",
      "enabled": true
    }
  }
}
```

把示例域名替换为服务方给出的 HTTPS 地址，并按服务方要求完成 OAuth 或其他认证。不要把 token、Cookie 或私有论文正文放进 `mcp.json`、项目仓库或交付文件。

## 使用边界

添加配置只会登记服务器；只有会话重载后实际调用 MCP 工具并获得返回值，才说明服务器可用。工具返回的摘要、抽取结果和生成文件按交付物处理，不能替代 `research_read_source` 的原文读取，也不能自动进入证据矩阵或知识库引用。需要沉淀时，先核对原文和来源身份，再按研究工作流的受控写入工具保存。
