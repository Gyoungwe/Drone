# Drone v3 能力化真实桌面验收计划

## 1. 目的和范围

本计划把 v3 的实现与自动化验证，转换为按能力执行的真实桌面端与宿主链路验收。验收对象是打包后的 Drone Electron 客户端及其真实 backend、IPC、preload、UI 插件、skill、MCP、连接器、知识库和任务运行链路；它是 [`final-pluginization-plan.md`](final-pluginization-plan.md) 的发布验收清单。GUI shell 无法启动时，必须把宿主/SDK 的真实行为证据与交互式截图状态分开记录，不能用静态按钮替代行为证据。

本计划不把“按钮存在”“状态标签显示成功”或“单元测试通过”当作能力完成。每项能力必须完成一次真实桌面或真实宿主/SDK 操作，得到可观察返回，并留下可以追溯的任务、运行、版本、hash、外部对象或审计证据；交互式截图另记为 GUI 观察证据。

本计划同时继承 v3 的**结果红线**：系统可以报告观察到的事实、运行状态和限制，但不能把缺少证据、未经复核或无法确认的结果包装成已验证科学结论。插件验收还必须证明“配置改变后真实行为改变”，不能只验收页面。

测试使用隔离的 HOME、userData、agentDir、knowledgeDir 和临时项目。不得读取或提交正式 Vault、session 正文、正式凭据、`results/` 或本机私有状态。

## 2. 与 v3 计划的对照

| v3 能力 | v3 已有验证 | 本计划新增的真实验收 |
|---|---|---|
| P0 能力包、Lazy Tools、Skills | registry、schema footprint、输入 hook 测试 | 从 Tools & Skills 页面启用 skill，实际触发调用并验证返回结果和 invocation 记录 |
| P1 specialist model/thinking | 配置、权限和 receipt 测试 | 在桌面端选择模型和思考档位，执行任务，核对实际 receipt，不接受静默替换 |
| P2/P3 Tools & Skills UX | 页面和设置测试 | 验证启用、禁用、重载后实际能力变化，而不是只检查 UI |
| P4 Run Inspector | shared transcript 和 inspector 测试 | 真实任务中核对工具、子代理、耗时、错误、产物和公开阶段是否来自同一运行 |
| P5 语义检索 | FTS、向量融合、fallback、fingerprint 测试 | 新会话实际复用知识；语义命中必须重新读取当前源，不能直接制造证据 |
| P6 长会话恢复 | 20/50-turn replay、取消和队列恢复 | 真实桌面长任务中压缩、重启、继续、取消和重试，检查没有重复副作用 |
| P7 知识生命周期 | 幂等、proposal、stale/conflict 测试 | 创建知识、关闭应用、新会话复用、源变更后重新验证 |
| P8 跨会话 topic | 持久化、唯一匹配、歧义和 scope 测试 | 用用户操作验证新会话、项目切换和 Vault 切换的实际恢复行为 |
| P9 specialist orchestration | budget、reservation、permission、decision 测试 | 由真实任务触发自动/手动/关闭三种策略，核对派发、取消和父级回执 |
| P10 release hardening | lint、typecheck、test、build、package fixture | 启动真实打包应用，完成最小任务、重启恢复、能力入口和资源完整性检查 |
| 架构升级审计 P0–P4 | contract、adapter、provenance、proposal、capsule 设计和测试 | 从未知流程到推荐能力、授权、执行、证据和交付走完完整用户路径 |
| WebDAV/Zotero/连接器 | adapter、IPC、同步和局部测试 | 创建→回读→删除，冲突选择和远端真实副作用验收 |
| UI 升级计划 | 视觉回归、a11y、Graph/WebDAV 门禁 | 真实桌面操作所有 loading/empty/error/conflict/disabled 状态，验证文案和行为一致 |

v3 的本地自动化验证仍然是必要门槛，但不能替代下面的桌面验收。最终报告必须区分 `PASS`、`FAIL`、`BLOCKED` 和 `NOT_RUN`。

## 3. 统一操作和判定规则

每条验收记录至少包含：

- **桌面操作**：鼠标、键盘、输入、切换、重启和外部应用操作。
- **预期返回**：界面状态、会话消息、文件、任务状态、外部对象或审计事件。
- **通过标准**：必须同时满足的可观察条件。
- **证据**：截图、任务 ID、`runAttemptId`、revision、ETag、SHA-256、外部对象 ID 或审计 JSON。
- **状态**：`PASS`、`FAIL`、`BLOCKED`、`NOT_RUN`。

判定规则：

1. 只有 UI 状态，没有 backend 状态或外部副作用，判定为 `FAIL`。
2. 需要凭据、设备或外部服务但当前不可用，判定为 `BLOCKED`，不能用模拟成功替代。
3. 返回未知状态时，必须显示未知状态和下一步，不能直接显示成功。
4. 所有写入、远程执行、安装、覆盖、删除和发布动作都必须有授权记录。
5. 语义检索、topic 摘要、子代理结果和 UI 预览只能导航，不能凭空生成 evidence receipt。
6. 测试报告不能包含凭据、session 正文、正式 Vault 内容或本机私有路径。

## 3.1 当前状态快照

状态只表示当前仓库已有证据，不表示最终插件化已经交付：

| 项目 | 当前状态 | 已有证据 | 缺失 / 下一步 |
|---|---|---|---|
| UI 插件宿主 | **UI-01 真实宿主验收通过** | `packages/desktop/src/main/ui-plugins/ui-acceptance.test.ts`：真实内置 bundle 经 `UiPluginManager` 构建/读取，renderer registry 出现、移除、重载 nonce 递增，配置跨 manager 重启保持；报告 `/private/tmp/drone-ui-skill-acceptance.json` | 交互式 Electron 仍受当前 shell 的 macOS `NSApplication` 启动阻塞；本机构建产物验收与宿主 lifecycle 已通过，GUI 截图不作为本次 gate |
| 知识与 topic 记忆 | **MEM-01 隔离验收通过** | `packages/backend/test/mem-gate.test.mjs`：隔离 Vault 的 `memory-note.md` 写入 marker，新实例恢复 topic/来源/未解决问题，源变更后 stale/changed；evidence 写入 Node `os.tmpdir()` | 继续复跑根门禁；不触碰正式 Vault |
| Skills | **SKILL-01 真实 SDK 验收通过** | `packages/backend/test/skill-acceptance-sdk.test.mjs`：真实 Pi SDK + offline faux provider 完成 `/skill:research-workflow` 展开、模型回合、visible skill 与 invocation 记录；自动禁用反证和 manual-only 语义证据写入 Node `os.tmpdir()` | `disable-model-invocation` 只关闭自动选择；显式 `/skill:` 仍按 Pi 契约可用，计划与 UI 必须准确显示该语义 |
| MCP / 连接器 | **隔离真实调用已通过（适配器与 IPC；WebDAV/Zotero 写入闭环）** | `packages/backend/test/mcp-connector-gates.test.ts` 以 staged `pi-mcp-adapter` 完成 marker tool call 和关闭重载；read-only `CapabilityResearchPorts` 完成唯一词 source receipt/调用记录与关闭跳过传输；WebDAV 与 Zotero 临时对象均完成真实创建→回读→删除 | 根门禁持续复跑；Protocols.io 保持只读 |
| 外部写入闭环 | **WebDAV + Zotero 已通过；Protocols.io 只读** | 两个连接器均完成授权→创建→回读→删除→再回读，凭据未写入仓库 | 维持 Protocols.io 只读；若以后启用写入需另行授权 token |
| 结果红线与 evidence | **REDLINE-01 隔离验收通过** | 状态合同、publication/metacognitive/orchestration gate、`npm run check:redline` 的 4 类可重复 fixture 与 sealed proof | 交互式桌面截图可继续作为可选观察；本机构建产物和领域审计已闭合 |
| Pi 基线 | **research-suite 新版真实 CLI 通过；旧版冲突负例明确失败** | `drone-plugins` main `e5b9e41` 的真实 CLI 回归在 Pi `1.1.0`/latest（1.3.0）独立 HOME 中执行 `pi install` 和 `pi -p --no-session /task-status`：`research-suite@0.1.2` 两版 PASS；已弃用 `0.1.1` 两版均 stderr 含 `conflicts`、退出 1，标记 EXPECTED_FAILURE。历史组合 FAIL 记录保留在执行日志 | push/PR CI 持续运行 `scripts/pi-cli-regression.mjs`；证据见 `docs/releases/v1.1-pi-knowledge-research-suite.json` |
| 公共 `@gyoungwe/pi-*` 包 | **core/knowledge/research 修复版已公开发布** | `plugin-api@1.0.0`、`pi-core@0.1.0`、`pi-knowledge@0.1.1`、`pi-research@0.1.0`、`research-suite@0.1.2` 已发布；research-suite tarball 捆绑四个依赖，公开 registry metadata/shasum/integrity、干净克隆 build/check 和真实 CLI 回归通过；`research-suite@0.1.1` 已按“与 pi-core 冲突，无法启动”弃用 | analysis/evidence/connectors 按 v1.1 规划 |
| 宿主 / 插件仓库边界 | **骨架、合同、公开发布和 pi-knowledge 删除已完成** | `../drone-plugins` 多包 workspace、manifest 检查、plugin-api migration gate、research-suite bundle gate；宿主不再保留 `packages/pi-knowledge` 兼容副本 | Desktop/Pi 只从已安装 npm 包加载；继续推进 v1.1 插件拆分 |
| 菜单信息架构 | **UI-1～UI-7 已实现；与设计稿的视觉对照 NOT_RUN** | 新任务/知识库/技能与连接/主机、项目/最近和右栏数据投影已集成；尚未完成真实桌面截图 | 在可启动 GUI 会话中补做四视口截图和 loading/empty/error/disabled 状态走查 |
| `DroneHostPort` 与通用能力协商 | **首版已实现** | `@gyoungwe/plugin-api`、HostPort、manifest capability check、兼容性测试和迁移闸门 | 完成所有插件迁移与真实宿主加载验收 |
| LAN 最终移除 | **已完成** | LAN 源码、生成运行时、入口、manifest、测试和索引均已清理（`8d4ad219`、`9af99382`、`c99432d0`） | 不再列入验收矩阵或发布承诺 |
| 真实桌面发布候选 | **本机构建产物验收已通过** | `check:desktop-artifact --strict` 16/16、四视口 4/4、0 `FAIL`、0 `NOT_RUN`；main `b4b15427` 的 artifact SHA-256 `7aad377f5f3ec87d42eb1a48358bcd81c0de0165016d1649cd192f8c5b19de46` | 交互式 Electron 在当前 shell 的 NSApplication 阶段 SIGABRT；按当前口径不作为构建产物门槛 |

## 3.2 插件化红线快速清单

以下项目是最终插件化方案的发布红线。状态为“已实现”只代表代码或自动化验证存在，仍须完成真实桌面操作才能变为 `PASS`。

| 编号 | 操作 | 通过证据 | 当前状态 | 下一步 |
|---|---|---|---|---|
| `UI-01` | 设置 → 高级 → UI 插件：启用插件，观察真实 slot/panel/headless 效果；关闭、重载、重启 | 槽位/面板真实变化、关闭后消失、配置持久化、插件错误可见 | **PASS（真实宿主 + renderer registry lifecycle）**；`ui-acceptance.test.ts` 与 `check:ui-skill-acceptance` 已通过 | 交互式 Electron 截图仍受当前 macOS shell `NSApplication` 阶段阻塞；不改变本机构建产物和宿主 gate 结论 |
| `MEM-01` | `memory-note.md` 写入 `DRONE-MEM-001`；会话 A 总结并关闭；会话 B 选择 topic 继续；修改源后再次恢复 | `mem-gate.test.mjs` 与 Node `os.tmpdir()` 下的 evidence JSON：恢复标题/摘要/未解决问题/来源，context 命中 marker，源变更显示 `stale/changed` | **PASS（隔离跨实例验收）** | 继续复跑根门禁；不触碰正式 Vault |
| `SKILL-01` | 启用 `research-workflow` 或实际安装 skill，用 `/skill:<name>` 或研究问题触发；禁用自动调用后重试 | 真实 invocation、名称/参数、调用次数/最近使用、技能要求的结果结构；自动禁用后不再被模型选择 | **PASS（真实 Pi SDK + faux provider）**；2/2 用例通过，证据写入 Node `os.tmpdir()` | `disable-model-invocation` 保留显式手动 `/skill:`，UI 需展示 manual-only 而非误报完全不可用 |
| `MCP-01` | 启用本地 MCP 的 `echo_marker`，要求只返回 `DRONE-MCP-001`；关闭服务并重载后重试 | 连接状态、真实 tool call、唯一返回值、关闭后的 unavailable/blocked | **PASS（隔离真实 SDK fixture）**；启用→真实调用→关闭→重载已覆盖，关闭后 adapter 无 server/tool 或明确 disabled | 作为根门禁 `check:remaining-gates` 持续复跑 |
| `CONN-01` | 启用连接器搜索唯一测试词，关闭后再次搜索 | source ID、URL、访问时间、调用记录；关闭后不再调用该连接器 | **PASS（只读 CapabilityResearchPorts fixture）**；唯一词 `DRONE-CONN-01-UNIQUE` 的 source receipt/URL/调用记录可回读，关闭后跳过传输，重新启用可重试 | 保持只读；外部写入不在本门槛范围 |
| `WRITE-01` | 对 Zotero/WebDAV 执行授权→写入→回读→删除→再回读 | 外部对象 ID、回读内容、删除确认、审计记录 | **PASS（WebDAV + Zotero）**；Protocols.io 只读 | 保留无凭据回执；Protocols.io 写入不在当前计划范围 |
| `REDLINE-01` | 注入缺来源、数字篡改、方法漂移、重复数不足、断线、拒绝和 stale source | `npm run check:redline`；每类 fixture 均有阻断状态、原因、证据差异和 sealed 审计 ID | **PASS（隔离领域验收）** | 如需 GUI 走查，沿用同一 proof 投影；不作为本机构建产物降级判定 |

## 3.3 执行前清单

验收负责人在开始 C01 前逐项勾选；任何一项未满足都只能记录为 `BLOCKED` 或 `NOT_RUN`：

- [ ] 使用隔离的 HOME、Electron userData、Pi agentDir、knowledgeDir 和临时项目。
- [ ] 记录 candidate commit SHA、构建产物 hash、Pi host 版本和插件版本；当前正式基线为 Pi `1.1.0`。
- [ ] 确认测试环境没有正式 Vault、session 正文、凭据、`results/` 或本机私有状态可被读取。
- [ ] 准备 `memory-note.md`、`DRONE-MEM-001`、本地 `echo_marker` MCP、`DRONE-MCP-001` 和唯一连接器搜索词。
- [x] 对外部写入测试准备临时 WebDAV 与 Zotero 目标，并确认测试后可以删除和回读确认不存在；Protocols.io 维持只读。
- [ ] 准备截图、日志、任务 ID、`runAttemptId`、revision/ETag/SHA-256、外部对象 ID 和审计记录的存放位置。
- [ ] 确认每次启用、写入、远程执行、删除、安装和发布操作都有明确用户授权。
- [ ] 准备宿主与插件的 `npm pack` 产物或隔离 registry，并记录 package hash、manifest 和 peer dependency 解析结果。

## 4. v3 结果红线

结果红线优先于 UI、任务状态和模型回复。只要触发任意一条，结果不得进入 `verified`、`answerable`、`completed` 或公开交付状态；界面必须显示实际限制和下一步。

### 4.1 证据与主张

- **Evidence before claim**：重要结论必须绑定当前运行的来源、测量值、脚本结果或明确的未知标记。
- 每个数字必须能在已引用产物中找到，并匹配声明的舍入规则。
- 引用产物的 checksum 必须仍然有效；stale checksum、缺失来源或 claim drift 必须阻断发布。
- 方法描述必须对应实际执行的 workflow、模块、参数和版本，不能只根据计划文本推断“已执行”。
- 没有当前轮搜索、读取回执和稳定来源 hash，不能发布知识库支撑的最终回答。
- 搜索零命中只能表示“当前库没有匹配”，不能表示全球不存在或科学结论为假/为真。
- 子代理、语义命中、topic 摘要、UI 预览和工具结果只能作为导航或未复核材料，不能转移父会话的 evidence receipt。

### 4.2 科学分析结果

- 任一比较组少于两个生物学重复时，推断性分析必须暂停；允许继续的探索性结果必须明确标注，禁止产生推断性结论。
- 未解析的 contrast 必须暂停；未解析的 reference/database release 必须阻断。
- 探索性、被推翻、unstable、sensitive 和未经人工确认的 finding 不能进入验证性结论。
- 方法、数值、标签或控制结果不一致时，发布门禁必须拦截，不得用模型解释掩盖不一致。
- 编译成功、命令生成成功、计划生成成功不等于实际执行成功。
- 真实任务缺少数据、基线、容器或执行器时，必须返回 `needs-data`、`needs-container` 或 `blocked`，不能返回零分或成功。
- discovery 的 prior 必须先于 posterior；意外度只影响线索和检验顺序，不能提高 finding 可信度。
- 关键 finding 需要规定数量的替代路径并记录 `robust`、`sensitive`、`unstable` 或 unknown；critic 不能替代人工复核。

### 4.3 运行状态与副作用

- `unknown`、`pending`、超时、取消、断线和 provider error 不是成功。
- 远程任务身份未解析前不得自动重复提交；必须先 reconciliation，或明确显示 blocked。
- 未授权的写入、远程执行、覆盖、删除、安装和发布必须阻断。
- 失败 validator、过期 checksum、重复失败签名、预算超限、缺失快照或未经授权的远程副作用必须阻断完成。
- 重试必须创建可追踪的子 attempt 或因果链，不得覆盖原始失败记录。
- 交付前必须保留任务、输入、能力版本、workflow、环境、产物和审查记录的关联。

### 4.4 桌面端必须呈现的结果状态

桌面端至少支持并准确显示以下状态：

| 状态 | 含义 | 禁止行为 |
|---|---|---|
| `observed` | 主机或工具实际观察到的事实 | 不得直接写成科学结论 |
| `verified` | 通过来源、产物、版本和校验门禁 | 不得缺少证据链 |
| `exploratory` | 可供探索的结果或线索 | 不得进入验证性结论 |
| `unreviewed` | 子代理或模型产生、尚未由父流程复核 | 不得当作父会话回执 |
| `pending-review` | 等待人工或模型审查 | 不得发布或交付 |
| `stale` | 来源、绑定或 hash 已变化 | 不得继续复用为当前事实 |
| `unknown` | 运行或外部副作用尚未确认 | 不得重试或标记成功 |
| `blocked` | 触发数据、权限、方法或安全门禁 | 不得用空结果代替 |
| `needs-data` / `needs-container` | 缺少必要数据或执行环境 | 不得计为回归通过 |

**红线验收操作**：在真实桌面端分别制造缺少来源、数字篡改、方法版本不匹配、重复数不足、未解析 contrast、远程断线、权限拒绝和 stale source。预期结果必须是对应的阻断状态、原因、证据差异和下一步，而不是成功卡片。

**红线通过标准**：所有注入的违规结果都被阻断；阻断原因能在 UI 和审计记录中定位；修复或人工确认后才能继续；被阻断的草稿正文不会以“已验证结果”形式泄露。

## 5. 能力验收矩阵

### C01 项目启动与研究任务

**桌面操作**

1. 启动隔离的打包 Drone。
2. 创建或打开临时项目。
3. 从任务页签或 `/` 菜单选择示例任务。
4. 输入一个真实研究目标并开始。

**预期返回**

- 创建会话、任务和 `runAttemptId`。
- 页面显示目标、当前阶段和下一步操作。
- 任务进入 `queued` 或 `running`。
- 关闭并重开项目后任务仍可见。

**通过标准**

- 任务存在于持久化状态，不只是 renderer 内存。
- 会话状态、任务状态和运行回执一致。
- 返回任务 ID、runAttemptId 和创建时间。

### C02 方案提议与授权

**桌面操作**：输入存在多种实现方式的任务，查看 Proposal Card，比较推荐方案和替代方案，选择方案，并逐项授权联网、写入、远程执行等副作用。

**预期返回**：方案卡显示依据、收益、代价、风险、预算和副作用；授权前动作保持 pending；授权后进入执行。

**通过标准**：授权前没有副作用；方案、输入、预算和能力版本可追踪；方案变化后旧授权失效；支持自定义回答。

### C03 Skills 实际生效

**桌面操作**：打开 Tools & Skills，确认 `research-workflow` 或一个实际安装的 skill 存在；启用它，重载能力配置，在会话中用 `/skill:<name>` 或能路由到该 skill 的研究问题触发，打开 Run Inspector；随后禁用该 skill 并用同一请求重试。

**预期返回**：状态变为 Active；真实出现 skill invocation；invocation count/last use 更新；Agent 返回 skill 要求的结构（如来源、证据和限制）；Inspector 显示名称、参数和时间；禁用后显示不可用或不再产生该 invocation。

**通过标准**：启用、调用、结果和审计记录同时存在；禁用后不能继续假装可用；失败时显示真实失败原因。唯一的页面状态不能作为通过证据。

### C04 MCP 与连接器实际生效

**桌面操作**：在设置 → MCP 添加或启用隔离的本地测试 MCP 服务；服务提供 `echo_marker`，固定返回 `DRONE-MCP-001`。刷新状态后要求 Agent 调用该工具并只回复返回值；关闭服务、重载，再执行同一请求。

**预期返回**：MCP 面板显示已连接；聊天和 Inspector 显示真实 `echo_marker` tool call；最终收到 `DRONE-MCP-001`；关闭后显示工具不可用、blocked 或明确的未配置状态，不能返回旧值。研究连接器还必须显示版本、scope、最近调用时间和真实对象 ID/版本/状态。

**通过标准**：状态变化来自真实 IPC/backend；唯一返回值来自 MCP 服务；关闭连接器后调用被拒绝或明确降级；没有只显示成功 toast 的假通过。

### UI-01 UI 插件运行时效果

**桌面操作**：打开设置 → 高级 → UI 插件，启用一个内置 UI 插件；回到真实会话观察其 slot、panel 或 headless 行为；关闭总开关或单个插件，重载应用并重启。

**预期返回**：启用后真实 UI 或无头行为出现；关闭后行为消失；重载/重启后配置保持；构建失败或插件崩溃显示错误状态并保留宿主回退。

**通过标准**：必须能从真实槽位、面板或事件行为证明插件已生效；不能只根据插件卡片的 enabled 字段通过；插件失败不能阻断核心聊天。

### C05 Zotero 读写闭环

**桌面操作**：打开 Zotero 面板，刷新状态，授权创建唯一标记的临时 note，创建、回读、删除，再次搜索确认不存在。

**预期返回**：返回真实 note ID；回读内容包含唯一标记；删除成功；再次查询返回不存在；审计记录包含创建、回读、删除。

**通过标准**：外部 Zotero 中确实产生过对象；回读来自 Zotero 而不是缓存；删除后 UI 不保留旧对象；凭据不出现在会话或诊断中。

### C06 WebDAV 写入与冲突

**桌面操作**：配置临时 WebDAV 目录，探测连接，创建临时知识条目，Push，清理本地缓存后 Pull，再制造远端修改并再次 Push。

**预期返回**：显示远端状态；Push 返回 revision/ETag/hash；Pull 得到远端内容；并发写入显示 conflict；用户可选择本地或远端版本。

**通过标准**：远端确实存在文件；Pull 不是本地缓存；冲突不被静默覆盖；revision/ETag/hash 可核对；清理后不显示旧内容。

### C07 知识沉淀与记忆复用

**桌面操作**：在临时项目写入 `memory-note.md`，内容包含唯一值 `DRONE-MEM-001`。会话 A 读取并总结主题，查看来源和新鲜度后关闭应用；新建同项目会话 B，在知识库“主题”中选择该主题并继续；修改 `memory-note.md` 后再次恢复。

**预期返回**：会话 B 恢复主题标题、摘要、未解决问题和来源文件；Agent 能回答 `DRONE-MEM-001`；Run Inspector 显示恢复了 topic context；源修改后显示 `stale/changed`，并重新读取来源，而不是继续相信旧内容。

**通过标准**：跨会话、跨重启复用成功；内容可追溯到当前源；语义命中不会直接制造 evidence receipt；源变更后旧知识不能冒充最新事实；只有“模型似乎记得上一句话”不能通过。

### C08 跨会话 Topic Continuity

**桌面操作**：会话 A 创建唯一主题；会话 B 测试唯一名称、模糊名称、多候选和无匹配；再切换项目或 Vault 重试。

**预期返回**：唯一命中直接恢复；多候选显示选择；无匹配明确提示；跨 scope 时拒绝错误复用。

**通过标准**：不因相似名称误恢复；主题带项目/Vault 绑定、版本和来源；绑定失效时要求重新确认。

### C09 未知生信流程生成能力

**桌面操作**：上传没有预置 adapter 的小型 fixture，输入分析目标，查看 capability gap，允许 Agent 研究文档并生成候选 adapter/workflow，执行静态、fixture 和科学验证。

**预期返回**：先显示未知流程；返回候选能力、依赖、风险和验证状态；生成 validation capsule；状态为 `recommended`；用户授权后才可执行。

**通过标准**：未知流程不能绕过验证；adapter、workflow、方法版本和输入 manifest 进入 provenance；验证失败不能标记为推荐；推荐、注册、启用、执行分开记录。

### C10 计算主机与远程任务

**桌面操作**：添加主机，执行健康检查，设置预算和路径，提交任务，查看日志，取消任务，模拟断线后重开应用。

**预期返回**：显示主机健康状态和 job ID；任务经历 queued/running/completed 或 failed/cancelled；日志更新；重启后恢复状态。

**通过标准**：授权、预算和路径在提交前检查；取消后不报告成功；unknown 状态不自动重复提交；恢复有新的因果链记录。

### C11 产物、Checkpoint 与 Evidence Capsule

**桌面操作**：完成产物任务，打开 Artifacts/Evidence，查看 hash 和 provenance，冻结 checkpoint，创建分支，导出并在隔离项目中导入 replay。

**预期返回**：显示路径、大小、SHA-256、workflow/code digest；checkpoint 变 immutable；分支不继承执行授权；导入重新校验 manifest 和字节 hash；replay 返回匹配状态。

**通过标准**：产物被修改后检测 hash 不匹配；capsule 不含凭据和私有状态；replay 失败不能显示成功；产物可以从桌面端重新打开。

### C12 Run Inspector、Harness 与长会话恢复

**桌面操作**：完成至少 20 轮真实交互，查看工具、子代理、耗时和 token；触发压缩或蒸发；关闭应用并继续原任务。

**预期返回**：每轮有公开阶段和工具回执；显示 compaction/recovery；重启后恢复正确阶段；不重复外部副作用；runAttemptId 和因果链连续。

**通过标准**：真实运行和历史回放使用同一状态语义；取消、重试和恢复可追踪；不暴露私有 chain-of-thought；不会因重启重复提交。

### C13 权限、可信项目和安全边界

**桌面操作**：在新项目执行文件访问、项目外访问、网络、写入和远程操作，分别选择允许、拒绝和取消，查看权限审计。

**预期返回**：出现 trust/permission 对话框；拒绝显示原因；允许只作用于当前 scope；审计显示命中规则、时间和结果；完全访问模式有警示。

**通过标准**：拒绝后没有副作用；权限不静默跨会话继承；危险动作需要确认；诊断导出不含 secret、session 正文或私有路径。

### C14 UI 状态、术语与可访问性

**桌面操作**：走查首次打开、空态、加载、运行、失败、冲突、禁用、长路径；切换中英文、浅深色、200% 缩放、键盘和 reduced-motion。

**预期返回**：每种状态有标题、原因和下一步；术语面向科研用户；Graph、WebDAV、Review、Evidence 状态一致；键盘可访问主要控件。

**通过标准**：不只用颜色表达状态；Enter/Space/Escape/Tab 行为正确；Graph 节点可被键盘和读屏访问；实际行为与文案一致；菜单分组清晰但不要求视觉重做；旧入口的兼容跳转可用；插件未配置或不兼容时有明确状态和回退。

### C15 打包应用与发布候选

**桌面操作**：用候选 commit 构建宿主和插件包，在隔离环境首次启动 Drone；从 `npm pack` 或临时 registry 安装插件，创建项目并完成最小示例任务，打开核心面板，重启并恢复；随后禁用、卸载并重新安装一个插件。

**预期返回**：renderer、preload、backend、宿主 adapter 和插件均可加载；插件只通过公开 API 工作，没有源码相对路径依赖；不会继承正式凭据；任务和本地状态可恢复；禁用/卸载后核心宿主仍可用；资源、manifest 和版本 hash 一致。

**通过标准**：不能只通过 build；必须完成打包应用首次启动、插件安装、启用、禁用、卸载、重新安装和重启；不读取正式 Vault；candidate SHA、生成物 hash、插件 manifest、测试摘要和包 hash 一致。

## 6. 端到端总体验收

完成 C01–C15 后，执行一条连续用户路径：

1. 创建研究项目和示例任务。
2. 查看方案卡并授权。
3. 使用真实 skill/MCP。
4. 读取并复用知识和 Zotero 内容。
5. 发现未知生信流程并生成推荐能力。
6. 授权并提交计算。
7. 查看过程、日志、产物和 evidence capsule。
8. 冻结 checkpoint 并导出。
9. 重启应用。
10. 新会话复用记忆和 topic。
11. 回读结果并完成交付。
12. 删除所有临时外部对象。
13. 导出审计记录。

整体验收通过必须满足：每一步都有真实操作、可观察返回、授权记录和可追踪证据；重启后状态连续；记忆被新会话正确复用；skill、MCP、连接器的 UI 状态与实际行为一致；失败、拒绝、冲突和 unknown 状态均被正确呈现。

## 7. 验收执行顺序

1. **环境门禁**：隔离 profile、临时项目、无正式凭据、版本和 candidate SHA 记录。
2. **桌面基础能力**：C01、C02、C03、C04、`UI-01`、`SKILL-01`、`MCP-01`、C13、C14。
3. **知识与连接器**：C05、C06、C07、C08、`MEM-01`、`CONN-01`、`WRITE-01`。
4. **科研执行能力**：C09、C10、C11。
5. **可靠性**：C12。
6. **结果红线**：`REDLINE-01`，逐项注入违规并检查阻断和审计。
7. **打包与发布候选**：C15。
8. **端到端路径**：执行第 5 节。
9. **静态和自动化门禁**：`npm run lint`、`npm run typecheck`、`npm test`、`npm run build`、`npm run check:arch`，以及项目要求的 `npm run test:upgrade`。

自动化命令全部通过但 C01–C15、`UI-01` 或红线快速清单中的任一能力没有真实返回时，整体验收仍不能通过。LAN 不属于最终插件化方案，不再列入验收矩阵或发布承诺。

## 8. 单项验收记录模板

```text
能力编号：C__
能力名称：
候选版本 / commit SHA：
测试环境：隔离 HOME / userData / agentDir / knowledgeDir
桌面操作：
预期返回：
实际返回：
任务 ID：
runAttemptId：
revision / ETag / SHA-256：
外部对象 ID：
证据文件或截图：
状态：PASS / FAIL / BLOCKED / NOT_RUN
失败原因或阻塞条件：
下一步：
```

## 9. 最终通过条件

- C01–C15 全部为 `PASS`，或明确记录可接受的 `BLOCKED` 并由维护者单独签字；`UI-01`、`MEM-01`、`SKILL-01`、`MCP-01`、`CONN-01`、`WRITE-01` 和 `REDLINE-01` 必须有真实证据。
- 任何真实写入、远程执行、删除、安装和发布动作都有授权和回读证据。
- v3 结果红线的违规注入用例全部被阻断，不能把 `observed`、`exploratory`、`unknown`、`blocked` 或 `pending-review` 当作 `verified`。
- 没有 UI 成功但 backend 未执行的假通过。
- 没有凭据、session 正文、正式 Vault 或私有结果泄露。
- 完整自动化门禁通过。
- 端到端用户路径通过。
- 验收报告明确区分实现完成、本地自动化通过、真实桌面通过和公开发布状态。

## 10. 2026-10-18 UI-01 / SKILL-01 真实宿主验收记录

执行 `npm run check:ui-skill-acceptance -- --out /private/tmp/drone-ui-skill-acceptance.json`，两个门槛均通过：

- `UI-01`：`packages/desktop/src/main/ui-plugins/ui-acceptance.test.ts` 使用随包 `ds-whale-maid`，由 `UiPluginManager` 在隔离 userData 中真实导出、构建并动态导入 `dist/index.js`；renderer registry 观察到 `app.overlay` contribution 出现，禁用后移除，重新启用后 `loadNonce` 从 1 增至 2，新的 manager 实例回读 `enabled/trusted/built` 配置。该证据证明宿主与 renderer lifecycle 已闭合，不把插件卡片的 enabled 字段单独当作通过。
- `SKILL-01`：`packages/backend/test/skill-acceptance-sdk.test.mjs` 使用真实 Pi SDK `SessionService/PiBackend` 与 offline faux provider，执行 `/skill:research-workflow summarize the evidence boundary`，回读 canonical `<skill>` user message、visible skill、system prompt 和 provider call；第二用例验证 `disable-model-invocation: true` 后科研问题不会自动选择该技能且不产生 invocation。Pi 契约仍允许显式 `/skill:research-workflow manual check`，因此 UI 必须标为 `manual-only`，不能误报为完全不可用。SKILL-01 evidence 写入 Node `os.tmpdir()`，以保持 Windows/macOS/Linux 一致。
- 报告不包含凭据、正式 Vault、session 正文或 `results/`；provider 网络被关闭，插件和技能均来自仓库/随包资源。

当前 shell 的交互式 Electron 仍在 macOS `NSApplication init/RegisterApplication` 阶段 `SIGABRT`，因此没有新增 GUI 截图；这作为 GUI 环境观察 `BLOCKED` 单独记录，不改变上述 UI-01 宿主 lifecycle 或 SKILL-01 SDK 结论，也不改变本机构建产物的 `PASS`。

## 11. 2026-10-18 本机构建产物验收记录

正式桌面验收口径为本机构建产物，不把交互式 Electron 启动称为降级。main `b4b15427` 执行 `npm run build && npm run stage:pi-packages && npm run check:desktop-artifact -- --strict`：16/16 检查通过，Home、Knowledge、Skills/Connections、Hosts/Right panel 四视口合同 4/4 通过，`FAIL=0`、`NOT_RUN=0`；产物快照 SHA-256 为 `7aad377f5f3ec87d42eb1a48358bcd81c0de0165016d1649cd192f8c5b19de46`。检查覆盖 main/preload/renderer、CSP/entry、UI 插件启停合同、skill/MCP/connector/memory/结果红线资源和已 stage 的 MCP 资源。

交互式 Electron 仍在当前 shell 的 macOS `NSApplication init/RegisterApplication` 阶段 `SIGABRT`，没有建立 CDP；这只记录为可选的 GUI 环境观察，不改变构建产物 `PASS`，也不阻断本计划的本机构建验收。

## 12. 2026-10-18 WebDAV 写入闭环记录

在允许访问内网目标的隔离进程中，通过 Drone 的 `KnowledgeWebDavService` 对
`http://10.126.126.1:8080/Drone-Knowledge` 完成真实验收：probe 返回
`ready/reachable/authenticated`；创建唯一临时对象
`Inbox/DRONE-WEBDAV-1792257377294.md`；服务层回读文本、字节数和 SHA-256 与写入内容一致；随后执行删除，HTTP 返回 204；再次通过服务层读取返回 `not_found`。本次 receipt hash 为
`2b2695bfa41fe29f9477796e2413f5446b6eabfd3dafa8351c0268c72f151d27`。凭据只存在于进程环境，没有写入仓库、日志或验收文档；Protocols.io 继续保持只读策略。


## 13. 2026-10-18 收口补充

- LAN 清理已完成，源码、生成运行时、入口、manifest、测试与索引均无残留。
- WebDAV 与 Zotero 均完成授权→创建→回读→删除→再回读；Protocols.io 按计划保持只读。
- `check:plugin-api --migration --lifecycle` 的本地 pack 安装→升级→回滚→卸载通过；`research-suite@0.1.2` 的 Pi `1.1.0` 与 latest `1.3.0` 真实 CLI 矩阵通过，旧版冲突负例为 EXPECTED_FAILURE。
- 正式桌面门槛为本机构建产物：16/16、四视口 4/4、0 `FAIL`、0 `NOT_RUN`。交互式 Electron SIGABRT 不计为降级。
- `MEM-01`、`MCP-01`、`CONN-01`、`REDLINE-01` 均已通过隔离真实行为验收；Protocols.io 继续只读，不能把静态资源通过替代外部写入证据。

## 14. 2026-10-18 剩余门槛复跑

`npm run check:remaining-gates` 已集中复跑四条门槛：MEM-01 的 1 个跨实例夹具、REDLINE-01 的 4 个违规夹具、MCP-01 与 CONN-01 的 2 个 SDK/只读连接器夹具全部通过。随后复跑 `npm run lint`、`npm run typecheck`、`npm test`、`npm run build`、`npm run check:arch`、`npm run test:upgrade`、`npm run check:plugin-api`、`npm run check:pi-compat` 和 `npm run check:desktop-artifact -- --strict`，均通过；桌面本机构建产物为 16/16、四视口 4/4、0 `FAIL`、0 `NOT_RUN`。Protocols.io 仍保持只读，未执行外部写入；npm scope 与公开发布继续单独待决，证书/正式签名不属于计划门槛。

## 15. 2026-10-18 Pi 真实模型兼容矩阵

历史证据文件 `/private/tmp/drone-pi-real-matrix-ksVolq/pi-real-matrix-evidence.json` 中的组合 FAIL 仍保留作问题定位；当前证据见 `docs/releases/v1.1-pi-knowledge-research-suite.json` 和 `/private/tmp/drone-pi-cli-regression-final.json`。后者使用独立 `HOME` / `PI_CODING_AGENT_DIR`，真实安装公开 tarball 后执行 `pi -p --no-session /task-status`，不通过 DefaultResourceLoader 代替；新包两版 PASS，旧包两版以 `conflicts`/退出 1 为 EXPECTED_FAILURE，不含凭据或会话正文。

## 16. 2026-10-18 v0.33.0 无证书跨平台发布

正式 Release run [`39066841689`](https://github.com/Gyoungwe/Drone/actions/runs/39066841689) 在 macOS arm64/x64 与 Windows x64 上完成 validate、Nature/Scientific skill pack 校验、unsigned Electron build、MCP 资源校验和资产上传；三平台 job 均成功，Release [`v0.33.0`](https://github.com/Gyoungwe/Drone/releases/tag/v0.33.0) 已从 draft 发布为正式版本。资产包含 `drone-mac-arm64.dmg/.zip`、`drone-mac-x64.dmg/.zip`、`drone-windows-x64.exe/.zip`、对应 blockmap 以及 `latest.yml` / `latest-mac.yml`。本版本不要求证书或正式签名；操作系统信任提示仍按无证书策略保留。
