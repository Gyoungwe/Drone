# P1 验收证据：宿主依赖面收口

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

## 未完成/阻塞

- P1 只改宿主仓库，未推送分支；按维护规则，外部 push 需要单独授权。
- 完整 `npm run test` 当前仍有 4 个基线失败：backend 的 channel-watch 恢复夹具为空、source archive schema 断言仍期待旧的 `required: [run_dir, category]`、Obsidian setup 全局 owner 夹具为空，以及 desktop spacing-grid 夹具存在既有半步值。它们与本阶段入口收口无关，未改计划外行为。
- `npm run build` 已通过；P2 完成后仍需在干净 checkout 和插件仓库产物可用时重跑跨仓库构建验收。

本阶段未触碰凭据、Vault、会话正文、`results/` 或 `drone-plugins` 工作树。
