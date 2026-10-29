# P5 共享 owner：绑定、计划写入与写者交接候选

2026-10-28。候选 `pi-discovery@0.2.0` 与私有 Plugin API 1.3；没有 npm 发布。此文只覆盖 B 切片，不关闭 P5、P0–P7 或正式安装包验收。

## 实现边界

同一 tarball 的原生入口与 optional Desktop runtime/UI 共用 `DiscoveryService`。受管应用 owner 按每次真实 `caller.scope` 的规范 workspaceId 分区；UI 不传入 workspace 声明，不从 cwd 字符串猜规范身份。`roots.describe(null)` 只描述本次已授权根，既不是全局 StorageRegistry 列表，也不产生新授权。

用户显式选择状态目录本身；接续旧 Desktop 数据时选择原 `getAgentDir()/discovery/<hash32>` 目录，不猜 HOME、不搬文件。`bindCurrentWorkspace` 是 write 操作：检查当前真实 scope、确认已有日志、先 `state.reserve` 再以 CAS 创建 `workspace-binding.json` 并回读。其他 workspace 的既有绑定不可覆盖。唯一既有 plans projectId 被保留；混合/冲突 projectId 拒绝接管；空根沿旧 `discovery-<canonical-workspace-sha256-first-32>` 算法生成。

新 UI 有真实状态根选择、绑定/接管、探索计划表单、保存和计划回读；显示固定计划预算及尚未接通的执行范围。没有伪造 kernel/critic/multipath/evaluation 成功卡片。原生 3 个读工具保留未绑定旧日志只读访问；新增 `discovery_bind_workspace`、`discovery_create_plan`，没有后台解释器或网络执行。

## 写者与持久化

原 `PluginResourceReservations` 源码真正迁至独立 Node 子路径 `@gyoungwe/plugin-api/node/reservations`。backend 与标准原生适配消费同一实现，固定 `state-writers` namespace + canonical directory；通用 API 根/UI/runtime 子路径不引入 Node，包门禁递归检查 nested dist。无 process 全局账本，没有自动接管崩溃残留。

`state.reserve` 只接受已存在、无 symlink、具有实际 state-write grant 的目录。状态读写不要求 resource worker。宿主关闭分为 domain/native/resource drain 与 successful final release；任何域/资源关闭失败都阻止最终 lease 释放。文件临时清理失败也保留对应写者，并保持真实错误。文件队列 drain 与清理校验在最终释放前进行；混合 resource/file activation 不会在发现文件清理失败之前先释放 resource lease。

受管 JSON journal 经 backend `JsonStore.writeChecked` 进行 raw-byte SHA CAS、原子写入及写后回读。标准 Pi Node 入口不能 import backend，使用本包 Node snapshot/CAS/同目录 atomic link-or-rename/回读适配；两者不是同一 JSON 实现。Node 适配严格拒绝损坏 JSON、symlink 和超过 1 MiB 的文件；清理失败保留 lease。

旧 backend host facade 在 C 完整替换前保留，但不再是不受约束的第二写者。真实写操作取同一目录 lease；原有需任务授权的方法在授权后、实际副作用前取锁。journal 自身也以原始读版本与真正 JsonStore CAS 检查。旧 Domain 若在只读时缓存了后来被新 owner 改变的快照，会明确拒写并要求关闭重开，不能覆盖新记录。已有新 binding 的根也校验实际 host project/workspace 身份。域关闭与 accepted calls 并行排空，失败保留 lease。

## 验证与真实失败

`packed-discovery-owner-sdk.test.ts` 从本地 tarball 干净安装；生产 `buildPlugin` 构建包内 UI，生产 registry/PluginEntryHost 挂载，实际按钮绑定和保存。真实 SDK 工具调用读取并追加同 owner 计划；停用 UI 后原生继续，恢复 UI 读回新计划并再次保存，原生读回这次 UI 写入；第二 workspace 不串数据。

同测试用实际生产 legacy loader/JsonStore 写者创建原 hash 目录记录，验证 old→new 与 new→old 的 lease 拒绝、原字节与 projectId 保留、旧 reader 快照变化时 CAS 拒写，以及 fresh legacy 交接恢复。独立 Node 子进程启动真实 SDK 和同 tar 原生入口，对相同显式根先被拒绝，受管 owner 实际关闭后可接管。离线 faux provider 只决定调用序列；没有远程模型推理，也不算正式 Electron/DMG GUI。

真实失败已保留：仅 `AgentSession.dispose()` 不会发出官方 `session_shutdown`，曾留下 lease 并让后继 writer 恢复失败。验收子进程改为公开 extensionRunner shutdown + abort + dispose，并检查 SDK onError；没有用 process exit 清锁或放宽第二写者断言。其他失败包括 API peer 未显式装入、旧 readOnly 断言未区分新增写工具、UI 按钮尚 busy、依赖目录被外部清理；机器回执保留原日志与最终范围。

## 冻结验证范围

源提交：宿主 `c7770a95` + 测试类型补全 `85b95d8d`，插件 `e27926c`；共享 Node helper 结构迁移前置 `5d612382`。私有 API tarball 与插件 tarball 的 SHA-256、命令结果和保留失败日志索引见 [机器回执](native-plugin-discovery-owner-evidence.json)。候选包没有发布 npm，也没有修改宿主发行锁或 vendor。

- 插件仓库根 `npm run check`：exit 0，含完整 build/manifests/领域检查、安装 smoke、全部包 pack 检查；使用显式私有 API tarball，不算 public registry install。
- 宿主 filesystem/runtime/resource 4 文件 47 测试通过，包含真实 EACCES 临时文件清理失败保留 lease；Desktop runtime source/host/bridge 88 测试通过，随后必填测试类型修正经 Desktop typecheck 与相关 20 测试复验。
- Plugin API 17 测试通过，backend/Desktop typecheck 通过，架构检查 0 baseline findings、host independence 通过；领域迁移总状态仍 PARTIAL。
- 实际宿主写者生成三个工作区后，同 tar 在 SDK locked `1.1.0` 与 npm latest `1.4.0` 均通过 9 次真实工具分发；此矩阵只验证原生读侧，不替代共享 UI 或容器执行验收。
- 已安装同 tar 的 SDK/UI/legacy/native 4 文件 13 测试通过；source UI 按钮实际保存，另一个真实进程的 native writer 实际被排斥。未提供 knowledge tar 的附加知识回归按原测试条件 SKIP，不能算通过。

官方 SDK 1.1.0 的 `AgentSessionRuntime.newSession/switchSession` 在 shutdown 后调用 `createRuntime` 创建替代会话，因此 adapter 按 activation 清理；不为旧会话复用一个已取消的扩展。直接调用 `AgentSession.dispose` 仍需宿主先发官方 shutdown。

## 仍未完成

- 新 runtime 的受控执行、durable accepted-execution receipt/取消后合法 reconcile、Inquiry/model/critic/multipath/evaluation/export 端口。
- Kernel 按真实创建者 SDK session 的所有权及两种关闭顺序。
- 完整 B5 UI、默认发行预设及删除旧 host facade/IPC/宿主领域源码。
- 合并后的双仓库最终根门禁和正式 macOS 安装包的实际 GUI、启停、升级/回滚。
- 四项既有外部账户/平台验收继续未完成；MinerU/GROBID、B8/B8-2 继续暂缓。
