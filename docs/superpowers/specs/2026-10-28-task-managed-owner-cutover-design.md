# P4 真正动态 owner 迁移设计（供主集成确认）

目标沿用已批准 P0–P7：同一个标准 Pi 包提供任务算法与可选 UI；Desktop 通过受限 application owner 加载，安装、停用、恢复和卸载影响实际原生工具与 UI。最终删除启动时 taskHost 注入，不用“发现器可注入”替代实际切换。此文是具体实施建议，尚未执行新的迁移代码。

## 已确认的源码事实

| 位置 | 当前职责与限制 |
| --- | --- |
| 插件 `pi-core/src/host.ts` | `taskHostLoader.load()` 创建顶层 acceptance registry，`createNativeSession()` 每会话创建 owner；不会随设置中的包启停自动重建。`coreHostLoader` 还创建 status/todo/memory/deliver 工具。 |
| 插件 `task-runtime/owner.mjs` | 包裹真实 Pi API，提供 owner lifetime 与事件清理；读取/广播同一 SDK event bus 中的 runtime/journal/verifier。它不是可直接放进当前 managed worker 的纯算法。 |
| 插件 `task-runtime/register.mjs` | 注册 input、before_agent_start、context、agent/tool/message hooks 和命令；读取实际分支、tool metadata；同步 appendEntry/sendMessage；使用真实 UI 问答与自动续作。 |
| 插件 `workbench.mjs` / `evidence.mjs` | 纯任务决策与 I/O 混合。文件验收使用真实 open/realpath/hash/PDF 识别；evidence restore 是受限重新读取旧文本窗口，**不写回文件**。保存回调同步递增 revision 并持久化。 |
| 插件 `acceptance.mjs` | 接收函数型 verifier（verify/observe/resolve/identify/consent/pending），含当前 runtime 的对象身份；JSON 不能复制这种验证权威。 |
| 宿主 `main/index.ts` 306–321、412–413 | 启动时发现 core/task host，并把 loader/port 传入 backend。 |
| 宿主 `create-backend.ts` 358 起、`session-service.ts`、`session-engine/extensions.ts` 190 起 | 一次 load、一次配置与永久 inline native adapter。卸载设置不会自动撤销这条引用。coreHost 还被 subagent memory 路径使用。 |
| 宿主 `permissions/extension.ts` 206 起 | 通过 `drone:task-write-consent` 回调读取 writeRoots；managed 不能广播未验证 JSON 来取得相同权限。 |
| 宿主 `ui-plugins/manager.ts:isEnabled()` | runtime source 的启用依赖全局 UI 开关、UI entry 的 enabled/trusted 与当前来源。扫描/身份以 UI entry 为键；不能满足“没有 UI 仍是标准可运行插件”。 |
| 通用 managed 机制 | 已有同 application owner、逐调用 caller/broker、实际信号、drain、资源关闭和 command。仍缺 input/tool_call/agent_settled 的完整链式事件合同；最小 Context 不提供同步 getBranch/getAllTools/isIdle 或 UI。 |

## 方案选择

推荐抽出深 module：`TaskSession` 的 Interface 只描述任务行为，Implementation 含完整 journal、状态、限制与决策；真实原生 Pi 与 Desktop broker 是两个 Adapter。异步 I/O 在明确 Seam 上完成，调用者不必学习或模拟整个 ExtensionAPI。

不采用“worker 里伪造一个同步 Pi 对象”：读取分支、工具与 isIdle 的快照会过期，立即返回的持久化/UI 方法会把失败报告成成功。也不采用“给 main 再加一个按包名的 owner registry”：它保留未知插件代码进程内执行与启动引用，不能关闭真实停用缺口。

## 插件内的模块与适配

1. `TaskSession` 对外提供输入/回合准备、工具观察、状态、版本化动作与关闭；内部保持每会话一份 canonical journal。actor 串行化本会话的异步变更，UI 读已提交状态；保存失败时操作失败，不提前广播完成或增加一个看似已持久化的 revision。
2. `TaskApplication` 在包 owner 内持有真实 session scope → TaskSession 的 Map、verifier 描述及 attachment 引用。session id/workspace 由 broker 当前 caller 或实际 SDK context 提供；UI 输入不能选择另一会话。关闭一个会话只排空它的操作；UI 关闭不销毁仍被 native attachment 使用的 owner。
3. Native Pi Adapter 调用真实 SDK 的事件、branch、appendEntry、UI、getAllTools 与 sendMessage；managed Adapter 使用显式异步 ports。两个 Adapter 共用 TaskSession 的算法与行为测试，不保留两套任务状态机。
4. 当前 UI 改为同包 UI v2：从真实已绑定 runtime 的当前 caller 读取 task view 并提交带 revision 的动作；消息呈现继续使用通用 chat.message。不能把另一份 renderer journal 当 owner。
5. `pi-core` root 与 Desktop runtime 是同 tarball 的两个入口；native root 不引入 React 或 Desktop。旧公开 `/host` 与 API 1.x 合同若必须保留，其实现仍委托同 canonical module；Drone 自身删除对 startup taskHost/coreHost 的装配与消费者。

## 通用宿主机制：只补实际需要的能力

| 需要 | 建议机制与必须保持的约束 |
| --- | --- |
| 当前 scope/idle/tool metadata | 当前调用的真实 broker scope、已有 async session.inspect；工具清单使用实际 session 当前注册信息的只读异步能力，保留 effect/source。不能伪造同步 SDK getter。 |
| 任务 journal 与分支恢复 | scoped session records 读写能力，由宿主实际 SDK SessionManager 保存；只暴露插件自己拥有的记录，排除会话正文与 private reasoning。旧无 owner 标记的 task/evidence 记录需要明确的迁移读取授权与来源映射，不能允许任意第三方声明旧 namespace 即读。 |
| 状态消息/续作 | 通用消息/输入能力绑定真实活跃 caller；void SDK 行为进入有回执、会排空的宿主操作。消息是展示，不授予 task/proof 权威；自动启动模型仍使用明确的会话授权与预算，不能靠 triggerTurn 绕过。 |
| 选择、输入、确认 | 复用实际 AskGate/PermissionGate 的异步能力，信号精确取消请求。用户回答与任务执行授权分开，不能把 plugin JSON 的“已同意”当可写范围。 |
| 文件验收与文本恢复 | broker 中现有根/文件读能力，必要的真实文件快照/哈希与稳定身份校验；PDF 身份解释继续由插件算法完成。拒绝、symlink、范围变更和修改冲突保留。 |
| acceptance/verifier | 声明只含 JSON schema/标识；实际执行留在提供者 owner，通过通用能力协调调用，复核当前 scope、来源代次和活跃 proof。停用提供者后旧凭据失效；不能把 JSON `verified:true` 当 WeakSet 活对象。 |
| 新事件 | 仅在真实 SDK 上验证 input/tool_call/agent_settled 的链式结果、变更、拒绝与取消后加入 managed 白名单；不能只扩数组。 |

两个授权问题需要在 cutover 前明确实现：插件自己 session records 的持久化授权不能冒充 read，也不能把逐 hook 保存变成数十次用户弹窗；现有一次任务授权的 writeRoots/预算必须通过宿主签发、绑定 source/session/epoch 的真实授权记录替代函数回调。不得仅因收到一个 journal JSON 就跳过权限引擎。可以先抽出 TaskSession 与真实 Native Adapter；授权能力完成前不能删除旧路径并宣布生命周期完成。

## 发现与动态生命周期

从已安装包的受验证 manifest/root/hash 提取 package runtime source index；`nativeEntrypoint` 与可选 `ui` 都引用这个来源。复用既有内容哈希、重确认、原子配置与 transition 机制，package 的启用事实来自实际 Pi 扩展设置，UI 开关只决定贡献挂载。不能要求每个 native 包伪造 UI entry，也不能在宿主写入某个可选插件的名字。

安装或恢复：安装检查 → 验证来源/权限 → 启用包 → 为活跃 SDK 会话重新发现入口 → 进入同一个 application owner → 当前 session_start 恢复 journal → UI 有绑定后才可展示操作。

停用或卸载：先撤销该 package 所有 native/UI caller → 排空在途操作与资源 → 移除真实 SDK 工具/命令/hooks 与 UI → 最后释放 owner 与文件租约。旧 UI、旧函数引用、迟到批准都必须失败。SDK reload 只在既有安全会话边界执行；活跃模型运行先取消/排空，不能静默保留旧插件的工具到下一轮。

## 实施顺序与删除点

1. 提取 canonical TaskSession/TaskApplication 与真实 Native Adapter，替换原生 root 的现有状态机接线，完整回归原行为；只在插件仓库改动，不新增宿主 task 算法。
2. 完成 package runtime source index 与通用生命周期回归，覆盖无 UI 包、同包 UI、两个来源/会话与来源变化。
3. 以真实 SDK 补记录、消息/问答、工具清单与缺少的事件；再完成实际 provider/proof 与一次任务授权。每个机制只支持实际所需的合同，并明确拒绝其余 API。
4. 同包 runtime 接 TaskApplication；UI v2 与 native Adapter 使用一个 owner。安装包消费后，删除 main 的 task/core startup discovery、BackendOptions/BackendServices taskHost 装配、sessionExtensionDependencies.taskHost 与 inline factory，以及仅为这些路径存在的运行时入口。纯公共类型/受支持的外部 API 兼容记录与宿主实际运行路径分开说明。
5. 用同一 tarball 做原生 Pi、production Backend、真实安装包 GUI、两会话启停恢复与升级回滚；双仓库完整门禁。只有切断旧引用、停用确实移除真实能力，才标记 P4 完成。

正式验收必须包含：未安装 core 时普通聊天/基本 read 可用；安装后任务一次授权与写后回读；UI 关闭而 native 仍运行；包停用则 native/UI 同时不可用；两个会话隔离；关闭一方不关闭另一方；卸载旧 PID 退出与 SQLite/文件租约释放；恢复与版本回滚重新加载且不继承旧批准。当前宿主 knowledge publication 对普通答案的阻断仍属独立 P2/P6 缺口，不得通过停用 guard 伪造零插件聊天通过。
