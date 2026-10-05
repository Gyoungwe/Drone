# Drone v0.19.2 模拟用户测试报告（T2 正式重跑）

日期：2026-10-06  
分支：codex/sim-v19（PR #50）  
被测：v0.19.2 / eb0aa9fd33c89ae2d2aeb32535d1779cce889c58  
对比：v0.18.0 / a5ba4b88e136d7ed39e27db8e6fba3a9f2c1e442  
原始产物：/tmp/drone-v192-formal2/  
范围：只改测试脚本和本报告，没有改产品代码、合并或发版。

## 1. 一页结论

本轮不能作为验收通过证据。两边 npm ci、npm run build 和 CDP 开发态启动均成功；renderer console error 与 unhandled rejection 均为 0，旧会话复核中没有捕获 Maximum update depth exceeded。P1–P5 有多项未完成或明确失败，P4 没有达到 25 轮，因此不填性能回归百分比。

阻断验收问题数：5：P1 授权后仍追问且未 settled；P2 两种 Wiki 模式均无 pending；P3 provenance/reviewer 卡缺失；P5 v0.19.2 没有远程控制第二开关且伪 provider 未命中；P4 25 轮、compaction、recall、决策闭环均未完成。

Release 页三平台资产已齐。macOS arm64 DMG 的 release digest 为 3f06bf53…b2b8bceb，下载文件类型为 zlib compressed data，hdiutil attach 无法识别；DMG 安装冒烟失败。macOS arm64 ZIP（digest 1e2e8b45…09dc8c9c）可解压冷启动，关于页显示 0.19.2；包内 extension 与 tag 源文件 SHA-256 均为 b55c9fff0cf2c45da2fb26370a76649aa413eb22a7295841cf82d3590089a880。

## 2. 问题表

| 编号 | 严重度 | 维度 | 复现与判定依据 | 疑似模块 |
|---|---|---|---|---|
| V19-01 | 阻断 | 体验/功能 | P1 example-task-launch enabled 且点击成功；v0.19.2 startedRun=true、settled=false、handled=["ask-user-form"]，v0.18.0 也未 settled。授权后追问目标为 0。 | task authorization / ask-user |
| V19-02 | 阻断 | 功能 | P2 读取 wiki-review-panel 的总数和具体队列按钮；automatic/manual 两次 totalAfter=0、queueItems=0，目标文件 SHA-256 未变。 | Wiki proposal/review |
| V19-03 | 阻断 | 功能 | P3 固定夹具 data.csv（29 bytes）和 plot_fixed.py 存在；v0.19.2 无结果，v0.18.0 虽生成文件但未 settled；两边 provenance 卡为 0，篡改后没有 figure-code-mismatch 和 untraceable-number。 | artifact provenance/reviewer |
| V19-04 | 阻断 | 功能/体验 | P5 设置页 role=switch 只有 1 个，remote=null；v0.19.2 开启态虽能发送固定 LAN 消息，但没有远控开关和审批条件。 | LAN observer |
| V19-05 | 阻断 | 功能/测试 | P5 独立 provider 经 UI 刷新后 selected=null；401/429 两次 requestCount=0、错误卡 0。 | provider routing |
| V19-06 | 严重 | 稳定性/体验 | P4 两版 actualCompletedRounds=10/25、renderedAssistantMessages=10，第 10 轮 compaction 未 settled；v0.19.2 trace harnessCalls=23、familyPrompt=11、harnessRecallCalls=0，v0.18.0 harnessCalls=0。 | harness/compaction |
| V19-07 | 严重 | 功能 | P4 decision-row 数为 0，未完成撤销→pending-review→发布拦截→确认放行，也未验证未引用产物不拦截。 | decision ledger |
| V19-08 | 严重 | 发布 | macOS arm64 DMG digest 正确但无法挂载；ZIP 冷启动通过，不能替代 DMG 安装冒烟。 | release packaging |
| V19-09 | 一般 | 测试 | P5 旧 JSON 的取消步骤因断言过弱标为通过，但 error-note 为 0；脚本已收紧为 errorCards>0，旧结果不计通过。 | error-card assertion |
| V19-10 | 建议 | UI | 各版本产生 20 个 overflow 候选并逐个截图；主要是 truncate/横向滚动容器，候选数不直接计缺陷。 | layout/i18n |

## 3. 性能对比

不填百分比：两版虽各记录 10 settled 回合/10 渲染消息，但请求目标是 25 轮且 compaction 未完成；disabled 重启两版实际为 0/5 轮。P2、P3、P5 短场景也不进入性能表。

| 指标 | v0.18.0 | v0.19.2 | 变化 |
|---|---:|---:|---:|
| P4 请求轮数 / settled 轮数 | 25 / 10 | 25 / 10 | 工作量未完成，未比较 |
| P4 渲染助手消息 | 10 | 10 | 仅部分工作量，未比较 |
| 首 token、帧率、长任务、内存、trace 大小 | 未完成 | 未完成 | 未比较 |
| 200 条记录渲染 | 未完成 | 未完成 | 未比较 |

## 4. 五组用户步骤

- P1：DeepSeek 设置行 configuredRows=1、示例对话框和双语审计 leaked=[] 通过；Slash/@ 菜单计数均为 0；授权后有表单追问且未 settled。证据：两版 p1.json。
- P2：预置 binding 通过；topic DOM 输入/刷新/文章数为 0；automatic/manual 队列均为 0；Zotero 面板可打开。证据：两版 p2.json。
- P3：固定夹具与计算空态 hosts=0、jobs=0、buttons=9 通过；运行 settled、来源卡、两类 reviewer 卡均未通过。证据：两版 p3.json。
- P4：正常 10/25 轮，compaction/recall/decision closure 失败；disabled 重启真实执行但 0/5 轮，均不计通过。证据：p4.json 与 p4-disabled/p4.json。
- P5：权限规则保存/试算、自保护规则、四视口亮暗截图通过；取消 error card、伪 provider、LAN 双态均不通过。证据：两版 p5.json。

## 5. 脚本自检

1. P1 完成步复用启动步的 startedRun/settled，空闲 DOM 不能制造通过。
2. P1 分开处理 permission-allow-run、ask-simple、ask-dialog，授权后 ask-user 计入中断。
3. P2 必须有队列总数增加、具体条目、选中预览、可用决策按钮和目标文件 SHA-256 证据；空态文案不能通过。
4. P3 必须同时满足固定夹具、provenance DOM、两个 reviewer code、主回合可输入。
5. P4 口令只查助手 markdown-body，用户 bg-bubble 单独计数；trace 必须有真实 harness_recall；disabled 才要求 familyPrompt/guard 为 0。
6. P5 伪 provider 必须满足 aria-label 刷新、UI 选中模型、requestCount>0、错误卡和恢复；G-01 只看 LAN DOM 的真实写控件，停止按钮被排除。
7. 所有步骤记录选择器、值、耗时、截图、console/unhandled 和交互计数，ok 严格为布尔值。
8. 预算拆分记录未缓存输入、缓存命中输入、缓存写入、输出、总 token 和费用；overflow 候选逐一截图，不以候选数直接报错。

## 6. 费用、构建与原始产物

Usage 来自隔离 agent-dev JSONL，未输出 key。累计包含正式 P1–P5、P4 正常和 disabled 尝试：

| 版本 | 未缓存输入 | 缓存命中输入 | 缓存写入 | 输出 | 总 token | 费用 |
|---|---:|---:|---:|---:|---:|---:|
| v0.18.0 | 493,639 | 1,380,352 | 0 | 89,989 | 1,963,980 | $1.068695 |
| v0.19.2 | 527,673 | 1,031,168 | 0 | 105,423 | 1,664,264 | $1.159375 |
| 合计 | 1,021,312 | 2,411,520 | 0 | 195,412 | 3,628,244 | $2.228070 |

构建均成功；Vite 动态 import 警告不影响构建。P4 disabled 主进程日志另有 MaxListenersExceededWarning，renderer error/unhandled 仍为 0。

主要 JSON 在 /tmp/drone-v192-formal2/out-v192/ 与 out-v180/ 下；Release 产物在 /tmp/drone-v192-formal2/release/。

本 PR 只包含 scripts/sim-v19/ 与本报告；不合并、不发版、不改产品代码。
