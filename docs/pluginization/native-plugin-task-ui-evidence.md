# P4：同包任务 UI 与明确命令调用切片

本轮源码候选：Drone `626f1253`，插件源码 `00e29c7` / 可复现生成物 `0680d8f`。属于 P4 的真实 SDK 与 renderer 切片；完整 P4、动态 native 包启停、正式 macOS 安装包尚未完成。机器记录见 [task UI receipt](../releases/native-plugin-task-ui-2026-10-28.json)。

## 已实现并验证的行为

- 标准 Pi 原生入口、task journal owner 与 `ui/plugin.json`、bundle 在同一 `pi-core@0.2.0` tarball。原生入口不加载 React；UI 仅消费公开安全消息、hooks、动作和资源预览合同。
- TaskPanel、任务行、人工决策卡、里程碑和产物链接归插件；宿主删除对应布局与 shared task workbench 投影，保留通用 Overview 的待办、权限和会话概览。旧公开 UI 1.x 的 `helpers.taskArtifactLinks` 保留真实纯函数兼容入口，活动消费者已移出宿主。
- 通用 `hostStatus` 只标记显示来源，历史和 live 投影一致；模型伪造同名字段不会获得 journal、人工批准或 publication 权限。空 usage settlement 不生成空助手行，失去插件后仍有默认消息回退。
- `sessions.command` 经 shared → preload → main IPC → backend → 当前真实 SDK runner 的公开 `getCommand/createCommandContext` 执行。缺失命令立即失败，零模型请求；handler 错误通过当前 runner 的 onError 诊断一次并向调用者失败。类型、构建 shim、资源声明、host API manifest 和 SPEC 同步。
- 真实安装 core 的 SDK 会话创建任务、要求人工 review，实际生产 renderer registry / MessageItem 挂载 UI。停用或移除 UI 后动作和任务页消失；原生 task_status 仍可读取同一 journal；重新挂载后使用当前 revision、目标 sessionId 执行人工 acknowledge，回读里程碑 completed。此处只证明 UI 生命周期，不能代替 native 包停用。
- 旧 UI 对已不存在的 native task-action 发起动作时明确显示 unavailable，模型调用计数不变。

## 取消回归

初次真实 SDK 回归复现：command 已取消并最终拒绝 IPC，但 idle command 的 SDK context 没有本次 agent-run signal，迟到的选择回答仍能写 journal。保留 RED 日志与哈希。

现通过 Proxy 保留 SDK 的动态 getter，提供 command controller / SDK signal 的组合信号，并在访问与 waitForIdle 后核对当前 entry / runner。通用 command 的待答选择取消后不能晚写；实际 task-action progress 的人工 review 取消后，迟到选择不能把 pending 里程碑标为 completed，之后显式正常人工 acknowledge 仍可完成。没有声称能抢占任意忽略信号的第三方 JavaScript handler。

## 验证与包来源

- 独立 Git archive → npm ci → 新 API tarball → 插件全量 `npm run check` 为 0；锁定 typebox 1.3.7。清洁 core tarball SHA-256 `6126b68420f14a7f46ff8ac02dd41bffeb277009d4f80a836dd4a167f8ca9a86`。四个生成物与正式构建提交逐字节相同，实际 SDK 测试安装的 native index、host、UI bundle 和 manifest 与清洁产物一致。
- 后续 host 源码实际 SDK 14/14；Desktop 913 pass / 1 skip；shared 347/347。backend、shared、Desktop 类型检查、生成合同、架构与 lint 通过；lint 保留历史大 HTML warning。共享消息伪造测试补齐真实 SDK 必填结构后重跑类型与该测试 2/2。
- 源码 Electron 预览 22 项通过，包含 Markdown/产物资源读取、人工 review 存留和不自动续作；属于开发 harness，不能写成正式安装包 PASS。
- 补充 clean-host `npm install --no-save --workspaces=false` 实验重解析 peer/transitive SDK 图，产生 mixed codemode 声明错误，未用作通过证据。最终集成须使用宿主源码锁的默认 fetch、完整一致依赖图及独立根门禁。

## 仍未完成

native task host 的发现目前由启动组合根提供，设置中的包停用尚未完整联动已有 native owner；`native.dispose` 或 UI toggle 不能代替这条验收。示例任务、科研首页与 workflow catalog 的真实宿主消费者、task-status 自然语言路由仍需迁移。正式安装包、零领域插件、升级回滚与 P0–P7 最终双仓库门禁继续保留未完成。
