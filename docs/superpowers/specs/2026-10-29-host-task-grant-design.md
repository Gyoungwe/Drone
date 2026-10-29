# 宿主签发的任务授权（P4 第一步）

日期：2026-10-29。状态：审批模型已由用户确认（2026-10-29）；宿主侧已实现（`claude/p4-task-grant`），插件侧 consumer 随任务状态机迁移接入。依据：[P4 动态 owner 设计](2026-10-28-task-managed-owner-cutover-design.md)“两个授权问题需要在 cutover 前明确实现”、[执行修订](../../pluginization/native-plugin-implementation-plan.md#2026-10-29-执行方式修订用户确认) 第 6 条。

## 现状

- **一次任务授权**由任务插件自己完成：插件在会话里弹出“开始执行这个任务？”选择框，用户同意后插件在自己的 journal 里记下 `executionConsent` 与 `writeRoots`。
- **宿主权限门**遇到 write/edit 需要确认时，在会话事件总线上广播 `drone:task-write-consent`，由插件回调告诉宿主当前允许写哪些目录；宿主只检查这些目录是绝对路径，不知道它们来自哪次授权。
- 这条路径只在任务插件以**进程内**方式加载时成立（当前启动期 taskHost）。核实结果：第三方普通扩展在进程沙箱里没有 `pi.events`，受管 native 插件同样没有，所以今天在 Desktop 里不是可被第三方利用的漏洞；但任务插件一旦按 P4 迁到受管运行时，这条桥就**直接失效**。
- 受管插件的每一次 write（工具、命令、hook、写能力调用）现在都弹一次原生对话框，没有任何缓存。任务编排几乎每一步都保存记录，照此迁移将每步弹窗，不可用。

## 需要确认的审批模型（推荐）

保留今天用户看到的行为，只把权威从插件搬到宿主：

1. **插件自己的簿记不弹窗。** 插件写自己命名空间下的会话记录（`session.records.append`）与已在激活时授权过目录的私有状态，不再逐次弹窗；只读会话、子会话与未信任项目仍一律拒绝。这和今天进程内任务插件保存 journal 的行为一致。
2. **一次任务授权由宿主签发。** 插件调用宿主能力 `task.grant.request`，宿主自己解析目录（存在、非盘符根、非家目录及其上级、最多 8 个）、自己渲染对话框（目标、可写目录、预算、验收标准，即今天“开始执行这个任务？”的内容），用户同意后宿主保存授权记录，绑定 **会话 + 插件来源（内容哈希）+ 任务 ID + 合同哈希**。
3. **授权覆盖的范围**（与今天文案“同意后它会自己做完这些事，中途不再反复问你；做别的、删东西或碰敏感文件仍会先征得你同意”一致）：
   - 该插件在该会话中的 write 工具/命令/hook 不再逐次弹窗；
   - 模型的 write/edit 落在已批准目录内时免确认（取代 `drone:task-write-consent`）；
   - 删除、敏感文件、目录外写入、网络/远程计算写入仍逐项询问。
4. **授权何时失效**：任务完成/取消（插件调用 `task.grant.release`）、会话关闭、插件停用或升级（来源哈希变化）、新任务授权替换旧授权。JSON 记录恢复不能恢复授权，重开会话必须重新同意（与现有“重开后必须新授权”的回归一致）。
5. **没有任务授权时**，受管插件的 write 仍按现状逐次弹窗。

不在本步：自动续作（需要单独的续作合同）、任务状态机迁入受管运行时、删除启动期 taskHost。旧的 `drone:task-write-consent` 桥在进程内 taskHost 删除时一并删除（P4 cutover），期间宿主授权优先。

## 验收

- 单元：目录解析拒绝盘符根/家目录/不存在目录；授权与会话、来源、任务绑定；释放、会话撤销、来源变化后失效；只读/子会话/未信任项目拒绝。
- 真实 SDK + 受管 fixture 插件：一次宿主对话框后，目录内 write 免确认、目录外仍确认；插件 records 追加不弹窗；会话关闭或来源变化后同一 write 重新确认；第三方无法通过事件总线授予目录。

## 实现（宿主侧）

- `packages/backend/src/plugins/task-grants.ts`：`TaskGrantStore`（按 live 会话条目保存，一会话一份；会话撤销/替换、来源不再是已启用的当前安装来源时立即失效，未绑定来源校验器前一律无效）、`resolveTaskWriteRoots`、宿主渲染的对话框文本，以及 `task.grant.request` / `task.grant.release` / `task.grant.current` 三个能力。请求在对话框前解析目录，同意后重新解析，两次结果不一致（对话框期间目录被替换为链接等）则拒绝签发。
- 能力审批策略：`PluginCapabilityHandler.approval`。`"own"`：`session.records.append` 与 `state.*` 写不弹窗；`"always"`：`files.writeText/remove/ensureDirectory`、`execution.run`、`session.records.adoption.*` 与 `task.grant.request` 本身始终弹窗；其余写（插件写工具/命令/hook 与 `model.*`、`session.select/input/confirm/notify`、`execution.cancel` 等）在当前授权下免弹窗。`readCallable` 允许只读调用发起 `task.grant.request`（它自带宿主对话框）。只读会话、子会话与未信任项目在 `permitted()` 处仍一律拒绝。
- 只有清单声明 `drone.taskGrants: "request"`（必须同时有 `desktopRuntime`）的包会拿到这三个能力；该声明进入来源比较，变更即视为新来源。
- 权限门：`PermissionGateOptions.taskWriteRoots` 优先读取宿主授权，命中时不再广播 `drone:task-write-consent`；旧桥只在没有宿主授权时为启动期进程内 taskHost 保留，P4 cutover 时删除。
- 验收：`src/plugins/task-grants.test.ts`（目录规则、绑定与失效、桥上策略、拒绝、只读/子会话/未信任、对话框期间目录替换）；`test/task-write-consent.test.ts`（宿主授权优先、事件总线无法扩大目录）；`test/task-grant-sdk.test.mjs`（真实 SDK 会话：一次宿主对话框后目录内 write 免确认、目录外仍确认、自身 checkpoint 不弹窗，来源停用或会话关闭后失效）。

## 受管任务所需的其余宿主能力（第二步）

为把任务状态机迁入受管运行时，宿主补三项通用能力，均不新增授权来源：

- **自动续作 `task.continue`**（随 `drone.taskGrants` 提供）：只在该插件当前来源的任务授权下、针对授权的任务、会话空闲时可用；每次消耗授权对话框里写明的“自动续作最多 N 次”，用完即拒绝，新授权重新计数。宿主自己发出隐藏的 `plugin-continue:<插件>` 消息（followUp：有回合在跑时排在它之后，空闲时直接开始一轮），返回 `continuationId`；因此插件可以在自己的 `agent_end` hook 里请求续作，不需要在调用结束后另起定时器（受管插件在调用结束后没有 live caller）。沙箱插件不能伪造这种消息，插件在 `message_start` 用类型 + `continuationId` 识别自己的续作。
- **状态卡 `session.notify` 的 `view`**：可附带一个任务视图，宿主用 `decodeTaskView` 校验后以 `plugin-notice:<插件>` 消息展示为状态卡（宿主生成 reportId），也计入 harness 的任务检查点与 recall。只用于展示，不授予任何权限；`session.notify` 归为 `approval: "own"`，不再逐次弹窗。
- **按当前读权限读取工作区 `workspace.readFile`**（清单声明 `drone.workspaceRead: "session"`）：与模型 `read` 调用走同一次权限求值（规则、边界、确认），请求路径和解析后的真实路径都必须被允许，链接不能绕过规则；读取最多 8 MiB 的稳定快照并返回哈希与文件身份。会话关闭后不可用。旧的 `drone:task-read-check` 事件改为复用同一判定，随进程内 taskHost 一起删除。

验收：`src/plugins/task-grants.test.ts`（续作的来源、任务、空闲、预算与新授权重计）；`packages/shared/src/task-status.test.ts`；`test/task-grant-sdk.test.mjs`（真实 SDK：状态卡渲染且无弹窗、非法视图拒绝；续作触发一轮隐藏消息并在预算用完后拒绝；工作区读取遵守拒绝规则、链接不能绕过、会话关闭后失效）。

### 只读 hook 也能做的事

受管插件的每个 hook/工具/命令按声明的 effect 调用能力：write 调用在没有任务授权时会逐次弹窗。任务编排在每轮对话里有十几次 hook（input、tool_call、tool_result、agent_end 等），如果它们都必须声明 write，任务开始前的普通聊天就会被弹窗淹没。因此不弹窗、不授予权限的能力允许从只读调用里使用（`readCallable`），可写会话检查仍在能力内部执行：

- 自身簿记：`session.records.append`、`session.notify`；
- 提问：`session.select` / `session.input` / `session.confirm` 归为 `approval: "own"`——问题本身就是用户的决定点，答案不授予目录、模型或执行权限，不再在提问前另弹“允许插件提问吗”；
- `task.grant.request`（自带宿主对话框）、`task.grant.release`、`task.continue`（权威来自当前授权本身）。

受管任务插件因此可以把 hook、`task_plan`/`task_wait` 工具和 `task-action` 命令都声明为 read：普通聊天不弹窗，任务开始只看到一次宿主任务授权，之后的文件写入由授权目录覆盖。
