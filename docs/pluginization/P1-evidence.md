# P1 验收证据：宿主依赖面收口

> **历史记录（2026-10-21）**：本文件保留 P1 分支当时的执行环境和基线失败，不代表当前发布状态。P1 后续已随 v2 合入 Drone `main`；当前合并 head、插件 head、公开包版本和最终门禁以 [`v3-evidence.md`](v3-evidence.md)、[`acceptance-3.md`](acceptance-3.md) 及 [`gap-closure-plan.md`](gap-closure-plan.md) 为准。

日期：2026-10-21（Asia/Shanghai）
Drone 分支：`codex/pluginize-v2-p1`
Drone 基线：`87aa0afe`
P1 实现提交：`ded814fb`
`drone-plugins` 参考头：`734c4c0`（本阶段未修改插件仓库）

## 已完成

- 新增 `packages/knowledge/src/host.ts`，并在 `@drone/knowledge` 暴露 `./host`；backend、research、desktop 以及 backend 测试的知识导入统一到该入口。
- 新增 `@gyoungwe/plugin-api/knowledge`：承载知识快照、来源回执、能力来源、演化/复用记录、确定性合同哈希，以及宿主 UI 使用的图谱、概览、最近笔记和 flow 类型。
- `@drone/knowledge` 的源码和测试不再 import `@drone/shared`；共享包通过 `@gyoungwe/plugin-api/knowledge` 提供兼容类型导出。
- `@gyoungwe/plugin-api` 版本升到 `1.1.0`，共享包和知识包的 workspace 依赖、package-lock 已同步。
- `scripts/check-architecture.mjs` 新增知识包边界和 `@drone/knowledge/host` 唯一入口规则；架构测试增至 5 项。
- 新增 [`p1-inventory.md`](p1-inventory.md)，记录知识入口及其 internal 依赖的 knowledge/host/research 归属；`internal/knowledge-extension.ts` 的 research 依赖改由 `runtime-host` seam 注入。
- `docs/INDEX.md` 已加入 P1 清单和 v2 计划导航。

## 定向检查

| 命令 | 结果 |
|---|---|
| `npm run check -w @gyoungwe/plugin-api` | PASS；plugin-api package gate passed |
| `npm run test -w @gyoungwe/plugin-api` | PASS；5 tests |
| `npm run check:plugin-api` | PASS；1.1.0 tarball、drone-plugins 绑定和 0.9.0→1.1.0→0.9.0 生命周期通过 |
| `npm run typecheck -w @drone/knowledge` | PASS |
| `npm run test -w @drone/knowledge` | PASS；35 files / 319 tests |
| `npm run typecheck -w @drone/shared` | PASS |
| `npm run typecheck -w @drone/research` | PASS |
| `npm run typecheck -w @drone/backend` | PASS |
| `npm run typecheck -w @drone/extensions` | PASS |
| `npm run typecheck -w @drone/desktop` | PASS |
| `npm run test:unit -w @drone/backend -- test/knowledge-ui.test.mjs` | PASS；25 tests |
| `npm run test:arch` | PASS；5 tests |
| `npm run check:arch` | PASS；0 new findings |
| `npm run lint` | PASS；仅有仓库既有 2 MiB 设计 HTML 文件大小 warning |
| `npm run build` | PASS；Electron/Vite main、preload、renderer 构建完成 |

## 当时未完成/阻塞（已由后续合并验收取代）

- P1 分支当时未推送；后续已通过 C0 合入 Drone `main` 并完成推送。
- 当时完整 `npm run test` 的 4 个基线失败已被后续修复和最终验收取代；当前 `main` 的全量测试 `rc=0`，见 C0/C2 合并门禁记录。
- 当时要求的干净 checkout / 插件产物重跑已在 P2、C0 和 C2 完成；当前锁文件指向插件 `main=b6bc98d7d0ac99461ae3249fb0a47b713166d007`。

本阶段未触碰凭据、Vault、会话正文、`results/` 或 `drone-plugins` 工作树。
