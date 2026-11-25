@AGENTS.md

## Claude Code 接手说明

- 进度：以 [P0–P7 计划](docs/pluginization/native-plugin-implementation-plan.md)的“当前阶段状态”和“当前未完成项”为准。P4 已完成（见 `docs/handoff-2026-10-29-p4.md` 顶部）；P5 运行时接线看 `docs/pluginization/p5-runtime-wiring.md`。不要按旧交接文档里的“下一步”开工。
- 插件仓库在 `../drone-plugins`（Gyoungwe/drone-plugins 的主 checkout）。宿主取包只认 `plugins.lock.json` 锁定的远端 commit 与 tarball 哈希：插件改动先合入插件仓，再单独开 PR 重锁。
- 本仓 hooks：`.claude/hooks/stop-check.mjs`（防膨胀 + 差异 lint/结构/typecheck）。权限红线、检查命令输出阶梯和按路径注入规则由 Jev 插件提供（`jev@drone-development`，用户级安装，Drone 规则包按 `package.json` 名称自动启用）；被折叠的完整输出用插件的 `jev.mjs show <id> --grep '<regex>'` 取回。
- 授权：CI（macOS/Linux）全绿后可以合并 PR 到 main；Windows job 在 main 上本来就失败，可忽略。
- GitHub：`gh` 的 GraphQL 在部分环境会 403，失败时改用 REST（`gh api repos/Gyoungwe/<repo>/pulls ...`）。
- 网络：npm 要走代理（绕过 no_proxy）；Node 的 fetch 需设置 `NODE_USE_ENV_PROXY=1`。
- 受管插件：能力调用都在 hook/工具/命令内 `await`；SDK 运行期间不 `session.notify`，状态卡等 `agent_settled`。插件单元测试的假宿主要模拟这两条（`docs/PITFALLS.md`）。
