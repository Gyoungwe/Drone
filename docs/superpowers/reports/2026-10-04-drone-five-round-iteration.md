# Drone 五轮迭代留痕

这份记录把五轮用户测试的原始证据位置、产品报告和本轮改动固定在同一份可审阅记录里。原始会话归档仍保存在：

`/Users/gaoyangwei/.codex/.chatgpt-projects/g-p-6ac00da3f1688191b23c3024ffabae6c/audit/drone-ui-20261004`

## 五轮原始结果

| 轮次 | 场景 | 原始记录 | 结论 |
|---|---|---|---|
| 1 | 一篇论文走完 | `round-1-route1.md`、`round-1-route1.json` | 研究运行仍是 `running`，主张绑定为空；Vault 相对路径验收出现 ENOENT。 |
| 2 | 检索与阅读分开 | `round-2-route2.md`、`round-2-route2.json` | 检索命中没有被误报成已读；引用边界符合要求。 |
| 3 | Wiki 人工审核 | `round-3-route3.md`、`round-3-route3.json` | 候选被自动应用，审核队列为空；未知操作导致 `reconcile-before-retry`。 |
| 4 | 混合指令与路由基线 | `round-4-route4.md`、`round-4-route4.json` | 开场能力卡保持研究；模型后续加载能力没有回写路线卡。 |
| 5 | 进度、继续、取消与预算 | `round-5-route5.md`、`round-5-route5.json` | 宿主计数与模型叙述不一致；任务命令需要可见审计。 |

完整三轮原始归档及汇总索引见同一目录的 `three-round-summary.md`、`iteration-index.md` 和 `archive/`。本文件不复制会话正文，避免把用户内容写进仓库。

## 本轮实现改动

- 研究运行在 `metadata.json` 中持久化八节点、来源与结构化主张 provenance；没有带来源摘录的 legacy `claim_refs` 不能把运行推进到 `answerable`，完成后状态为 `completed`。
- 任务验收接受 `rootKind`（`workspace`、`vault`、`research-run`），宿主按批准根解析相对路径，并保留绝对路径与根类型，避免磁盘文件、回答路径和里程碑路径分叉。
- Wiki 提议始终进入 pending 队列；只有 Wiki 审核的人工作用才能应用。候选正文会去掉重复的 YAML frontmatter 和首个 H1，托管块与用户正文分开保存。
- `/task-status` 与 `/task-action` 的宿主消息带命令标识；空动作不改变任务；任务卡显示宿主阶段/总计数。
- 旧的 `research_wiki_navigate`、`research_wiki_build`、`research_wiki_status` 不再注册，统一使用知识扩展的提议与审核流。

设计批准稿见 [`2026-10-04-drone-state-chain-fixes-design.md`](../specs/2026-10-04-drone-state-chain-fixes-design.md)。

## 验证记录

- 领先提交 `068c541` 原样保留；实现分支从该提交创建。
- 设计提交：`de67852 docs: design drone state chain fixes`。
- 本轮相关回归：任务、研究、知识与扩展包共 `57 + 54 + 72 + 17` 项通过；后续核心 backend 回归为 `142` 项通过。
- 全仓 `npm test` 通过：backend `1414` 项、compute `24` 项、desktop `565` 项、discovery `12` 项、inquiry `6` 项、knowledge `72` 项、research `54` 项、shared `137` 项、tasks `57` 项、extensions `17` 项（学术桥接测试按现有条件跳过）。
- `npm run lint`、`npm run typecheck --workspaces`、`npm run check:arch`、四组运行时产物检查和 `npm run build` 均通过；构建只保留既有 Vite/Rollup 警告。
- 本轮没有把 Vault、results、会话正文或 UI 原始审计目录写入仓库；审计原始文件仍由文首绝对路径引用。
