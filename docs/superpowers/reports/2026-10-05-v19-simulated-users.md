# Drone v0.19.0 模拟用户测试报告

日期：2026-10-05  
被测 tag：`v0.19.0`（合并提交 `44f1f0d`）  
对比基线：`v0.18.0`（`a5ba4b8`）  
测试分支：`codex/sim-v19`

## 1. 一页结论

v0.19.0 的 Release macOS arm64 安装包可以冷启动；“关于”页显示 `0.19.0`，包内 `research-workbench/extensions/knowledge-extension.mjs` 与 v0.19.0 tag 中的文件 SHA-256 都是 `897477b8e57148f2afc2238a176de01f9a5e234d1980295c7ec18eeda5a4ba92`。开发态首个可输入页面为 6.06 秒，Release 包为 3.37 秒。首屏、模型设置、权限设置、响应式布局和错误中止路径可用。

核心聊天可以完成一次研究型任务：P1 在用户手动点击一次“同意本次请求”后完成交付，授权后没有再次追问。P4 的 25 轮会话、`/compact`、`@` 入口和应用内撤销确认框均可见；trace 中记录到 55 个 `harness_unit`。

验收结论为“可运行，但不能宣称 v0.19.0 全部通过”：有 **2 个阻断问题**。其一，切换/重载会话后 harness 扩展捕获的 context 变陈旧，guard、projection、delivery 和 context-evaporation 连续失败；其二，任务面板读取决策账本时出现 `Decision project does not match inquiry project`，使本测试项目无法完成撤销决策到发布门禁的闭环。P2 的实际 Wiki proposal 以及 P3 的真实产物篡改审稿卡未能在本轮完成，因此不能把这两项记作通过。

所有测试都使用 `/tmp/drone-v19-sim/` 下的项目、Vault、开发态 agent 目录和 userData；未读写正式 `~/.pi/agent/`。原始截图、JSON、日志和 trace 均在该目录，未提交仓库。

## 2. 问题表

| 编号 | 严重度 | 维度 | 复现步骤与观察 | 截图/原始证据 | 疑似模块 |
|---|---|---|---|---|---|
| B-01 | 阻断 | 功能/体验 | 开发态启动后连续新建会话，或执行会话切换/重载；随后运行 P4 的 compaction/harness 流程。主进程记录 `This extension ctx is stale after session replacement or reload`，随后 harness guard、projection、delivery、evaporation 都失败。 | `/tmp/drone-v19-sim/out/p4/2-harness-recall-and-trace-unit.png`；`/tmp/drone-v19-sim/userData-dev-dev/logs/main-2026-10-05.log` | `packages/extensions` harness/context-evaporation 生命周期接线 |
| B-02 | 阻断 | 功能 | 绑定 `/tmp/drone-v19-sim/project` 后打开“任务”面板。决策小节加载失败，主进程报 `Decision project does not match inquiry project`；无法在 UI 中完成“撤销一条 → artifact-pending-review → 发布拦截 → 确认放行”。 | `/tmp/drone-v19-sim/out/p4/4-decision-ledger-and-revoke-dialog.png`；同一主进程日志 | inquiry/decision scope 与项目 identity 传递 |
| G-01 | 一般 | 体验 | 打开“设置 → 局域网观察”。本轮页面能打开，但没有明确的“只读/无写操作入口”提示文本；脚本 `readOnlyHint=false`。 | `/tmp/drone-v19-sim/out/p5/4-lan-observer-read-only.png` | LAN observer 设置页文案 |
| G-02 | 一般（未完成验收） | 功能 | P3 可打开分析示例、产物面板和无计算主机空态，但在真实 Agent 回合结束前没有生成图和数字结论，所以未观察到 `figure-code-mismatch` / `untraceable-number` 审稿卡。 | `/tmp/drone-v19-sim/out/p3/4-mismatch-review-cards.png`；`/tmp/drone-v19-sim/out/p3.json` | C1/C3 产物 provenance 与 reviewer 卡的端到端触发路径 |
| G-03 | 一般（未完成验收） | 功能 | P2 能打开研究、知识库和话题入口，但 DOI 发送步骤被已有会话状态提前匹配，未形成可核验的两条 Wiki proposal；因此 automatic/manual 两种模式的 pending 对比没有被本轮端到端确认。 | `/tmp/drone-v19-sim/out/p2/4-doi-archive-ui-flow.png`、`/tmp/drone-v19-sim/out/p2/5-automatic-and-manual-pending-observation.png` | research route 与 Wiki review 状态机 |
| R-01 | 基线问题（非 v0.19.0 新问题） | 功能/性能 | 同一脚本跑 v0.18.0 时，多次创建会话触发 `npm install @eko24ive/pi-ask` / `pi-mcp-extension@1.5.0` code 190/254；v0.19.0 未出现该安装失败。 | `/tmp/drone-v19-sim/out-v18/p1/4-launch-and-single-authorization.png`；v0.18 主进程日志 | v0.18 扩展依赖安装与临时 npm 目录 |

## 3. 性能与回归

数值来自同一 CDP 脚本的 `Performance.getMetrics`。百分比为 `(v0.19.0 - v0.18.0) / v0.18.0`；脚本耗时含 UI 等待和超时，适合回归方向判断，不等同于纯模型基准。

| 指标 | v0.18.0 | v0.19.0 | 变化 |
|---|---:|---:|---:|
| 开发态冷启动到可输入 | 未单独记录 | 6.06 s | — |
| Release 包冷启动到可输入 | — | 3.37 s | — |
| P1 场景总耗时 | 122.77 s | 122.14 s | -0.5% |
| P1 `TaskDuration` 增量 | 21.267 s | 15.774 s | -25.8% |
| P1 `LayoutDuration` 增量 | 58.7 ms | 53.9 ms | -8.2% |
| P1 结束 JS heap | 23.46 MB | 25.85 MB | +10.2% |
| P2 场景总耗时 | 1.56 s | 1.05 s | -33.1% |
| P3 场景总耗时 | 1.04 s | 0.95 s | -8.1% |
| P4 场景总耗时 | 6.15 s | 35.61 s | +479.0% |
| P4 `TaskDuration` 增量 | 0.295 s | 10.172 s | +3353% |
| P4 `LayoutDuration` 增量 | 17.3 ms | 281.2 ms | +1526% |
| P4 结束 JS heap | 19.57 MB | 40.09 MB | +104.8% |
| P4 结束 DOM nodes | 864 | 3,557 | +311.7% |
| P4 trace 总大小 | 1.68 MiB | 1.78 MiB | +6.0% |
| trace 中 `harness_unit` | 0 | 55 | — |
| P5 场景总耗时 | 6.88 s | 2.45 s | -64.4% |

P4 的耗时、长任务和内存增长需要优先复测：v0.19.0 同时完成了 25 轮 UI 交互和 harness 记录，不能把增量全部归因给单一模块，但它已经超过普通页面切换的体验阈值。v0.19.0 的 renderer heartbeat 为 145–287 MB，结束值 243 MB；对应 v0.18.0 为 179–291 MB，结束值 226 MB。

CDP 页面审计没有发现可见字号低于 11 px，也没有发现可见的原始 i18n key。结构性滚动容器审计在 v0.19.0 首尾各返回 20 个候选溢出节点，需要结合截图逐项收敛；本报告没有把它们全部升级为产品缺陷。

## 4. 五组模拟用户结果

### P1 新手研究生

- 通过：首屏、设置中 DeepSeek 已配置、`/` 与 `@` 入口、内置“文献”示例表单、中文/English 页面审计。
- 通过：用户手动完成一次“同意本次请求”后，任务写出两份交付文件并结束；授权后额外追问次数为 0。
- 初始脚本把 ask-user 卡片误当成 permission 卡而超时；手动按真实用户路径继续后完成，原始截图保留该状态，不能把脚本的两步 false negative 误报为产品失败。

### P2 文献综述者

- 通过：研究视图、知识视图、搜索/话题入口、Wiki 审核入口、Zotero 未运行时的降级路径可见。
- 未完成：两篇 DOI 的真实归档、阅读、Vault 笔记、Wiki 一条批准和一条拒绝；automatic/manual pending 对比未达到可核验状态。命中不等于已读的 UI 文案没有被端到端任务结果验证。

### P3 数据分析

- 通过：分析示例表单、产物面板入口、计算面板无远程主机空态；主回合不会因审稿卡入口而被 UI 阻塞。
- 未完成：没有生成可篡改的真实图与数字结论，因此两类审稿卡和父链/代码指纹的真实篡改检测未验收。

### P4 长会话重度用户

- 通过：25 轮 UI 交互、一次 `/compact` 请求、`@` 子代理入口、应用内 `[role=dialog]` 撤销确认框；未见原生系统弹窗。
- 部分通过：trace 有 55 个 `harness_unit`，但复述检查中 `harness_recall` 文本可能来自测试输入回显；同时 B-01 的 stale context 日志使 C4 不能判通过。
- 失败：决策账本闭环被 B-02 阻断。`DRONE_HARNESS_DISABLE=familyPrompt,guard` 的重启只记录了可重跑计划，本轮没有把它当作通过证据。

### P5 设置与异常

- 通过：权限规则编辑、试算、保存、自保护规则可见；停止生成、错误/恢复文案；1024×700 与 1920×1080 的亮暗截图。
- 部分通过：局域网观察页能打开，但没有清晰的只读提示；401/429 伪 provider smoke 两版均通过，未改产品代码。

## 5. 费用与 token

测试预算上限：2,000,000 tokens、5.00 USD。使用隔离 `agent-dev` 中已缓存的 DeepSeek V4 系列模型；报告不记录任何凭证。

| 版本 | 计费 token 总数 | SDK 费用 | 有计费的会话 |
|---|---:|---:|---:|
| v0.18.0 | 1,395,853 | $0.095033124 | 1 |
| v0.19.0 | 1,055,165 | $0.088574844 | 3 |

v0.19.0 实际合计约占 token 上限 52.8%、费用上限 1.8%。P1 完整任务约 516,980 tokens / $0.042934296；P4 长会话约 259,011 tokens / $0.016827540。P2/P3/P5 的脚本未达到真实模型回合完成条件，没有把 UI 预检查误计入模型费用。

## 6. 可复现入口与原始产物

- 测试脚本：`scripts/sim-v19/common.mjs`、`p1.mjs`、`p2.mjs`、`p3.mjs`、`p4.mjs`、`p5.mjs`。
- v0.19.0 原始产物：`/tmp/drone-v19-sim/out/`。
- v0.18.0 原始产物：`/tmp/drone-v19-sim/out-v18/`。
- Release DMG、冷启动 CDP JSON、截图和日志：`/tmp/drone-v19-sim/out/release/`。
- 开发态构建：v0.19.0 与 v0.18.0 均执行 `npm ci`、`npm run build` 成功；Release 包检查未修改产品文件。

