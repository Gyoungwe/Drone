# B5f 研究发现评测

`@drone/discovery` 的评测接口把封闭式分析回归、重新发现、多路径批评和人机核验记录成可复查的运行结果。评测结果只有在数据集、基线和执行器都可用时才会标记为 `complete`；缺少公开数据集或历史基线时返回 `needs-data`，执行器超时或抛错时返回 `blocked`，不把缺口伪装成零分或成功。

## 指标

| 指标 | 记录内容 | 越高越好 / 越低越好 |
| --- | --- | --- |
| `bixbench-regression` | BixBench 子集的封闭式分析得分 | 越高越好 |
| `rediscovery-rate` | 屏蔽原论文和后续文献后重新得到已发表结论的比例 | 越高越好 |
| `inconsistency-interception-rate` | 注入数值、方法、标签不一致后被发布门禁拦截的比例 | 越高越好 |
| `confounder-detection-rate` | 批次混杂、泄漏等合成缺陷被 critic 或多路径检查指出的比例 | 越高越好 |
| `clue-hit-rate` | 人工复核后被认为值得跟进的线索比例 | 越高越好 |
| `verification-time-ms` | 人工核验一条线索或结论的中位耗时 | 越低越好 |
| `repeated-failure-count` | 同一失败特征在不同任务中的重复出现次数 | 越低越好 |

每条评测记录都绑定 `datasetId`、数据集版本、运行 ID、观测值和证据引用。基线通过 `MemoryBaselineStore` 或宿主注入的 `DiscoveryBaselineStore` 保存；比较前必须找到同一指标、数据集和版本的基线。首次建立基线时只记录事实，不把它当作回归通过。

## 评测边界

测试 fixture 可以在本地执行，公开数据集和 BixBench 运行需要由宿主提供实际数据和版本化清单。无法访问外部数据时，结果保持 `needs-data`，报告应列出缺少的 case id 和数据版本。该状态不计为 B8 协作阶段缺口。

`KernelSession` 的本地 subprocess 仅用于受控 fixture；生产内核必须通过容器 runner，未检测到 Docker/Podman 时为 `needs-container`。评测执行器同样使用超时和输入校验，失败路径会进入 `blockedCases`，不会写入成功基线。

## 审计要求

- B5d 先登记 prior，再记录 posterior；意外度只改变线索和检验排序，不能提高 finding 的可信度。
- B5e 关键 finding 至少执行 5 条、最多 10 条替代路径；每条路径都写入 Inquiry 兼容的 attempt 记录，并给出 `robust`、`sensitive`、`unstable` 或未知状态。
- 线索和 finding 保留 `exploratory` / `confirmatory` 标签。探索性结果只能进入线索摘要，不能直接作为验证性结论。
- critic 只有只读、无 shell、无网络和无委派能力；其问题进入问题账本，不能替代人工审阅。
