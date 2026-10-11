# PR #113 与 1–6 整合审查记录

**审查日期：** 2026-10-11（UTC）
**仓库：** `Gyoungwe/Drone`
**PR：** [#113 research observatory graph and explicit WebDAV sync](https://github.com/Gyoungwe/Drone/pull/113)
**PR head：** `18f9b48678ba0515aa334d2616ce242e9e215fea`
**本地整合分支：** `codex/v0261-integration`（验证代码提交 `7c1d346`）
**整合基线：** `main` / `4cb28d32cd7af709f7e71917cceae636260393ef`

## 结论

PR #113 的 WebDAV 显式同步和知识网络观测台可以与 1–6 的本地改动整合；在整合分支修复派生运行时产物后，仓库级测试和发布门禁全部通过。PR 自身的 GitHub CI run 320 仍失败，两个失败点都是提交中未同步派生产物，而不是 WebDAV/语义模型单元测试失败：

- `Static checks` 在 `npm run check:extensions` 失败：6 个扩展 bundle 依赖输入发生变化。
- `Desktop and workspace tests` 在 `npm run check:knowledge-runtime` 失败：知识 runtime manifest、入口和 chunks 过期。
- Backend SDK 与 unit jobs 均通过；桌面、shared、extensions、knowledge、tasks、research、compute、inquiry 单包测试均通过。

本地整合分支执行 `npm run build:extensions -- --force`、`npm run build:knowledge` 并提交产物后，两个失败门禁均通过；知识模型改动又被 research runtime bundle 引用，因此同时执行 `npm run build:research` 并提交 `.pi/lib/research-run-summary.mjs` 与 manifest。

## 本地整合提交

| 提交 | 内容 |
|---|---|
| `6e2a142` | 将 PR #113 合并到 `codex/v0261-validation` 的 1–6 改动上 |
| `543ef1d` | 刷新 12 个扩展的 generated bundle 与 manifest |
| `7c1d346` | 刷新知识模型依赖的 research runtime bundle 与 manifest |

整合范围相对 v0.26.0 为 52 个文件、约 2,791 行新增、328 行删除；其中既包含 1–6 的 CI/文档/耐久会话测试，也包含 PR #113 的知识图谱、WebDAV、shared IPC 和 UI 改动。工作树在验证后保持干净。

## 验证结果

| 门禁/测试 | 结果 | 说明 |
|---|---:|---|
| PR head `npm run lint` | 通过 | GitHub CI 与本地均通过 |
| PR head desktop typecheck | 通过 | GitHub CI 与本地均通过 |
| PR head WebDAV sync | 通过 | 4 tests；独立 worktree 连续重跑通过 |
| PR head semantic model | 通过 | 4 tests；独立 worktree 连续重跑通过 |
| `check:extensions` | 通过 | 重新生成后验证 12/12 mappings |
| `check:knowledge-runtime` | 通过 | 重新生成后 manifest/chunks 与源一致 |
| `check:tasks-runtime` | 通过 | runtime 与 compatibility artifacts up to date |
| `check:research-runtime` | 通过 | 刷新 research runtime 后通过 |
| `lint` | 通过 | Biome 检查 1,482 个文件 |
| 全 workspace `typecheck` | 通过 | 含 `.pi` 检查 |
| `check:arch` / `test:arch` | 通过 | 0 baseline finding；3/3 tests |
| `check:plugin-api` | 通过 | projections up to date |
| `test:research-packaging` | 通过 | 16/16 |
| `stage:pi-packages` / `check:pi-packages` | 通过 | pi-mcp-adapter 5.1.0 |
| `npm run build` | 通过 | Electron 生产构建；仅有第三方 Rollup 注释提示 |
| `npm run test:upgrade -- --fixtures-only` | 通过 | orchestration-stress、hybrid-fixture、packaged-resources |
| 完整 `npm test` | 通过 | backend 200 files/1771 passed/13 skipped；其余 workspace 全部通过；根脚本 4/4 |
| durable crash/restart | 通过 | SIGKILL 后恢复、inbox 去重、外部 effect fixture 只保留一次 |

完整客户端控件与行为清单见：

- [核心客户端 UI 盘点](../../ui-audit/2026-10-11-core-client-ui-inventory.md)
- [设置、知识、WebDAV 与研究 UI 盘点](../../ui-audit/2026-10-11-settings-knowledge-ui-inventory.md)
- [PR113 逐项代码审查](2026-10-11-pr113-review.md)

## 尚未阻断本地合并、但必须进入第 9 项收口的风险

### P1：大 Vault 的图谱建模成本

`knowledgeGraph()` 先把所有 notes/links 交给 `createSemanticModel()`，最后才截取前端 400 个节点。`sectorLayout()` 还会为非主节点重复扫描路径和邻接关系。独立稀疏链基准约为：500 节点 58.9 ms、1,000 节点 176.7 ms、2,000 节点 460.7 ms、5,000 节点 3.76 s、10,000 节点 10.52 s。需要在合并 PR #113 前或紧随其后的补丁中，把候选硬上限/连通分量筛选和邻接预分组落地，并加入 1k/5k/10k 的 p95 回归门禁。

### P1：主节点超过五个时可能出画布

固定宽度 720、主节点间距下限 170，在 10 个主节点时会生成约 `x=-405..1125` 的坐标。应改成受画布边界约束的多行/网格/环形布局，或让初始视图自动 fit；增加 1、5、10、50 主节点的边界测试。

### P2：SVG 读屏语义和键盘空间键

外层 `svg role="img"` 可能把内部 `g role="button"` 隐藏为原子图像；Space 选择节点时还应阻止页面滚动。优先提供同步的可操作节点列表，补 Enter/Space、focus-visible、screen-reader 名称和 reduced-motion 测试。

### P2：WebDAV 远端覆盖的 compare-and-swap 窗口

采用云端内容覆盖本地时，当前先校验 hash、再 `lstat`/rename；编辑器可能在检查与替换之间写入。下一步应让 `replaceVaultFile` 携带期望 hash/签名，在锁或同一打开句柄内 compare-and-swap，失败返回 conflict，并补并发写回归测试。

这些风险不会被“生成物已刷新”掩盖；第 9 项的合入条件应同时要求 P1 具备性能/坐标证据，P2 具备行为和可访问性测试，或由维护者明确记录接受期限和降级方案。

## 交付边界

本次只在本地建立整合分支、修复派生资源并完成验证；没有合并远程 PR、创建 tag、发布 release 或向远程推送新分支。PR #113 的 GitHub 失败原因和本地修复证据已具备，下一步按 [发布治理与 UI 升级计划](../plans/2026-10-11-release-governance-and-ui-upgrade.md) 进行 review/merge。
