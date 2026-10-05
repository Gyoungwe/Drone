# B5b 后台交付物审稿器设计

日期：2026-10-05

## 目标

在保持现有 B5b 元认知发布门禁、任务授权、证据回执和发布 fail-closed 语义不变的前提下，为每次交付物产生增加后台只读审稿。审稿器只产生意见，不修改文件、不回复模型。

## 领域边界

`@drone/knowledge` 增加纯规则函数 `reviewDeliverable(snapshot)`，输入复用 `MetacognitiveSnapshot` 的 artifacts/numbers/findings 等结构，并以可选字段描述正文、交付物、AttemptRecord 最近产出和读回执。函数不读取文件、不调用 Electron、Pi SDK 或 backend。

规则意见使用统一结构：规则 code、severity、位置（行/段落/产物 id）、detail、suggestion、handled。默认严重级别为 `untraceable-number` 与 `figure-code-mismatch` = high，`citation-without-receipt` = medium。

## 后台调度

领域包提供注入式 `BackgroundReviewer`，宿主注入规则审稿和可选模型审稿回调。调度器以规范化快照内容 sha256 做会话级缓存；同一 hash 只运行一次。单次运行默认 20 秒超时，超时返回 `review-timeout` 意见而不抛异常；每会话有固定预算，超预算返回 `review-budget-exhausted` 意见并保持主回合继续。规则检查不调用模型。

当需要模型审稿时，宿主按 provider 字段筛选已配置模型：优先不同 provider；没有第二 provider 时退回主会话 provider，并给模型意见标记“非独立审稿”。不得按模型名字符串判断独立性。

## 触发与输出

后台触发器在交付物写入/交付回执、任务里程碑完成、发布投影前三个边界提交快照。触发调用立即返回，审稿在异步任务中完成。结果通过现有会话事件通道追加 `reviewer_finding` 事件，同时通过 trace 的 `trace_custom(kind=\"reviewer_finding\")` 落盘。

发布投影将未处理的 high 审稿意见以 additive warning 放入 publication proof 和过程展示，保留既有发布失败项和封条逻辑，不把审稿 warning 改成新的 fail-closed 条件。

## UI

shared 会话事件新增 `reviewer_finding` 载荷，沿现有 Event IPC 通道转发，不新增 channel。renderer transcript 保存公开意见。过程面板显示可折叠审稿卡，默认收起，展示严重级别、规则、位置、建议和“非独立审稿”标记；中英文 i18n 双字典同步。

## 验证

- knowledge 表驱动测试：三类错误各一个，干净样例零意见。
- 调度器缓存、20 秒超时、每会话预算、provider 选择测试。
- 过程面板审稿卡组件测试。
- 原有发布门禁测试不改语义并全部通过。
- `npm run lint`、`npm run typecheck`、`npm run test:unit`、`npm run check:arch`、`npm run build` 全部通过。
