# 插件化与 OmicOS 计划缺口清理计划

日期：2026-10-23

本计划只处理现有计划、证据和发布状态之间的未完成项与不一致，不重新开启已经通过的 v2 或 OmicOS 六个 PR。

## 当前结论

### C0 当前状态

已完成插件仓库优先合并、宿主仓库同步后合并、锁文件更新和发布证据 head 更新。合并后的门禁结果见本文末尾的执行记录；C1–C4 仍待执行。

### 真实未完成项

| 优先级 | 项目 | 当前状态 | 完成证据 |
| --- | --- | --- | --- |
| P0 | 两个修复分支合入各自 `main` | 已完成：drone-plugins `main=b6bc98d7`；Drone `main=43ab8fdc`（后续仅有文档提交） | 两仓库 `main` 已推送；锁文件锁定 `b6bc98d7d0ac99461ae3249fb0a47b713166d007`，插件包版本与远程 head 一致；合并后的双仓库最终门禁通过 |
| P1 | v3 T3 真实安装包三页面验收 | 已完成：合并后的 unsigned macOS arm64 安装包通过 npm tarball 安装的非 `@gyoungwe` UI 插件完成三页回读和停用恢复 | [`v3-evidence.md`](v3-evidence.md) 与 [`v1.1-t3-ui-acceptance-2026-10-23.json`](../releases/v1.1-t3-ui-acceptance-2026-10-23.json) |
| P1 | v3 T4 `pi-analysis` host adapter 例外 | 静态宿主独立性和无可选插件运行检查已通过；host adapter 仍在登记例外中 | 删除例外并通过 `check:arch`、空插件运行检查；或者由用户明确批准把它移出 v3 并登记为后续架构任务 |
| P2 | PR6 评估结论 | pdf.js 结果已完成；MinerU/GROBID 仅记录为 unavailable；是否集成可选后端尚未决定 | 用户决定“保持 pdf.js”或创建后续集成计划；本轮不修改默认解析流程 |

### 仅文档或证据同步问题

- v2 的 P1/P2/P4 证据保留了历史失败、未发布或 N=2 待执行描述，但没有明确标注已被后续验收取代。
- `final-pluginization-plan.md`、`docs/INDEX.md` 和旧发布证据仍引用旧版本、旧 `main` 提交和“plugin-api 未发布”的历史状态。
- `drone-plugins/main` 的 workspace 版本与 npm 当前版本不同，必须明确“源码 main 状态”和“已发布 registry 状态”，不能混写。

### 有意保留的范围外项目

以下项目不是本次清理阻塞项，必须保持明确标记：B8 云端协作、Protocols.io 写入、官方第三方 extension、外部用户 MCP、完整交互式 Electron GUI 截图，以及方案 (b) 的整页知识 UI 插件化。

## 执行顺序

### C0：冻结事实并合并发布分支

1. 在 Drone 和 drone-plugins 分别确认工作树干净，核对当前分支、目标 `main`、插件锁文件和 npm 版本。
2. 先合并 drone-plugins，再合并 Drone；若合并产生新的插件提交，更新 Drone 的锁定 commit、版本和 tarball SHA-256。
3. 合并后在两个 `main` 上运行：

   ```sh
   npm run lint
   npm run typecheck
   npm test
   npm run build
   npm run check:arch
   npm run check:plugin-api -- --migration --lifecycle
   ```

   插件仓库运行 `npm run check`。

### C1：完成 v3 T3 真实安装包验收

1. 从合并后的 `main` 构建可启动安装包。
2. 使用一个非 `@gyoungwe` 作用域的 UI 插件，验证三个区域：知识库页签、首页分区、技能页分区。
3. 停用插件并验证知识库回到默认页签，首页和技能页不留下空壳。
4. 将结果写入 `docs/pluginization/v3-evidence.md`，同时补充 release evidence JSON；不提交截图中的用户数据、Vault 正文或会话正文。

### C2：关闭或重新登记 v3 T4 例外

先检查 `@gyoungwe/pi-analysis` host adapter 是否仍被生产源码需要：

- 若可删除：迁移到公开 HostPort，删除例外，补静态违规反例和空插件运行回归。
- 若暂时不能删除：在 v3 计划中把它改为“已接受的迁移例外”，写明保留原因、影响范围、删除条件和下一版本，不再同时称为“v3 未完成”。

### C3：统一计划与证据文档

1. 更新 `v3-evidence.md` 的 OmicOS 状态、基线 commit 和当前两个仓库 head。
2. 更新 v2 P1/P2/P4 证据中的历史状态，统一使用“历史记录 / 已被后续验收取代”的标记。
3. 更新 `final-pluginization-plan.md` 和 `docs/INDEX.md` 中的 npm 版本、插件仓库 head、公开包状态。
4. 在 `omicos-platform-plan.md` 的“当前未完成项”中只保留 T3、T4 和 PR6 决策，并链接本计划。
5. 对所有状态为 PASS 的条目保留真实安装包或真实会话证据；fixture、loader 单独加载和公开 HTTP 探测不能升级为最终 PASS。

### C4：完成最终清理审计

运行以下检查：

```sh
git diff --check
rg -n "未完成|尚未|待.*验收|部分通过|尚未发布|OmicOS 六个 PR 尚未开始" docs claude
npm run check:arch
npm run check:plugin-api -- --migration --lifecycle
```

审计结果应只留下：

- 已真实执行但尚未关闭的 T3 或 T4；
- 用户明确选择的 PR6 后续决策；
- 计划外或暂缓项目的明确 `OUT_OF_SCOPE` / `NOT_RUN` / `BLOCKED` 标记。

## 完成标准

- 两个仓库的 `main` 包含当前修复，锁文件、公开包版本和证据一致。
- T3 有真实安装包三页面验收证据。
- T4 要么删除 `pi-analysis` 例外，要么完成正式的后续任务登记。
- 所有计划文档不再把已完成工作写成“未开始”或“未发布”。
- PR6 的选择被记录为“保持现状”或新的后续计划。
- 全量主机和插件门禁通过，工作树干净。

## 执行记录

| 日期 | 阶段 | 结果 |
| --- | --- | --- |
| 2026-10-23 | C0 | drone-plugins `main=b6bc98d`；Drone `main=43ab8fdc`（合并 `codex/pr5-public-receipt`，文档同步提交 `b33ad60a`）；`plugins.lock.json` 已改为锁定 `b6bc98d7d0ac99461ae3249fb0a47b713166d007`，pi-knowledge tarball SHA-256 保持 `dc46908138ea926b86991ecc5f17892e34c65b0b1156741d6063d80ab0303fca`；发布证据已改为两个 `main` head。插件仓库 `npm run check` 通过；宿主 `npm run lint`、`npm run typecheck`、`npm test`（159 文件/820 测试）、`npm run build`、`npm run check:arch` 和 `npm run check:plugin-api -- --migration --lifecycle` 均通过。 |
| 2026-10-23 | C1 | 合并后的 `0.33.4` unsigned macOS arm64 安装包 `app.asar` SHA-256=`a19aacaef58dccdd8a70e8eb29034bf0d1ae0254b5f73af42105a710aa2ae5ec`；非 `@gyoungwe` `drone-t3-ui-fixture@0.0.1` 通过 npm tarball（SHA-256=`4071a41f0d3b7bf7b48aa9ead844f42c7a12374134db4957f63cfe47d3a1ff92`）安装到 `<agentDir>/npm/node_modules`。真实 UI 回读 PASS：`T3 Knowledge`、`T3 Home`、`T3 Skills`；停用后三者均消失，默认知识库页签保留且首页/技能页无空壳。详见 `v3-evidence.md` 与 release evidence JSON。 |

