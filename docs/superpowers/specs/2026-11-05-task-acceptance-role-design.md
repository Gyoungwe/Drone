# 跨插件验收器角色（P4 §5.2 第 3 项）

日期：2026-11-05。状态：**部分确认，尚未实现**：用户已选决定 1 的方案 A（2026-11-05）；决定 2、3 待确认。依据：[P4 交接](../../handoff-2026-10-29-p4.md) §5.2、[动态 owner 设计](2026-10-28-task-managed-owner-cutover-design.md)“acceptance/verifier”一行、[宿主任务授权](2026-10-29-host-task-grant-design.md)。

## 要解决的问题

任务里程碑除 `file`、`human_review` 外，还有其他插件提供的验收种类。进程内版本靠 `pi.events` 把函数对象交给任务插件；受管插件之间没有事件总线，也传不了函数。结果是受管任务不认识这些种类，切换后依赖它们的任务无法规划。

要求（来自已确认的设计）：验收逻辑在提供者 owner 内执行；宿主复核来源与会话；JSON 里的 `verified: true` 不构成凭据；提供者停用后不能继续算通过；宿主不解析任何领域数据，也不写可选插件的名字。

## 核对过的现状

**只有两个验收器，且都不在受管路径上：**

| 种类 | 位置 | 用到的成员 | 受管现状 |
| --- | --- | --- | --- |
| `wiki_review` | `pi-knowledge/.../internal-knowledge-extension.ts` | `observe` `resolve` `pending` `label` `acknowledgeError` | 受管时 `session-ports.registerAcceptance` 只把定义存在本地，没人消费 |
| `zotero_item` | **宿主** `packages/extensions/src/zotero-literature.ts`（构建到 `.pi/extensions/`，进程内加载） | `fields` `verify` `identify` `consent` `pending` `label` | 没有受管版本；`pi-research` 的 `desktop/runtime.ts` 也没有 Zotero 工具 |

**成员分三类，这决定了设计的形状：**

| 类别 | 成员 | 调用方式 | 跨进程的难点 |
| --- | --- | --- | --- |
| 静态数据 | `fields` `evidenceKind` `operationVerifier` `acknowledgeError` | 读字段 | 无 |
| 同步纯函数 | `label` `consent` `pending` | 在 `authorization()`、渲染里**同步**调用 | 同步路径不能发 RPC |
| 需要事实的调用 | `verify` `resolve`（已是 async）；`observe` `identify`（同步，吃工具事件） | 在 actor 回合内 | `identify` 决定“这个里程碑对应哪篇文献”，事件不能由调用方转述 |

**还有三个交接文档没提到的约束：**

1. **依赖是双向的。** Zotero 写入工具通过 `drone:task-write-consent` 反查“当前任务授权是否点名了这个 DOI / 还有没有空槽位”（`taskConsentFor`）。只做任务 → 验收器一个方向，切换后 Zotero 写入就失去任务授权，会退回逐条弹窗。
2. **现有 `provider.*` 装不下。** `drone.requires` 要求每个依赖写一个 alias，而任务插件不能预知有哪些验收插件；同一服务多个提供者又判定为 `ambiguous`。
3. **`task_plan` 的 schema 是活引用。** 进程内靠共享对象让后加载的种类出现在 schema 里；受管工具 schema 在注册时序列化成 JSON，活引用失效。

## 方案（推荐）

### 1. 声明：沿用 `drone.provides`，消费方按前缀枚举

不新增第二个目录。提供者每个种类声明一个服务：

```json
"provides": { "task.acceptance:zotero_item": { "version": 1, "operations": ["describe", "verify", "identify"] } }
```

消费者声明一个角色，而不是具体的包：

```json
"consumes": { "acceptance": { "servicePrefix": "task.acceptance:", "version": 1 } }
```

宿主新增一个通用能力 `provider.enumerate({ role })`，从同一份已安装来源目录返回每个成员的状态（沿用 `available/ambiguous/...` 语义）和来源哈希；`provider.read` / `provider.native` 增加 `{ role, member }` 寻址，复用现有的租约、循环检测与调用后来源复核。宿主层只认“前缀 + 版本”，不出现 Zotero、Wiki 或验收的语义。同一种类两个提供者时该种类为 `ambiguous`，规划时拒绝。

### 2. 插件侧：远程验收器适配

`createTaskWorkbench({ verifiers })` 已经接受注入的验收器，受管 ports 提供一个 `remoteVerifier(kind)`，形状与现有定义一致，workbench 的算法基本不动：

| 成员 | 受管实现 |
| --- | --- |
| 静态数据 | `describe(null)` 的结果，每次 `attach` 刷新 |
| `label` `pending` `consent` | 规划、绑定、换绑时调 `describe({ acceptance })` 预取并缓存；同步路径只读缓存。缓存缺失时 `label` 显示种类名，`consent` 返回 null（**不放行**） |
| `verify` `resolve` | `provider.read`，每次都走 RPC，上下文只传 `cwd`，不再传整个 `task`（现有两个验收器都用不到） |
| `identify` `observe` | `provider.native` + `tool_execution_end`，见第 3 节 |

`verify` 的结果仍按现有逻辑落进里程碑证据，但只是观察记录：重开会话后重新核对，不恢复为通过。提供者不可用时 `verify` 返回 `{ state: "unknown", reason: "verifier-unavailable" }`，里程碑进入 `blocked`，任务不能完成。

`task_plan` 的受管 schema 放开 `acceptance` 的种类枚举和扩展字段，在执行时按 `provider.enumerate` 校验；可用种类及其字段写进 `before_agent_start` 的任务上下文，让模型看得到。

### 3. 事件身份：由宿主传递真实事件

`identify` 决定里程碑绑定哪篇文献，不能由任务插件把事件转述给提供者。`provider.native` 已经是这个语义：接收方拿到的是宿主持有的当前 SDK 事件，调用方传不进伪造内容。

所以受管任务在 `tool_execution_end` 钩子里调用 `identify`/`observe`，再把结果交给 journal。工具结果此时已定稿，比 `tool_result` 更可靠。代价是 workbench 要把 `observe` 中的身份绑定拆成独立步骤，原生路径行为不变。

### 4. 反向：提供者读宿主授权，而不是问任务插件

这是唯一新增的授权相关内容，遵守“授权只能由宿主产生”：

- `task.grant.request` 增加 `acceptances`，每项 `{ kind, milestoneId, consent }`。**宿主把它们渲染进授权对话框**，签发时绑定当时的提供者来源哈希。
- 新能力 `task.grant.acceptances`：提供者只能读到自己声明种类的条目，且限于同会话、来源未变。
- 新能力 `task.grant.claimSlot({ milestoneId })`：空槽位由宿主记录，每个放行一次，替代现在进程内的 `slotClaims`。失败可释放。
- 换绑（`rebind`）改变点名的 DOI，等于扩大授权，因此走新的 `task.grant.amend`，由宿主弹框确认。用户看到的和今天的换绑确认卡一样多，只是渲染方换成宿主。

提供者停用或升级后，它的条目随来源哈希变化失效，需要重新授权。

## 需要你决定

1. **Zotero 放在哪一步？** `zotero_item` 依赖 Zotero 工具本身迁出宿主，而那属于排在后面的 P3。
   - **A（推荐）**：把 Zotero 工具和验收器这一小片提前到 P4，迁入 `pi-research` 受管运行时。这样 §5.3 的 Zotero 示例任务能真实通过，旧桥也能一次删干净。代价是 P4 变大，且受管进程里跑 Zotero 写入（本机 API、MCP 子进程、`worker_threads` 限制）还没验证，要先做一次探查。
   - **B**：P4 只交付机制和 `wiki_review`，切换时 `zotero_item` 明确报“不可用”，直到 P3 完成。P4 小得多，但 P3 之前依赖 Zotero 的示例任务不可用，§5.3 的验收要相应减项。
   - 不建议保留进程内桥接等 P3：这和 §5.3 要删除 `drone:task-write-consent` 直接冲突。
2. **`consumes` + 前缀枚举是否可以？** 备选是专用声明 `drone.acceptanceVerifiers`，更直白，但等于第二个目录，后续其他角色还要再加。我推荐前者。
3. **`rebind` 走宿主弹框是否可以？** 这是我唯一改变了“谁来渲染”的用户可见流程。

## 方案 A 的探查结果（2026-11-05）

用锁定的插件运行时（Node 26.12.1）和宿主相同的启动参数实测：

| 能力 | 受管进程内 | Zotero 用在哪 |
| --- | --- | --- |
| 网络（含 `127.0.0.1`） | **拒绝**（`ERR_ACCESS_DENIED`） | 本机 API、Web API、`verify` 的读回 |
| 环境变量 | 清空 | `ZOTERO_API_KEY`、`ZOTERO_LOCAL_API_KEY` 等凭据（宿主启动时注入自身 `process.env`） |
| 包外读写文件 | 拒绝 | 附件 PDF、`results` 下的 run 日志 |
| 子进程 | 拒绝 | `/zotero-setup`、`research_setup_zotero` 安装 zotero-mcp |
| `worker_threads` | 拒绝 | 第 1 项 PDF 身份 |

`--allow-net` 能放行，但没有主机白名单：放开后 `example.com` 同样可达，清单里的 `permissions.network` 并不生效。宿主也没有可复用的网络能力。

所以方案 A 不只是搬代码，还需要：

1. **网络通道**（核心决定，见下）。
2. **凭据**：不进 worker 环境。宿主按清单声明的引用在发请求时附加，插件读不到明文。
3. **附件**：`workspace.readFile` 上限 8 MiB，PDF 可能超出，需要确认上限或改用已验证过多 MiB 的二进制读取。
4. **run 日志**：现在直接写 `results`；受管下 `files.writeText` 每次弹窗，要改走会话记录或声明的状态目录。
5. **跨包引用**：`literatureCard` 来自 `pi-knowledge/host`，红线禁止插件互相 import，要移到公共包。
6. **安装工具**：宿主没有子进程能力。建议 `/zotero-setup` 这组不进本片，留到 P3 决定。

网络通道的选项：

| 选项 | 做法 | 取舍 |
| --- | --- | --- |
| **N1（推荐）** | 宿主通用能力 `network.request`：按清单 `permissions.network` 精确匹配主机，禁止跳转，限制响应大小，按引用附加凭据。非 GET 请求沿用默认审批（有任务授权时覆盖，否则弹框） | 新增一个安全边界，工作量最大；但 P3 的来源连接器同样需要，不算白做 |
| N2 | 声明了网络的来源启动时加 `--allow-net` | 改动最小，但插件可以把内容发到任意主机，等于放弃网络沙箱 |
| N3 | 宿主提供 `zotero.*` 专用能力，沿用 `backend/src/zotero` | 宿主保留领域代码，与 P6 零领域目标冲突 |

用户选 **N1**（2026-11-05）。

### 网络能力合同（N1）

两个宿主能力，与 `provider.read/write` 一样按效果拆开，审批类别各自固定：

| 能力 | 方法 | 效果 / 审批 |
| --- | --- | --- |
| `network.read` | `GET` `HEAD`；以及清单 `drone.networkReads` 列出的只读 POST 端点（`主机[:端口]/路径` 精确匹配，例如 Zotero connector 的 `ping`、`getSelectedCollection`） | read；来源批准时已看过清单，不再逐次弹窗 |
| `network.write` | `POST` `PUT` `PATCH` `DELETE` | write，`approval: "always"`、`readCallable`：宿主授权设计规定“网络写入仍逐项询问”，任务授权不覆盖；声明为读的工具也能请求它，于是对话框是唯一一次确认。对话框显示方法、主机和路径，以及插件附带的 `summary`（标为“插件说明”） |

- **谁能拿到**：清单 `permissions.network` 里除 `configured-services` 以外的条目进入来源 `networkHosts`，参与来源比较（改清单即视为新来源）。列表为空不提供这两个能力。
- **主机匹配**（2026-11-05 定）：精确匹配 URL 的 `host`，即小写主机名加非默认端口。不放行子域名；只写主机名时只放行默认端口，本机服务必须写明端口（研究包改为 `127.0.0.1:23119`，去掉了没有用到的 `localhost`）。自由文本条目（如“host-authorized source and institutional endpoints”）不会等于任何主机，所以不放行任何地址。以后需要通配时可以加新写法，不影响已有清单。事先不知道的地址（如开放获取 PDF 所在的出版社主机）不在清单能表达的范围内，将来需要另加运行时放行机制。
- **固定行为**：`redirect: "error"`（跳转可能离开声明的主机）；请求体与响应体各最多 8 MiB，以 base64 传输；30 秒超时并随调用者信号取消；不允许插件设置 `host`、`cookie`、`proxy-*` 等由宿主或连接决定的头。
- **结果**：`{ status, headers, base64, bytes }`，头名小写。非 2xx 照常返回，由插件按领域语义判断，宿主不解析响应。
- **为什么要 `networkReads`**：宿主对每次写能力调用单独审批；Zotero connector 连只读操作也用 POST，按方法划分会让一次保存弹 3 次框。声明后一次保存只弹 1 次（2026-11-05 用户确认）。
- **本片不含**：凭据引用（宿主在发出时按清单声明附加，插件读不到明文）和授权内免询问（§4 的 acceptance 条目签发一次性令牌，`network.write` 凭令牌放行）。两者都等决定 2、3 确认后再加；在那之前 Zotero 写入每次都会询问。

### Zotero 迁移进度（2026-11-05）

- 已完成：研究包 `src/desktop/capability-fetch.ts`（`fetch` 形状，走 `network.*`）与 `zotero-tools.ts`；受管会话注册 `research_zotero_status`（精简）、`research_zotero_save`（只走 connector）、`research_zotero_update`（无凭据时返回 blocked）。工具声明为读，插件不再自己弹确认；用户在宿主对话框拒绝时回执为 `cancelled / user-declined`。
- 未迁：`research_setup_zotero` 与 `/zotero-setup`（需子进程）、run 日志、流程卡片、`zotero_item` 验收器（待决定 2、3）。
- 待做：宿主凭据引用；Drone 重锁研究包后用真实 SDK 跑真实研究包；切换时从 workbench 清单删除 `zotero-literature.mjs`，避免同名工具。
- 已知限制：Web API 附件的上传地址事先未知、上传需超过 30 秒；写入被拒后核心代码仍读回 4 次（约 2 秒）才返回。

## 仍需验证（实现前用真实 SDK 确认）

- `provider.enumerate` 能否像 `provider.inspect` 一样在 bootstrap 期调用。不能的话，枚举推迟到第一个钩子。
- 受管 `pi-knowledge` 的写路径是否真的提供 `research_propose_wiki_update`：非子会话走 `createManagedNativeSession`，而 `registerKnowledgeInterface` 里有 `dependencies.session` 分支，从代码看应该有，但还没在真实会话里验证。如果没有，`wiki_review` 在受管下也走不通，需要先补。
- `tool_execution_end` 相对 `tool_result`、`turn_end` 的顺序，确认身份绑定赶得上同一轮的 `agent_end` 核对。
- 同名工具：`identify` 只看 `toolName`。需要确认宿主是否拒绝第三方注册同名工具，否则要在事件上附带工具来源。

## 验收

- 单元：枚举状态；`ambiguous` 拒绝；`describe` 缓存缺失时不放行；条目读取限于自身种类；槽位一次性；来源变化后失效。
- 真实 SDK + 受限 worker + 两个 npm pack 安装的 fixture 包：提供者在自己的 owner 内执行并被核对；两会话隔离；停用提供者后里程碑 `blocked`、任务不能完成；伪造工具事件不能绑定身份；重开后需要重新核对且不继承授权。
- §5.3 的安装包验收（是否包含 Zotero 取决于决定 1）。

## 不在本设计内

PDF 身份（第 1 项）、Vault 文件验收（第 2 项）、决策记录与淘汰事件（第 4 项）。其中第 2 项与本设计都要用到知识插件的受管服务，实现时注意复用。
