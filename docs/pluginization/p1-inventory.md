# P1 extensions 归属清单

本清单只盘点知识入口及其 `internal/` 依赖。P1 不移动文件；P2 按归属迁移并保留历史。`host` 表示仍由宿主组合根提供文件系统、任务运行时或 Electron/Pi 适配，`knowledge` 表示应随 `pi-knowledge` 迁移，`research` 表示属于研究来源/交付能力。

| 文件 | 归属 | 当前跨域依赖 | P2 处理 |
|---|---|---|---|
| `packages/extensions/src/knowledge-extension.ts` | knowledge | `@drone/knowledge/orchestration-policy` | 迁入插件 extension 入口 |
| `packages/extensions/src/knowledge-worker.ts` | knowledge | `@drone/knowledge/worker` | 迁入插件 worker 入口 |
| `packages/extensions/src/internal/knowledge-extension.ts` | knowledge | knowledge 多个运行时模块；`@drone/tasks/*`；通过 `runtime-host` 使用 delivery seam | 迁入插件 extension；任务与研究能力改由 HostPort 注入 |
| `packages/extensions/src/internal/knowledge-runtime.ts` | host | `@drone/tasks/*`；`@drone/research/source-delivery` 作为宿主注入 | 保留宿主适配，插件只消费注入 seam |
| `packages/extensions/src/internal/obsidian-setup.ts` | host | Node 文件系统/路径 | 保留宿主配置发现 |
| `packages/extensions/src/internal/obsidian-workbench.ts` | host | knowledge；`@drone/tasks/*`；Node 文件系统 | 保留宿主 Vault 与任务注册 |
| `packages/extensions/src/obsidian-workbench.ts` | host | knowledge；`@drone/tasks/*` | 保留宿主组合入口 |
| `packages/extensions/src/workspace-config.ts` | host | knowledge；`@drone/tasks/*`；Node 文件系统 | 保留宿主工作区配置 |
| `packages/extensions/src/internal/vault-layout.ts` | host | Node 文件系统/路径 | 保留宿主 Vault 布局 |
| `packages/extensions/src/internal/vault-profiles.ts` | host | 无跨包依赖 | 保留宿主 Vault profile |
| `packages/extensions/src/internal/vault.ts` | host | Node 文件系统/路径 | 与 `vault-layout` 合并评估后保留宿主适配 |
| `packages/extensions/src/internal/reply-focus.ts` | host | 无跨包依赖 | 保留宿主提示词策略；如产品决定随插件迁移再单独拆分 |
| `packages/extensions/src/internal/runtime.ts` | host | Node `AsyncLocalStorage` | 保留宿主运行时绑定 |
| `packages/extensions/src/internal/discovery-prompt.ts` | knowledge | 无跨包依赖 | 与知识提示词一起迁入插件 |

P1 已把 `internal/knowledge-extension.ts` 对 `@drone/research/source-delivery` 的直接 import 收口为 `@drone/knowledge/runtime-host` seam；研究侧实现由 `internal/knowledge-runtime.ts` 在宿主组合时注入。这样迁移知识入口时不会把 research 包依赖带入知识领域包。
