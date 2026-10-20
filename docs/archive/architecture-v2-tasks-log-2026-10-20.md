# architecture-v2-tasks.md · archived execution log (2026-10-20)

## 执行日志

| 2026-10-01 | A7-1 增量 | `StorageRegistry.registerDiscoveredRoot` 为宿主发现的项目工作目录提供稳定、脱敏、幂等登记；SessionService 在 create/open session 时登记 `<cwd>/.local/agent-work`，重复会话不会产生重复条目；registry 6/6 通过 | 研究结果目录与知识库 Vault 仍由扩展配置动态发现，下一步需在 host 配置刷新时调用同一登记入口 |
