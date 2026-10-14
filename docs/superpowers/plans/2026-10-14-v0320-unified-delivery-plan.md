# v0.32.0 统一交付总计划

**基线**：Drone v0.32.0，提交 022d0eac1d585ed295e09deb22b18de2ed13ef16
**本地实施目录**：/Users/gaoyangwei/Documents/ChatGPT/Drone/.integration-v0320
**集成分支**：codex/v0320-self-integration
**目标**：在不触碰主仓库用户改动的前提下，把三个 worktree 的可验证计划和已经完成的代码收敛为一个可测试、可审阅的交付。

## 1. 三个 worktree 的来源和结论

### UI worktree

来源：
- /Users/gaoyangwei/.codex/worktrees/ui-overhaul-v0320/Drone
- 分支 codex/ui-overhaul-v0320
- 计划提交 16fe6890
- UI 行为改动在该 worktree 中仍有未提交修改；已由集成提交 ccc1bd15 带入集成目录

责任范围：
- 设置弹窗窄窗口、滚动和焦点回收
- ContextPanel 的 tab、tabpanel、aria-controls、方向键、Home/End
- Dropdown、Switch、Tooltip、IconButton 的反馈和 reduced-motion
- 任务、变更、文件、产物的摘要和跳转层级
- 中英文文案与 UI 索引同步

### ClawsGO worktree

来源：
- /Users/gaoyangwei/.codex/worktrees/clawgo-v0320-audit/Drone
- 分支 codex/clawgo-v0320-followup
- 提交 88f51d86
- 这是文档和证据边界工作，不应把外部会话、凭据、Vault 正文或 results 复制进仓库

责任范围：
- v0.32.0 基线和 CD-Search 证据链说明
- verified、observed、cross-species、inferred、unknown 的边界
- P2/P3/P5 实验前置门禁
- 下一批可执行的最小交付和复核标准

### v0320 follow-up integration worktree

来源：
- /Users/gaoyangwei/.codex/worktrees/v0320-followup-integration/Drone
- detached at v0.32.0
- 作为干净基线和集成参照，不直接承载未审阅修改

集成目标：
- /Users/gaoyangwei/Documents/ChatGPT/Drone/.integration-v0320
- 分支 codex/v0320-self-integration
- 集成提交 ccc1bd15 已包含 UI、RunAttempt 因果链、两份专项计划和索引改动

## 2. 当前真实状态

截至 2026-10-14，门禁执行结果见第 5 节；本节中的“仍需完成”是实施前清单，已在本轮完成并逐项核验。

### 已进入集成分支

- UI P0/P1 行为改动和 UI 设计说明
- shared CausalEnvelope、ID 校验、hash 排除和兼容类型
- analysis task/controller、compute binding、receipt、direct runner 的 lineage 传播
- intent journal 的 start/end/output 因果事件
- backend causality projection 及相关测试
- ClawsGO follow-up 计划
- 本统一计划的早期版本和 docs/INDEX.md 导航

### 仍需完成

- 重新核对 UI 代码与实际测试，不以旧计划中的测试数字作为当前事实
- C1-5/C1-6 的旧记录 partial/legacy 语义、crash/restart、unknown reconcile、retry/branch、hash/capsule 回归
- 检查 lineage 是否意外进入业务 hash、授权判断或 checkpoint ID
- 重新生成并核对 .pi runtime 和 build manifest；不得接受由不同分支或不同构建输入产生的巨大漂移
- 更新 docs/INDEX.md、docs/architecture-v2-tasks.md 和本计划的完成状态
- 运行 lint、typecheck、test、build、check:arch 和 upgrade fixtures
- 保存失败的完整命令、退出码和环境原因，区分源码失败与端口、watcher、网络、生成物失败

## 3. 实施顺序

### S0：保护边界

1. 只在 .integration-v0320 修改。
2. 不对主仓库执行 reset、clean、stash、checkout 或覆盖。
3. 不改动三个原始 worktree 的未提交内容。
4. 不提交凭据、会话正文、Vault 正文、results、外部 ClawsGO 原始文件或本机私有状态。
5. 每个阶段记录 git status、HEAD、变更摘要和测试结果。

### S1：计划和架构一致性

1. 以本文件作为统一交付入口。
2. 保留 UI 设计文档、RunAttempt 因果设计和 ClawsGO follow-up 作为专项依据。
3. docs/INDEX.md 只指向当前仍存在的文件和职责。
4. architecture-v2-tasks.md 中把 causality projection、旧记录兼容和回归门禁标成实际状态。
5. 任何“已完成”都必须有当前分支的代码、测试或文件证据。

### S2：UI P0/P1 验证和修复

1. 检查 SettingsDialog 的窄窗口布局、Escape 和焦点回收。
2. 检查 ContextPanel tab 关系、键盘导航、插件页签和内容面板关联。
3. 检查 Dropdown、Switch、Tooltip、IconButton 的 ARIA、过渡范围和 reduced-motion。
4. 检查任务、变更、文件、产物卡的摘要、空态、错误态、长路径和返回入口。
5. 检查 375、768、1024、1440 宽度和中英文长文案。
6. 运行 desktop 相关测试、typecheck、lint 和 UI 冒烟；失败时先修实现，再更新计划。

### S3：C1 RunAttempt / causation lineage 收尾

1. 验证 CausalEnvelope 仅作为 additive metadata，不改变研究合同、proposal、decision 或 checkpoint 的业务 hash。
2. 验证同一 attempt 的 readiness、submit、reconcile、review、checkpoint 使用同一 runAttemptId。
3. 验证 unknown 只 reconcile，不自动产生重复副作用；安全重试才创建带 parentRefs 的子 attempt。
4. 验证 intent journal 的 start 在 effect 前落盘，end/output 指向直接 causationId。
5. 验证 replay、branch 和 fork 不继承 execution binding、approval 或 review。
6. 为旧 receipt、intent、checkpoint 和 RunAttempt 缺失 lineage 的情况保留 partial/legacy，不按时间或文件名推断关系。
7. 若不需要 renderer 展示完整图谱，保持当前脱敏 projection 范围，不新增 IPC。
8. 补齐 crash/restart、unknown reconcile、duplicate submit、remote ID recovery、retry/branch、hash 和 capsule import/replay 测试。

### S4：生成物和发布输入

1. 按仓库脚本重建 extensions、knowledge、tasks、research runtime。
2. 检查 build manifest 的输入哈希和实际生成文件一致。
3. 运行 check-build-inputs、check-extensions、check-knowledge-runtime、check-research-runtime、check-tasks-runtime。
4. 生成物变化必须能由当前源文件和脚本解释；无法解释的删除或大规模漂移先停止并定位。

### S5：ClawsGO Science 文档交付

1. 保留直接证据、跨物种支持、待核实线索和未知四层边界。
2. 不把 UI 的 6/6 或交付卡当作科学结论。
3. 保留前台轮询超时与服务端成功完成的区别。
4. 只登记外部证据的相对路径、哈希、作业 ID、时间、脚本版本和 omission 清单。
5. 输出下一批最小交付：evidence capsule manifest、检索空白表、可复用 cdsid 的重跑 attempt、P2/P3/P5 确认表。
6. 未确认实验门禁前，不写入“已完成实验”“已证明通过剪接”或“可直接执行 T1”。

### S6：完整门禁和审阅包

按顺序运行：

1. npm run lint
2. npm run typecheck
3. npm test
4. npm run build
5. npm run check:arch
6. npm run test:upgrade
7. 相关 desktop、backend、compute、shared 定向测试和 UI 冒烟

每个命令记录：
- commit 和工作树路径
- 实际命令
- 退出码
- 通过数量或失败摘要
- 是否为源码问题、生成物问题或环境问题

## 4. 完成判定

只有同时满足以下条件才标记完成：

- 主仓库用户改动仍在，未被覆盖。
- 三个 worktree 的计划都有对应文档或代码证据。
- UI P0/P1 和 C1 回归测试在当前集成分支通过。
- runtime 生成物可由当前源文件重建，manifest 一致。
- docs/INDEX.md 和 architecture-v2-tasks.md 与实际职责一致。
- 完整门禁通过，或所有失败都有可复核的环境证据。
- 只读审阅包可说明哪些已实现、哪些仍是后续工作。

本阶段只完成本地集成、修复和验证；是否推送、创建或合并 PR，放在门禁完成后单独处理。


## 5. 本轮实施与门禁记录（2026-10-14）

实施目录保持为 `/Users/gaoyangwei/Documents/ChatGPT/Drone/.integration-v0320`，主仓库和三个原始 worktree 均未执行 reset、clean、stash、checkout 或覆盖操作。当前集成分支仍为 `codex/v0320-self-integration`。

已完成的修复和收敛：

- 修正 LAN ChatView 只读/远程控制测试对系统语言的隐含假设；断言改为使用当前 i18n 文案，中文 macOS 与英文环境均验证通过。
- 按 `build:research` 重建 research runtime；此前 stale 的 `source-archive-core.mjs`、`research-run-summary.mjs`、`zotero-write.mjs` 和 manifest 已与当前源文件一致。
- 保留 lineage 作为 additive metadata；checkpoint identity 的回归测试确认加入 lineage 不改变业务 checkpoint ID。
- `docs/architecture-v2-tasks.md` 已将 C1-6 标为完成，并保留“统一提交后的远程 CI 复核”作为后续发布动作；ClawsGO 专项计划已链接到本总计划。

门禁结果：

| 门禁 | 结果 |
|---|---|
| `npm run lint` | 通过；仅有 3 条已有 CSS specificity warning，无 error |
| `npm run typecheck` | 通过（所有 workspace 与 Pi 检查） |
| `npm test` | 通过；所有 workspace 测试及根级 upgrade/build-input Node tests 通过 |
| `npm run build` | 通过；LAN web、Electron main/preload/renderer 均成功构建 |
| `npm run check:arch` | 通过，0 baseline finding |
| `npm run test:upgrade` | 通过；orchestration-stress、hybrid-fixture、packaged-resources 全部通过 |
| `npm run check:extensions` | 通过，12 个 source/output mapping，0 preserved legacy artifact |
| `npm run check:knowledge-runtime` | 通过，artifacts up to date |
| `npm run check:research-runtime` | 通过，artifacts up to date |
| `npm run check:tasks-runtime` | 通过，runtime 与 compatibility artifacts up to date |
| LAN ChatView 定向测试 | 通过，2/2 |

当前剩余工作是发布前审阅：检查生成物大 diff 是否全部由本次构建输入解释、审阅集成目录中的 docs/analysis 变更，然后在用户要求的情况下创建本地提交或 PR。本轮不自动推送、不自动合并 PR。


## 6. UI 研究升级对齐审查（2026-10-14）

### Worktree 收口

- `ui-overhaul-v0320` 的组件、交互、文案和状态改动已经在当前 integration 分支；它相对 integration 唯一保留的源码差异是 `globals.css`，对应用户已确认的方案 A 视觉层。`docs/INDEX.md` 的 UI 计划索引也已经同步，因此不再 cherry-pick 该 worktree 的旧副本。
- `run-attempt-lineage` 的未提交内容是已集成 C1 实现的旧副本、格式差异和文档勾选差异；当前 integration 的 `analysis-evidence.ts` 还包含更完整的 checkpoint hash 处理（排除顶层及 `analysis.provenance` 内的 lineage，并导出 `checkpointId`）。不回灌旧副本。
- ClawsGO worktree 仍是科学证据计划，和 UI 提交保持职责分离；它的后续计算、证据整理和实验确认不属于本轮 UI 交付。

### 方案 A 与既定 UI 计划的冲突处理

- 原 UI 调查计划的设计系统段落以“中性浅色、科研工作台、不引入装饰性风格”为基线；用户随后确认的方案 A 是石墨/深海军蓝的研究控制室，并使用分层卡片、状态色和轻量阴影。这是一个明确的视觉基线变化，已按用户选择由方案 A 覆盖深色主题方向。
- 该变化只落在 desktop/LAN 的 CSS token、状态层、面板层和卡片层，没有改变组件行为、ARIA、键盘路径、IPC、后端事件、权限、模型路由或分析流程；浅色主题保留原有行为和可用性约束。
- P2 的 token、圆角、阴影和密度收敛已完成“方案 A 首轮”这一子集，不能据此宣称知识图谱、子智能体、高级设置、四档截图验收或 Worst-case/1000 rows 夹具全部完成。

### 仍需单独追踪

- UI：在 375/768/1024/1440 记录三条垂直路径的视觉证据，并补齐极端数据夹具与剩余 P2 细节。
- 非 UI：RunAttempt 的远程 CI/发布前复核和 ClawsGO 的科学证据后续仍按各自计划推进，不并入 UI commit。

这份对齐记录只更新集成审阅依据，不改变 UI-only 范围，也不把未完成的后续批次标记为已完成。


## 7. UI 批次实施完成记录（2026-10-14）

用户确认的方案 A 已在当前 integration 分支完成 UI-only 收口：

| 批次 | 实施结果 | 证据 |
| --- | --- | --- |
| P0 | 已完成并保持原有窄屏、焦点、Escape、ARIA、状态层级契约 | 既有 UI 定向测试 + 当前类型检查 |
| P1 | 已完成并保持 Composer、选择器、文件预览、长内容与列表限制边界 | 既有 workspace 测试 + 当前桌面定向测试 |
| P2 token / surface | 已完成方案 A 的 token、面板、卡片、状态、空态、运行条和图谱视觉收口 | `globals.css` / `shell.css` 与组件定向审查 |
| P2 graph / subagents / settings | 已完成键盘、ARIA、live region、聚焦态、筛选、回放关系和设置导航循环 | `knowledge-graph.test.ts`、`subagents-pane.test.tsx`、`FirstRunGuide.test.tsx` |
| P2 worst-case | 已完成知识图谱大图与子智能体空 / 单条 / 1000 条夹具；子智能体面板最多渲染 100 条并显示隐藏数量 | 当前定向测试 15 tests passed |

本记录只覆盖 UI 项目批次；RunAttempt 远程 CI、ClawsGO 科学证据和发布生成物仍按各自计划独立推进。完整门禁在本记录之后执行，门禁结果以实际命令退出码为准。
