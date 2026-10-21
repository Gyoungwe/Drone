# P4 验收证据：自动知识维护

日期：2026-10-21（Asia/Shanghai）
Drone 分支：`codex/pluginize-v2-p2`
`drone-plugins` 分支：`codex/pluginize-v2-p2`

## 已完成

- `drone-plugins/packages/pi-knowledge/src/maintenance/` 提供 `plan.ts`、`run.ts` 和 `prompts.ts`。计划函数按“缺主题 → 来源变化 → 孤立 → 未被引用”排序并截断；运行函数通过 host ports 读取笔记、调用模型、只更新 topic 或提交 Wiki review 候选。
- 插件测试覆盖基础设施页过滤、预算截断、模型报错、JSON 解析失败、缺主题保持人工标题和 Wiki 候选必须经 `proposeWiki`；维护测试共 5 项。
- 插件维护测试覆盖预算截断、JSON 解析失败、缺主题保持人工标题、Wiki 候选必须经 `proposeWiki` 以及目标链接存在性校验；维护测试共 6 项。
- Drone backend 的 `KnowledgeMaintenanceService` 通过 `JsonStore` 保存设置与最近 30 次运行记录，默认关闭，按小时检查每日门槛、内容入库后防抖 10 分钟并合并并发运行；每日模型调用预算由宿主传入插件执行器。
- Obsidian 组合根已接入维护写入端口：`setTopic` 只更新目标笔记的受控 topic，`proposeWiki` 先读取当前 Vault 笔记并生成候选审阅项；两者都校验 Vault binding 与 revision，正文变更仍必须经插件的 `proposeWiki` 端口。
- 中英文维护文案已加入知识页的 canonical copy 字典；页面提供开关、每次项数、每日上限、立即运行和最近一次摘要。

## 定向检查

| 命令 | 结果 |
|---|---|
| `npm test --workspace @gyoungwe/pi-knowledge` | PASS；36 files / 324 tests |
| `npm run build --workspace @gyoungwe/pi-knowledge` | PASS；host、extension、worker 和 maintenance 源码构建 |
| `npm run typecheck --workspace @gyoungwe/pi-knowledge` | PASS |
| `npm run check`（`drone-plugins`） | PASS；全插件 build/typecheck/test/smoke/pack gate |
| `npm test`（Drone） | PASS；全工作区测试通过 |
| `npm run check:arch`（Drone） | PASS；0 个新增违规 |
| `npx vitest run packages/backend/src/services/knowledge-maintenance.test.ts` | PASS；4 个宿主调度/预算测试 |
| 临时 Vault 假模型验收（同一宿主测试） | PASS；20 篇笔记、20 次模型调用、20 次 topic 写入逐项核对 |

## 未完成/偏离

- 自动维护端口接线已完成；仍未在本阶段读取真实用户 Vault、调用真实模型或写入真实 Vault。自动化测试全部使用临时夹具与假模型，符合计划的测试边界；正式 Vault 的 N=2 实机验收仍是计划要求的人工步骤。
