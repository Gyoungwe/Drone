# 受管理任务数据垂直验收（2026-10-28）

本片让受限 worker 内的候选 managed adapter 复用已有 canonical TaskSession 和 TaskController，而不是复刻任务状态机。它提供真实状态、暂停、阶段推进结果和一次性报告读取。生产 `pi-core` 清单仍使用完整原生入口；新 `dist/managed-runtime.mjs` 尚未登记 desktopRuntime/provides，不能以本片宣布 P4 或默认 owner 切换完成。

## 提交与合同

插件：纯字节算法提取 `9e535b1` → 官方生成物 `2c44080`；pause 的实际 signal 修正 `8e96d4b`；managed 数据源 `da3e4a8` → 官方生成物 `fa3903c`。宿主真实 SDK 验收为 `d70673a3`，父基线保留原生服务 `ec877b97` / `8e4be5fc` / `cce5b14b`。

候选 `task.runtime@1` 操作如下，待完整迁移后才登记生产清单：

| 操作 | effect | 输入 | 实际结果 |
| --- | --- | --- | --- |
| status | read | null | frame |
| pause | write | `{reason}` | await canonical pause 后的 frame |
| advanceStage | write | null | `{...frame,advanced:boolean}`，未满足原算法条件时明确 false |
| takeReport | write | null | `{...frame,report:string|null}`，保留原 transient 一次消费语义 |

frame 只含 `{snapshot,render,storage}`。snapshot 以允许清单投影 id/goal/state/reason、milestones(id/title/state/dependsOn)、budget 和 pending(id/tool/state)，不传 executionConsent、writeRoots、compute、planApproved 或 proof。storage 由实际 SDK records 的 mode/state 回读，不推断 durable。

每个实际 native attachment 有独立的 TaskSession、Controller 和 runtime。来源 application 只保留故障状态；session_start/tree 经 host caller.scope 和当前 own-namespace records 绑定实际 SDK 会话。状态操作先读取当前 branch/存储模式与 fresh SDK 工具声明；没有实际 attachment、没有选择会话或来源已撤销时明确拒绝。持久化逐次经过 records.append 并核对回读 entry ID/type；写失败或取消等待后不返回保存成功，status 保留最后 committed 状态及 needs-reopen。SDK reload 不能清掉故障屏障。

## 实际证据

测试从已构建的实际 core 包复制候选 dist 到独立 fixture 包，npm pack 后离线无脚本安装，经生产 scanner、Bridge、受限 worker 和真实 Pi SDK 1.1.0 执行；fixture 只额外导出同一 canonical controller 的 plan/requestReport 来建立检查点，未伪造 executionConsent，也没有授予文件或执行权限。

- provider SDK 文件 25/25（原 19 项保持，新增 6 项）：有实际 native attachment 才能读取状态；source-owned durable 检查点及状态/暂停/未推进/报告一次消费；两个会话各自任务；正常真实 SDK reload 恢复 own record；实际 append 先改内存后 throw 后保留 last committed、拒绝 phantom chain，实际 reload 后仍 needs-reopen；真实 UI 取消等待 host checkpoint 权限后，迟到答案不追加记录。
- 无会话案例随后补测实际 application selection，1/1 通过、零模型调用，不猜测焦点会话。
- 新候选包再跑原生工具/命令、任务提交/激活、records 五文件实际 SDK 53/53 通过，日志 `/tmp/task-managed-data-existing-sdk.log`。
- core check：Node 29 与 runtime/UI 215、typecheck、build:check、smoke 均通过。已有任务 actor/raw native 的 memory/deferred/durable 语义保持，不宣称这里另跑了 managed inMemory GUI。
- 纯字节算法单独实际 tar 在安装后跑 canonical task commit/activation SDK 23/23；仍由 Native adapter 执行真实路径、8 MiB、open 与作用域检查。抽取只共享原 PDF magic/DOI/title/hash 算法，未新增格式验证承诺。

候选 tar 与日志路径见[结构化回执](../releases/native-plugin-managed-task-data-2026-10-28.json)。本地 tar 不是 npm 发布或最终统一候选。

## 保留未完成

真正的 managed 全原生工具、一次任务范围授权、actual host-queued continuation 身份、Knowledge acceptance 组合、旧版本显式迁移（剥离导入授权/根/proof）、完整文件验收与 old startup taskHost/coreHost 装配删除仍未完成。`files.readBinary` 的通用已批准 files-root 稳定读取合同已获设计批准，尚未在本片实现；它必须和 binary-state SQL 根分开。正式安装包 GUI、完整双仓库最终门禁和发布仍待后续统一验收。
