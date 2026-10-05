# Drone v0.19.1 模拟用户测试报告（T2）

日期：2026-10-06
测试分支：`codex/sim-v19`
被测 tag：`v0.19.1`，提交 `772bb5c9465a2e96412944124c7782108dfe38fa`
对比 tag：`v0.18.0`，提交 `a5ba4b88e136d7ed39e27db8e6fba3a9f2c1e442`
脚本最新提交：`ed9416c`

## 1. 结论

本轮不能作为验收通过证据。两个版本均完成源码构建；v0.19.1 Release macOS arm64 安装包完成冷启动，关于页显示 `0.19.1`，包内 `knowledge-extension.mjs` 与 v0.19.1 tag 构建产物 SHA-256 均为 `b55c9fff0cf2c45da2fb26370a76649aa413eb22a7295841cf82d3590089a880`。

正式 UI 重跑在 v0.19.1 上已经产生原始结果，但在 P2/P3/P5 之后累计 usage 为约 **2,894,993 tokens / $0.179047**，超过脚本预算上限 2,000,000 tokens；因此停止继续请求模型。v0.18.0 未完成同工作量正式重跑，未给出性能回归百分比。阻断验收问题数：**1（预算与工作量不满足，测试结论不可验收）**。产品问题列在下表，未修改产品代码。

## 2. 问题表

| 编号 | 严重度 | 维度 | 复现与证据 | 疑似模块 |
|---|---|---|---|---|
| T2-BUDGET | 阻断 | 性能/测试 | 正式运行累计约 2,894,993 tokens，超过 2,000,000 上限；见 `/tmp/drone-v19-sim/agent-v191/` 与各场景 JSON 的原始记录。 | 测试预算守卫；已在 `common.mjs` 增加运行前/步后预算检查 |
| T2-01 | 严重 | 功能/体验 | P3 固定 `plot_fixed.py` 成功生成 `figure.png`、`result.md`；产物区 `[data-testid="artifact-provenance-card"]` 数量为 0，篡改后 reviewer code 只有 `untraceable-number`，缺少 `figure-code-mismatch`。证据：`/tmp/drone-v19-sim/out-v191b-formal/p3.json`。 | inquiry artifact provenance、deliverable reviewer |
| T2-02 | 严重 | UI/体验 | LAN 页面 DOM 中 textarea=0、发送按钮=0，但写操作控件计数为 2，违反 G-01 的只读门槛。证据：`/tmp/drone-v19-sim/out-v191b-formal/p5.json` 的 `lan-observer-read-only-dom`。 | LAN observer web |
| T2-03 | 一般 | UI/稳定性 | P1 在已有长会话状态下出现 6 次 `Maximum update depth exceeded`，随后示例任务对话框无法打开/启动；证据：`/tmp/drone-v19-sim/out-v191-formal3/p1.json`。该次运行被状态污染，需在全新 userData 再确认。 | renderer session/task state |
| T2-04 | 一般 | 功能/测试 | P5 伪 provider 401/429 两次 `requestCount=0`、无 `.error-note`，说明 provider 替换没有命中真实请求，不能把该步骤计为通过。证据：`/tmp/drone-v19-sim/out-v191b-formal/p5.json`。 | model settings/provider routing 或测试替换入口 |
| T2-05 | 建议 | UI | P1 双语审计发现原始 key 字符串和 20 个溢出候选；脚本已逐候选截图，未把候选数直接计为缺陷。证据目录：`/tmp/drone-v19-sim/out-v191-formal3/p1/overflow-*.png`。 | i18n / layout |

## 3. 性能对比

没有满足两版本相同完成轮数和相同渲染消息数的运行，故不填回归百分比。P2、P3、P5 也不纳入性能表；P4 未在预算停止前完成两版本正式运行。

| 指标 | v0.18.0 | v0.19.1 | 变化 |
|---|---:|---:|---:|
| 冷启动到可输入 | 未正式重跑 | Release 冷启动通过；开发态首屏数据见场景 JSON | 未比较 |
| P4 完成轮数/渲染消息数 | 未完成 | 未完成 | 未比较 |
| 首 token 中位数（3 次） | 未完成 | 未完成 | 未比较 |
| renderer/main 内存、长任务、帧率、trace 大小 | 未完成 | 未完成 | 未比较 |

## 4. 用户场景结果

- **P1**：DeepSeek 设置行通过；Slash/@ 菜单在一次干净状态运行通过；示例任务在首次运行中触发了真实 ask-user 表单并最终生成两个文件，但修正版重跑受旧会话状态影响失败，不能计为通过。原始结果：`/tmp/drone-v19-sim/out-v191-formal3/p1.json`。
- **P2**：知识库初始化和 automatic/manual pending 闭环未完成。此前失败原因是脚本把多问题 `ask-dialog` 当成带固定文字的单选卡；已改为按具体 `section button` 逐题选择，并优先选择确认选项，修复提交 `ed9416c`，但预算停止前未重新消耗模型验证。
- **P3**：固定夹具和本地执行通过；来源卡与两类审稿卡未通过，不能计为通过。
- **P4**：v0.19.1 正式 25 轮、compaction、decision closure 和禁用重启未完成；不计通过，不与 v0.18.0 比较。
- **P5**：权限规则保存/试算、自保护规则、取消生成、四个视口/主题截图通过；401/429 替换和 LAN 只读未通过。

## 5. 脚本自检

1. `waitForIdle` 只有在先观察到运行事件后才允许 `settled=true`；旧消息卡不能制造假阳性，超时为失败。
2. P1 区分 `[data-testid="permission-allow-run"]`、`[data-testid="ask-simple"]` 和 `[data-testid="ask-dialog"]`，授权后再次 ask 会计入中断。
3. 多问题 ask 表单按每个 `section` 的具体按钮选择；确认类选项优先，避免误选“暂不授权”。
4. P4 口令只在 `.markdown-body` 助手节点中查找，用户 `.bg-bubble` 单独计数；trace 必须有真实 `harness_recall` 和 `harness_unit`。
5. P2 队列判断读取 `wiki-review-panel` 的总数、具体 aside 条目、选中预览和可用决策按钮，并比较目标文件 SHA-256；空态文案不能通过。
6. P3 只接受固定 fixture 文件、provenance DOM、两个 reviewer code 和主回合可输入的合取条件。
7. G-01 只检查 LAN DOM 中 textarea、发送按钮和写控件；不使用提示文字作为通过条件。
8. 所有步骤保留选择器、取值、耗时、截图、console error、unhandled rejection 和交互计数；`ok` 必须是严格 `true`。
9. `common.mjs` 现在扫描隔离 agent 的 message usage，在每一步前和步后检查 2,000,000 token / $5 上限；超过后后续步骤直接失败。
10. 溢出候选逐一截图；候选数不直接等同 UI 缺陷数。

## 6. 费用与原始产物

正式 v0.19.1 已记录约 **2,894,993 tokens / $0.179047**；没有在报告中写入任何 key。所有 Vault、项目、userData、截图、trace、JSON 均在 `/tmp/drone-v19-sim/`，未进入仓库。v0.18.0 仅完成 `npm ci`/build，未消耗模型请求。

主要结果：

- P1：`/tmp/drone-v19-sim/out-v191-formal3/p1.json`
- P2：`/tmp/drone-v19-sim/out-v191b-formal/p2.json`
- P3：`/tmp/drone-v19-sim/out-v191b-formal/p3.json`
- P5：`/tmp/drone-v19-sim/out-v191b-formal/p5.json`
- Release 冷启动 userData：`/tmp/drone-v19-sim/release-v191-userData2/`

本 PR 只包含 `scripts/sim-v19/` 和本报告；不合并、不发版、不修改产品代码。
