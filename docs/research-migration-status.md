# Research / pi-research / Zotero 迁移状态

> **2026-10-26 当前状态**：研究核心迁移、本地 GUI、公开包和有限在线复核已完成；云端账户与其他平台保持未完成，见[阶段汇总与恢复配置](plan-final-status-2026-10-26.md)。当前 suite 为 0.1.11；下方 2026-10-25 发布记录为历史快照。

> **2026-10-25 npm 发布更新**：`pi-knowledge@0.2.1`、`pi-research@0.2.0`、`research-suite@0.1.10` 已公开，tarball 完整性与候选包一致。基于两仓库 main 的独立发布工作区；验证范围与回执见 [本次发布记录](releases/knowledge-research-npm-2026-10-25.md)。研究迁移总体保持 PARTIAL，其他未完成项不变。

> 2026-10-24：用户已授权跨包迁移。本轮将研究核心移入外部插件；源码迁移不再以缺范围授权标记 BLOCKED。真实账户验收与源码门禁分别记录。

两仓库 `codex/research-boundary-acceptance` 已快进合入各自 `main`：宿主源码基线 `c14f3154`，插件 `ff1d659`。合并与门禁证据见[本轮汇总](releases/research-boundary-acceptance-2026-10-24.json)的 `mainIntegration`；该历史合并不改变当时未完成项或 npm 未发布状态；当前发布结果见顶部记录。

2026-10-25，研究 GUI 修复分支已快进合入 Drone `main=fe41db7e`，合并后完整门禁通过；插件仍为 `ff1d659`。见[GUI 合并证据](releases/research-workflow-gui-acceptance-2026-10-24.json)的 `mainIntegration`。该历史合并不改变当时的 OPEN / PARTIAL 与未发布状态。

2026-10-25，后续 `codex/knowledge-category-fix` 已修复并完成正式包分类验收；宿主源码 `e38312a9`、插件源码 `831e399`，双仓库门禁通过，已快进合入 main（Drone `a853230e` / drone-plugins `c43f7b4`），合并后双仓库完整门禁通过；机器回执见分类证据 `mainIntegration`。详见[分类证据](pluginization/knowledge-category-fix-evidence.md)。分类修复时三个版本尚未发布；当前发布结果见顶部记录。

## 当前所有权

- `drone-plugins/packages/pi-research@0.2.0` 拥有完整 evidence gate、research loop、claim binding、receipt journal、source archive、provenance、机构访问与 Zotero 领域算法。原生 Pi 与 Desktop 使用同一核心；Desktop 经公开 `/host` 注入 workspace、project、Vault 和调度端口。
- Drone 已删除 `packages/pi-research/`、23 个原研究领域模块与 `research-host-entry.ts`。`scripts/build-pi-research.mjs` 验证 `plugins.lock.json` 对应产物，不再构建隐藏的宿主副本。
- `@drone/research` 剩余 connector/shared/write contracts、capability discovery 和 run-summary 知识桥；Desktop 扩展保留宿主授权、Vault、进程和项目组合逻辑。不是所有名含 research 的宿主代码都已移走。
- 原研究包 Git 历史经 subtree split 保留在插件 Git 祖先中，原提交与迁移路径见插件 `migration-sources.json`。
- `0.2.0` 已公开 npm，并与宿主锁定 tarball 字节一致；发布后验收见顶部记录，`0.1.1` 证据仅保留历史含义。

## 修复与验证口径

旧插件切片的内存状态机允许空 `claim_bindings` 后 finalize；之前的 smoke PASS 不能证明研究证据完整性。本轮删除简化状态机，恢复完整持久化核心。真实 SDK 在 Pi `1.1.0` / `1.4.0` 上验证空引用拒绝、同 cwd 会话隔离、两源阅读、带引用答案与候选笔记写后回读。模型为离线 faux provider，工具 dispatch 与会话生命周期是真实 SDK。

插件回归覆盖归档校验、伪 source refs 拒绝、claim、恢复、Zotero 身份/幂等算法，以及独立 event bus 使用相同 cwd/sessionId/toolCallId 时不串回执、关闭一个会话不清理另一会话待完成回执。双仓库干净目录完整门禁均 PASS（宿主 lint/typecheck/test/build/check:arch，插件 npm run check），固定远端 commit 的 tarball 哈希一致；宿主另通过 migration/lifecycle、锁定/latest 兼容、升级 fixture 与真实会话回执。汇总见 [研究边界证据](releases/research-boundary-acceptance-2026-10-24.json)。

## 仍未关闭的真实边界

| 项目 | 状态与下一步 |
| --- | --- |
| Zotero 本机真实写入/清理 | **PASS（经恢复清理）**：用户明确授权后，真实 Pi 会话调用安装包保存工具创建 1 条临时条目；唯一标记/DOI/标签回读一致，删除 204，按 key 查询 404、标记查询 0。Zotero 标题大小写规范化导致首轮脚本失败，修正核对后清理同一条目，未二次创建、未改已有文献。见[真实回执](releases/zotero-local-roundtrip-2026-10-24.json) |
| Zotero 云端写入/身份冲突 | 缺隔离测试账户与授权凭据；模拟传输回归不替代真实 API 验收 |
| 独立科研扩展 | **PASS（macOS arm64 工具扩展）**：`@vaayne/pi-web-tools@0.1.1` 原始 TS 包经最终安装包 Pi CLI 干净安装，GUI 显示 2 工具；联网拒绝、真实 Europe PMC 读取、包过滤停用/重启恢复与重新授权通过。安装/启停操作口径和边界见[正式沙箱证据](pluginization/packaged-plugin-sandbox-evidence.md)。此前 `pi-web-access` 的原生 Pi 升级/回滚证据保持历史含义 |
| 正式沙箱运行时 | **PASS（工具代理切片）**：正式包携带 Node 26.12.1，Electron Node 24 不执行第三方插件；加载前隔离、真实可达端点禁网、独立 PID 与退出回收通过。Node permission model 不等于恶意代码的 OS 级安全沙箱 |
| 外部 MCP | Exa 公开 HTTP MCP 启用、停用拒绝、恢复检索通过；不是用户自有认证服务 |
| Protocols.io 写入 | 缺账户凭据和可核实的账户状态读回，保持未执行；官方接口与范围见 [外部验收](releases/scientific-external-acceptance-2026-10-24.md) |
| 正式安装包 GUI | **PASS（本地两源研究闭环）**：迁移后正式 DMG 完成绑定/授权、本地检索、真实下载/逐行读取、空引用拒绝、绑定/草稿/总结、GUI 引用阅读、重启新会话接续和 stale/恢复。脚本模型不替代科学验证；见[本轮 GUI 证据](pluginization/research-workflow-gui-evidence.md) |
| 知识概览分类 | **PASS（RESEARCH-GUI-CATEGORY，macOS arm64）**：显式类型/目录优先于文件名；同一既有隔离库由方法 0 变为方法 1，软件页排除该笔记，阅读器与重启通过，23 个 Markdown 哈希不变。见[分类证据](pluginization/knowledge-category-fix-evidence.md) |

完整研究迁移验收仍为 **PARTIAL**：源码迁移与实际会话门禁独立交付，本地安装包研究闭环已通过，npm 发布已完成，但云端账户和其他平台边界不能用 fixture 或旧证据关闭。
