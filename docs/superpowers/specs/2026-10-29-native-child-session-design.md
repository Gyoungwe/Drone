# 原生插件的只读子会话（P2 child）

日期：2026-10-29。状态：已实现（宿主 `claude/p2-child`，插件 `claude/p2-child`）。依据：[原生 Pi 架构设计](2026-10-26-native-pi-plugin-architecture-design.md) §6–7、[交接](../../handoff-2026-10-29.md) §7 关键约束。

## 现状与问题

通用子代理（`tools/subagent/runner.ts`）创建的子会话不进入会话注册表，也不加载任何受管 native 插件。知识能力靠宿主内的旧路径进入子会话：

- `resolveSubagentMcpAccess` 直接读取知识 Vault 的 `binding.json` 判断 `subagentPolicy`——这是知识领域数据，宿主不应解析。
- `extensions/subagent-mcp-readonly.ts` 在宿主进程内 `import "@gyoungwe/pi-knowledge/host"` 并调用 `registerKnowledgeInterface(pi, { readOnly: true })`，绕过插件 broker 的来源绑定、权限与生命周期。
- 无 Vault 权限时再走 `registerAnswerPublication(..., { evidenceOnly: true })` 的宿主桥。

宿主已经具备另一半：`PluginNativeSessionFacts` 的 `child` 形态、worker 端 `createNativeSession(facts)` 的传输，以及 `beginNative` 对注册表 `nativeKind` / `nativeChildFiles` / `readOnly` 的核对；broker 对 `readOnly` 会话拒绝写效果、模型与会话写能力。缺的是两端：宿主不产生子会话事实，插件不消费它。

## 决定

1. **子会话事实由宿主产生，只表达事实，不授权。** 子会话固定 `readOnly: true`。`files` 只有两个值：子代理定义没有 `mcpAccess: "none"` 时为 `read`，否则为 `none`。它不携带根、Vault 路径或授权；插件读取仍经 broker，broker 按该会话 `readOnly` 拒绝写。未信任项目的子会话不加载任何插件：broker 本就拒绝未信任项目会话的一切插件操作，加载后只会让最终交付失败。
2. **子会话注册为真实会话条目，但只进独立的子会话注册表。** 子会话在运行期间以 `readOnly: true, nativeKind: "child", nativeChildFiles` 进入后端的 `childSessions`，`bindSession` 绑定同一 live SDK entry；插件能力经 `pluginSessions`（主注册表 + 子会话注册表的只读合并视图）解析它。主注册表驱动的会话列表、按文件重开、关闭与热重载都看不到运行中的子会话，避免用户关闭检视窗口时撤销仍在运行的子会话。结束、失败或取消时先撤销条目再释放 SDK 会话与 native 附着。禁止为打通链路使用 `readOnly: false` 或伪造会话 ID。
3. **插件显式声明是否支持子会话。** 默认任何插件都不进入子会话。只有清单声明 `drone.nativeChildSessions: "read-only"` 的包，其 native 入口才会加入子会话的扩展路径；未声明的包（例如 core、discovery）不会在子会话里注册完整工具集。
4. **领域策略回到插件，并在调用时判断。** 创建会话时还没有 live caller，broker 不允许此时读取绑定，因此策略不能在构造期决定。知识插件收到 `child` 事实后：`files: "none"` 只注册证据型 publication（给子会话答案加“尚未核实的补充材料”标记），从不读取 Vault 绑定；`files: "read"` 注册既有只读接口（`registerKnowledgeInterface({ readOnly: true })`），但每次工具调用和 hook 都先用当时 host 提供的 caller 重新读取本包绑定的 `subagentPolicy`，非 `read-local` 时工具明确拒绝、hook 不做任何事。两种模式都不注册写命令、specialist 宿主与恢复迁移；子会话的全部工具、hook 与 publication finalize 均声明为 read，任何写尝试在 broker 处失败。
5. **删除宿主旧路径。** 上述 native 子会话路径接通后，删除 runner 对 `binding.json` 的读取、`subagent-mcp-readonly` 的知识分支及子会话的 `evidenceOnly` publication 桥。`research-obsidian` MCP 的只读通道不属于知识插件，保留并继续只依据项目 `.pi/research-workspace.json`。

## 验收

- 插件（`pi-knowledge/test/desktop-child-session.test.ts`）：创建子会话时不读取绑定；child/none 不注册工具，finalize 声明 read；child/read 在 `subagentPolicy` 非 `read-local` 时工具拒绝，`read-local` 时只出现声明为 read 的只读工具与 hook，无写命令。
- 宿主（真实 SDK + 安装后知识包，`test/native-child-session-sdk.test.mjs`）：read-local 子会话经 broker 读 Vault，调用全部在只读能力白名单内，答案带未核实标记；`mcpAccess: "none"` 得到 `files: "none"`，无 Vault 工具、不读绑定，答案仍带标记；未信任项目子会话不加载插件；子会话以真实条目注册、可被插件能力解析、不出现在主会话列表，结束后撤销。
- 门禁：插件完整检查与宿主完整门禁；正式安装包 GUI 仍按 P7 单独验收。
