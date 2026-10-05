# Drone v0.19.1 模拟用户测试报告（T2 重跑中）

日期：2026-10-05  
测试分支：`codex/sim-v19`  
正式被测 tag：`v0.19.1`（等待 `git ls-remote` 出现）  
对比基线：`v0.18.0`（`a5ba4b8`）  
脚本加固提交：`4123ff9`

## 1. 当前结论

本文件已替换上一轮不能作为验收证据的报告。v0.19.0 空跑只用于验证脚本不会假阳性，不计入验收结论、阻断数或 v0.18/v0.19 性能对比。远端目前没有 `refs/tags/v0.19.1`，因此 v0.19.1 与 v0.18.0 的正式双版本重跑尚未开始；正式报告将在 tag 出现后写回本文件。

当前阻断问题数：**未判定**。B-01、B-02 属于另一聊天的产品修复范围，本分支没有改产品代码，也不把上一轮报告中的问题状态复制到本轮结论。

## 2. T2 加固与 v0.19.0 空跑

| 场景 | 加固检查 | 空跑观察 | 验收状态 |
|---|---|---|---|
| P1 | 设置/模型用 `[data-testid="settings-dialog"] li` 读取 DeepSeek 行；Slash 用 `div.shadow-pop button[data-command]`；@ 用 `[data-testid="at-menu-agent"]`；授权分别识别 `[data-testid="ask-simple"]`、`[data-testid="ask-dialog"]`、`[data-testid="permission-allow-run"]`；示例产物先清理 | 模型行取到 DeepSeek 且“已配置”；@ 菜单取到 1 个 agent；最新空跑实际记录 8 次 permission、1 次 ask-user-form，且两个产物均未生成，严格失败 | 未完成，不计通过 |
| P2 | Vault `Wiki/Existing.md` 预置；模式值读取 `select[aria-label="知识审核模式"]`；先点击具体 `aside button` 条目再读 `h3`/批准拒绝控件；队列总数读取 Wiki 审核 aside 的 `reviews · N`；目标文件用 SHA-256 前后比对 | 最新空跑绑定未完成（9 次 permission 后仍无审核模式 select），队列状态保持 `total:null/queueItems:0`；后续 ask-dialog 无明确选项时直接失败；“没有待审核”不会通过 | 未完成，不计通过 |
| P3 | 固定 `data.csv` + `plot_fixed.py`；文件存在与数字由文件读取；产物用 `[data-testid="artifact-provenance-details"]`、`[data-reproducibility]`、代码指纹/父链节点；审稿用 `.reviewer-card-code` 精确匹配两类 code | v0.19.0 空跑未生成两个固定产物，因此 provenance 与两张审稿卡均失败 | 未完成，不计通过 |
| P4 | 第 1 轮随机 `RECALL-XXXXXXXX`；后续提示不再包含口令；只在助手 `.markdown-body` 查找；trace 需有真实 `harness_recall` 调用；每轮等 `waitForIdle(30s)`，统计实际完成轮数；trace 的 `familyPrompt`/`guard` 必须为 0 | 5 轮空跑完成 5 轮；助手明确回答 harness_recall 不可用，`secretInAssistant=false`、`harnessRecallCalls=0`；trace 有 `familyPrompt=6`，因此失败 | 未完成，不计通过 |
| P5 | 权限使用 `[data-testid="pattern-table"][data-tool="bash"] select`、`probe-run`、`probe-result`、`permissions-status[data-state="saved"]`；锁定行用 `data-locked="true"` 与 disabled input/无删除按钮；LAN 必须统计 textarea、发送按钮和写控件 DOM | 权限、自保护、取消、响应式亮暗截图有选择器证据；伪 provider 未产生请求，LAN 独立页面在当前 Electron CDP 端点无法建立新 target，均按未完成 | 未完成，不计通过 |

原始空跑产物位于 /tmp/drone-v19-sim/out-v19-hardening/。这些文件只证明脚本按严格条件拒绝不完整场景。

## 3. 正式性能表

正式 tag 出现并完成两边同工作量重跑后填写。P2、P3、P5 的短场景不进入性能对比；P4 只有在两版本的实际完成轮数与渲染消息数相等时才计算回归百分比。否则记录“工作量不一致，未比较”。

| 指标 | v0.18.0 | v0.19.1 | 变化 |
|---|---:|---:|---:|
| 冷启动到可输入 | 待正式重跑 | 待正式重跑 | — |
| P4 实际完成轮数 | 待正式重跑 | 待正式重跑 | 仅同轮数时计算 |
| P4 渲染消息数 | 待正式重跑 | 待正式重跑 | 仅同消息数时计算 |
| P4 首 token 中位数（3 次） | 待正式重跑 | 待正式重跑 | — |
| renderer/main 内存起止 | 待正式重跑 | 待正式重跑 | — |
| 长任务 >50ms、滚动帧率、trace 大小 | 待正式重跑 | 待正式重跑 | — |

## 4. 五组用户正式结果

正式重跑前，“通过”列表为空；未完成步骤不计通过。

- P1：待 v0.19.1 tag；需完成首屏、DeepSeek、示例任务、ask-user/permission 区分、一次授权后到完成。
- P2：待 v0.19.1 tag；需 automatic 与 strict 各产生一个 pending 候选、哈希不变，并在队列中各完成一次拒绝/批准。
- P3：待 v0.19.1 tag；需固定夹具生成两个产物，替换图与数字后精确出现 `figure-code-mismatch`、`untraceable-number`，主回合仍可输入。
- P4：待 v0.19.1 tag；需 25 轮、一次 compaction、随机口令助手复述、trace recall、决策撤销到发布放行，以及真实禁用重启 5 轮。
- P5：待 v0.19.1 tag；需 bash 规则试算/保存/命中、自保护不可删、401/429、取消恢复、LAN DOM 只读、四个视口/主题截图。

## 5. 费用与 token

正式运行设置总上限 2,000,000 tokens、5.00 USD，凭证不写入报告。v0.19.0 空跑没有满足正式任务完成条件，不计入正式费用表；正式费用将在两版本 run receipts 与模型 usage settlement 汇总后填写。

## 6. 脚本自检（防假阳性）

1. 所有“空闲”断言同时检查 composer、停止按钮、ask/permission modal；超时返回失败。
2. P4 口令只从助手 `.markdown-body` 读取，用户气泡 `.bg-bubble` 单独统计；文本提示本身不能通过。
3. P4 的 harness 断言来自 trace JSONL 的真实 tool/harness 记录；`familyPrompt` 与 `guard` 的分布单独列出。
4. P2 的通过条件是队列总数增长、队列条目、可用决策控件和目标文件 SHA-256 不变的合取；空态文案不会通过。
5. P3 的通过条件是固定文件内容、产物 provenance DOM、两个 reviewer code 和主回合可输入的合取；模型没有生成固定文件时必败。
6. P1/P5 只使用 testid、role、aria-label、data 属性和具体卡片节点；不使用 `document.body.innerText` 正则。
7. 每一步结果 JSON 都记录选择器、取到的值、耗时、截图、控制台 error、unhandled rejection、交互计数；未完成步骤的 `ok` 为 false。
8. 溢出审计最多列出 20 个候选，并为每个候选单独截图；正式报告逐张人工判定，不把候选数直接当缺陷数。
9. 禁用 harness 脚本真实启动带 `DRONE_HARNESS_DISABLE=familyPrompt,guard` 的独立 Electron 进程，读取子运行的 `p4.json`；进程可启动与语义断言分开记录。

## 7. 路径

- 加固脚本：`scripts/sim-v19/`
- 正式报告（本文件）：`docs/superpowers/reports/2026-10-05-v19-simulated-users.md`
- v0.19.0 空跑原始产物：`/tmp/drone-v19-sim/out-v19-hardening/`
- 原始用户内容、Vault、项目和凭证均保留在 `/tmp/drone-v19-sim/` 隔离目录，不进入仓库。
