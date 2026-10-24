# Research / pi-research / Zotero 迁移状态

> 2026-10-24：用户已授权跨包迁移。本轮将研究核心移入外部插件；源码迁移不再以缺范围授权标记 BLOCKED。真实账户验收与源码门禁分别记录。

## 当前所有权

- `drone-plugins/packages/pi-research@0.2.0` 拥有完整 evidence gate、research loop、claim binding、receipt journal、source archive、provenance、机构访问与 Zotero 领域算法。原生 Pi 与 Desktop 使用同一核心；Desktop 经公开 `/host` 注入 workspace、project、Vault 和调度端口。
- Drone 已删除 `packages/pi-research/`、23 个原研究领域模块与 `research-host-entry.ts`。`scripts/build-pi-research.mjs` 验证 `plugins.lock.json` 对应产物，不再构建隐藏的宿主副本。
- `@drone/research` 剩余 connector/shared/write contracts、capability discovery 和 run-summary 知识桥；Desktop 扩展保留宿主授权、Vault、进程和项目组合逻辑。不是所有名含 research 的宿主代码都已移走。
- 原研究包 Git 历史经 subtree split 保留在插件 Git 祖先中，原提交与迁移路径见插件 `migration-sources.json`。
- `0.2.0` 是本轮源码/tarball 版本，尚未发布 npm；已发布 `0.1.1` 的历史证据不能替代本轮验收。

## 修复与验证口径

旧插件切片的内存状态机允许空 `claim_bindings` 后 finalize；之前的 smoke PASS 不能证明研究证据完整性。本轮删除简化状态机，恢复完整持久化核心。真实 SDK 在 Pi `1.1.0` / `1.4.0` 上验证空引用拒绝、同 cwd 会话隔离、两源阅读、带引用答案与候选笔记写后回读。模型为离线 faux provider，工具 dispatch 与会话生命周期是真实 SDK。

插件回归覆盖归档校验、伪 source refs 拒绝、claim、恢复、Zotero 身份/幂等算法，以及独立 event bus 使用相同 cwd/sessionId/toolCallId 时不串回执、关闭一个会话不清理另一会话待完成回执。双仓库干净目录完整门禁均 PASS（宿主 lint/typecheck/test/build/check:arch，插件 npm run check），固定远端 commit 的 tarball 哈希一致；宿主另通过 migration/lifecycle、锁定/latest 兼容、升级 fixture 与真实会话回执。汇总见 [研究边界证据](releases/research-boundary-acceptance-2026-10-24.json)。

## 仍未关闭的真实边界

| 项目 | 状态与下一步 |
| --- | --- |
| Zotero 本机真实写入/清理 | 待用户确认临时条目范围及 Zotero 本机授权；未改现有文献，未写入生产库 |
| Zotero 云端写入/身份冲突 | 缺隔离测试账户与授权凭据；模拟传输回归不替代真实 API 验收 |
| 独立科研扩展 | `pi-web-access` 原生 Pi 安装、升级、停用恢复、回滚、卸载与实际 PubMed 检索通过；另选 `@vaayne/pi-web-tools@0.1.1`，Node 26 真实沙箱禁网/Europe PMC 读取/恢复通过；原始 TS 安装入口、正式包及 GUI 仍未关闭，见[回执](releases/scientific-sandbox-acceptance-2026-10-24.json) |
| 正式沙箱运行时 | 已修复旧 Node 22 网络测试假阳性；无网络权限能力时拒绝启动。Node 26 的 8 项真实进程回归通过，正式 Electron Node 24 仍待升级运行时后验收 |
| 外部 MCP | Exa 公开 HTTP MCP 启用、停用拒绝、恢复检索通过；不是用户自有认证服务 |
| Protocols.io 写入 | 缺账户凭据和可核实的账户状态读回，保持未执行；官方接口与范围见 [外部验收](releases/scientific-external-acceptance-2026-10-24.md) |
| 正式安装包 GUI | 本次 macOS arm64 DMG 的真实应用启动、可见工作台、preload/IPC 和研究命令发现 PASS；完整研究流程 GUI 仍待重验，启动 smoke 不替代交互闭环 |

完整研究迁移验收仍为 **PARTIAL**：源码迁移与实际会话门禁独立交付，剩余真实账户/安装包边界不能用 fixture 或旧证据关闭。
