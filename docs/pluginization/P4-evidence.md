# P4 验收证据：自动知识维护

> **历史记录（2026-10-21）**：本文件保留 P4 修复分支和正式 Vault N=2 验收前的执行上下文。P4 后续已由 acceptance-2/3、C0/C1/C2 合并门禁取代；当前公开包、仓库 head 和最终状态以 [`v3-evidence.md`](v3-evidence.md)、[`acceptance-3.md`](acceptance-3.md) 与 [`gap-closure-plan.md`](gap-closure-plan.md) 为准。

日期：2026-10-21（Asia/Shanghai）
Drone 分支：`codex/pluginize-v2-p2`
`drone-plugins` 分支：`codex/pluginize-v2-p2`
Drone 交付提交：见本轮 P5 证据（P4 修复后重新收口）
插件交付提交：`6a61767e021de70954ad554d00009145afd2f6b0`（含 `0cea63a` 的维护修复）

## 已完成

- `drone-plugins/packages/pi-knowledge/src/maintenance/` 提供 `plan.ts`、`run.ts` 和 `prompts.ts`。计划函数按“缺主题 → 来源变化 → 孤立 → 未被引用”排序并截断；运行函数通过 host ports 读取笔记、调用模型、只更新 topic 或提交 Wiki review 候选。
- 插件测试覆盖基础设施页过滤、预算截断、模型报错、JSON 解析失败、缺主题保持人工标题和 Wiki 候选必须经 `proposeWiki`；维护测试共 5 项。
- 插件维护测试覆盖预算截断、JSON 解析失败、缺主题保持人工标题、Wiki 候选必须经 `proposeWiki` 以及目标链接存在性校验；维护测试共 8 项，另有 worker 集成、分类、UI 状态和跨 bundle UI 事件测试。
- Drone backend 的 `KnowledgeMaintenanceService` 通过 `JsonStore` 保存设置与最近 30 次运行记录，默认关闭，按小时检查每日门槛、内容入库后防抖 10 分钟并合并并发运行；每日模型调用预算由宿主传入插件执行器。
- Obsidian 组合根已接入维护写入端口：`setTopic` 只更新目标笔记的受控 topic，`proposeWiki` 先读取当前 Vault 笔记并生成候选审阅项；两者都校验 Vault binding 与 revision，正文变更仍必须经插件的 `proposeWiki` 端口。
- 中英文维护文案已加入知识页的 canonical copy 字典；页面提供开关、每次项数、每日上限、立即运行和最近一次摘要。

## 定向检查

| 命令 | 结果 |
|---|---|
| `npm test --workspace @gyoungwe/pi-knowledge` | PASS；插件仓库全量门禁通过；本轮维护定向测试 4 files / 11 tests |
| `npm run build --workspace @gyoungwe/pi-knowledge` | PASS；host、extension、worker 和 maintenance 源码构建 |
| `npm run typecheck --workspace @gyoungwe/pi-knowledge` | PASS |
| `npm run check`（`drone-plugins`） | PASS；全插件 build/typecheck/test/smoke/pack gate |
| `npm test`（Drone） | PASS；全工作区测试通过（231 个测试文件、1906 条测试，13 条跳过） |
| `npm run check:arch`（Drone） | PASS；0 个新增违规 |
| `npx vitest run packages/backend/src/services/knowledge-maintenance.test.ts` | PASS；4 个宿主调度/预算测试 |
| `maintenance.integration.test.ts` | PASS；真实 worker 索引 20 篇临时 Vault 笔记，20 次模型调用和 topic 写回逐项核对，prompt 包含正文 |

## 当时未完成/偏离（已由后续验收取代）

- 正式 Vault N=2 在当时尚待 Claude 第二轮验收；结果已记录于 `acceptance-2.md`，修复后的最终复核见 `acceptance-3.md`，并已纳入后续合并门禁。自动化测试仍不调用真实模型。
