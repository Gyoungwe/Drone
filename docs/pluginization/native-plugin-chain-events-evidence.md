# P4 通用工具事实与 managed 事件链切片

源码提交 `743198e4` → `02fd1f8d` → `06fa5176`；插件规范 `f1ad816`。

状态 **PARTIAL**：这些实际 SDK 机制已通过本切片回归，P0 完整 API、P4 managed owner、一次任务授权、owned boundary draft broker 和正式安装包 GUI 仍未完成。

`session.tools(null)` 为 read，从 caller 的真实 live SDK entry 调用公开 `getAllTools()`，仅返回 name/readOnlyHint；每次重新读取。声明缺失时是 null，工具名不产生权限。无会话时拒绝，不要求 model 声明。公开 DTO 为 `PluginSessionTool`，没有新增 IPC、renderer API 或第二个 SDK 快照。

managed on 白名单从 12 增至 16：新增 input、tool_call、turn_start、turn_end。input 保留 SDK continue/transform(text/images)/handled 链；handled 不调用模型。tool_call 保留原 input 对象的就地变更（不把 event.input 重新赋值伪装成就地修改），下一 hook 与真实工具看到同样的参数；block/reason/terminate 仍交实际 SDK。

turn_end **只支持 null、空对象、continue 布尔结果**。实际 SDK BoundaryResult 的 entries 返回和 event.entries 就地修改均明确拒绝，不能跨来源追加 custom tag 或绕过已有记录/发布边界。真实 SDK 对可继续上下文的判断保留；这个布尔值不是任务授权。完整 owned draft broker 是下一独立机制，不能以本切片宣布自动续作完成。

事件仍使用现有 eventEffects、逐调用批准与 effect ceiling。native registry 传递实际 SDK context 的 lazy Proxy，仅覆盖 signal 为真实 call.signal；其他 getter 保留。这样 idle SDK 尚无模型 signal 时，也能取消当前 source/caller，且不会复制 context 快照。worker/parent 在等待后检查实际信号，拒绝迟到变换。错误保留 Pi 1.1.0 的原通道：input/turn 进入 onError；tool_call 失败进入单个 error tool result，不重复制造一份诊断。

## 实际证据

`native-tool-protocol-sdk` 11、`native-command-protocol-sdk` 12、`plugin-session-questions-sdk` 10、`native-runtime-owner-sdk` 4、`native-publication-courier-sdk` 1，**5 文件 38/38**。均使用真正 SDK 和 production restricted process；命令文件新增案例通过 actual Bridge/current SDK caller 做授权与撤销。协议 fixture 不代替完整正式包 GUI 验收。

- 输入两 hook 变换接力；handled 后模型 stream 零次、无新消息。
- 工具参数两 hook 接力，真实文件读回是最后内容，原始路径不存在；block 的真实目标文件不存在。
- turn_end continue 值进入下一真实 boundary hook；returned/in-place 两种 foreign-source custom draft 均拒绝，SDK branch 没有 forged 记录。
- 实际 SDK abort 后没有 canceled/late 文件，也没有把迟到参数改进原 toolCall；同进程第二真实会话仍可写回自己的文件。
- 原生 attachment dispose 与 actual Bridge idle-input source revoke 都丢弃迟到 transform；单次输入错误仍保留基础 read。
- 四种事件分别在真实 SDK 调用中拒绝/批准；拒绝时 handler 没有执行，实际错误通道与批准次数一致。
- session.tools 经受限 worker 验证 SDK hint false→true→未声明 null，普通 metadata 不生成问题卡；没有选会话时拒绝。

日志 `/tmp/task-generic-hooks-signal-sdk.log`。Desktop runtime-host 22/22、Backend/Desktop Node TSC、API package check、changed-file lint、check:arch 通过；API check 首次 formatter 子进程停滞后终止该进程重跑成功，未改 generator 或跳过检查。机器回执见[JSON](../releases/native-plugin-chain-events-2026-10-28.json)。

下一步：来源绑定的 logical-type owned boundary draft broker 与实际 SDK durability；按真实会话授权合并任务提交/续作预算，而非每个 hook 反复提问。随后同 canonical TaskController/TaskApplication 接 managed adapter 和任务数据服务，再关闭旧 startup host 路径。
