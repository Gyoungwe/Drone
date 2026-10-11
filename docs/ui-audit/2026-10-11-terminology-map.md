# Drone 客户端科研术语改写表（审计草案）

审计范围：`packages/desktop/src/renderer/src/i18n/{zh,en}.ts`、`components/knowledge/copy.ts`，并抽查 renderer 中的可见硬编码文案。字段名、IPC 协议、数据结构、`data-testid` 和测试描述属于实现接口，保持不动；只改呈现给用户的标签、提示和说明。

## 统一措辞原则

1. **先说用户能做什么，再补充实现细节。** “检查/查看/来源/结果”优先于“门/契约/回执/产物/provenance”。
2. **科研含义保留，工程比喻去掉。** “证据门”表达的是来源核验，把它写成“来源核验”或“证据检查”；“任务契约”写成“任务说明/执行要求”。
3. **可追溯信息仍保留在展开详情。** SHA-256、ETag、revision、cosine similarity、embedding、MCP、WebDAV、CLI、API、Vault、FTS 是必要的专业信息；首屏给中文解释，详情保留原名，例如“版本标记（ETag）”。
4. **结果和状态分开。** `artifact` 的导航标签用“结果/输出”，文件或数据对象的详情可用“结果文件”；`receipt` 用“执行记录/读取记录”，不再使用收据意象。
5. **binding/runtime/host 只在设置和诊断中出现实现名。** 首屏分别写“关联知识库”“运行组件”“运行条件”；错误详情可写“MCP 运行组件（pi-mcp-adapter）”。
6. **中英语义对齐但不逐词翻译。** 中文采用自然的科研产品表达，英文使用 `task brief`, `runtime check`, `activity record`, `sources & reproducibility` 等短语。

## P0：流程主界面（必须改）

| 文件/行 | 当前显示 | 建议中文 | 建议英文 | 说明 |
|---|---|---|---|---|
| `i18n/zh.ts:153` / `en.ts:159` | 任务契约 / Task contract | **任务说明**（若强调约束可用“执行要求”） | **Task brief** | 任务卡是给用户看的目标和边界，不是法律或类型系统契约。 |
| `zh.ts:175` / `en.ts:181` | 公开回执 / public receipt | **公开执行记录** | **Public activity record** | 记录可观察状态，避免“回执”造成已验证/已签收的误解。 |
| `zh.ts:177–178` / `en.ts:183–184` | 任务门、宿主门 / Task gate, Host gate | **任务检查、运行条件** | **Task check, Runtime check** | “门”应改成用户能理解的检查项；host 在这里不是远程主机。 |
| `zh.ts:186` / `en.ts:192` | 文献门 / Literature gate | **文献检查** | **Literature check** | 表示是否满足文献准备条件。 |
| `zh.ts:191–192` / `en.ts:197–198` | 证据绑定、知识沉淀 / Evidence bound, Knowledge deposit | **来源已关联、已整理入知识库** | **Sources linked, Added to knowledge base** | “绑定/沉淀”是内部生命周期词。 |
| `zh.ts:193–194` / `en.ts:199–200` | Wiki/Zotero 回执 / receipt | **Wiki/Zotero 执行记录** | **Wiki/Zotero activity** | 第三方名保留，状态名改自然。 |
| `zh.ts:268–269` / `en.ts:276–277` | 阶段契约 / stage contract | **阶段要求**；“不追加阶段要求” | **Stage requirement**; “No stage requirement” | 下方动态提示改为“阶段要求会追加到任务末尾”。 |
| `zh.ts:1209–1212` / `en.ts:1263–1265` | 通用回执卡、回执；host-observed | **执行记录卡**；“记录应用观察到的文件、条目和笔记状态” | **Activity record**; “Records observed file, item and note states” | 可保留“观察到”作为事实边界，但不显示 host 术语。 |
| `components/chat/RunInspector.tsx:234–235` | 工具和回执 / tools and receipts | **工具和执行记录** | **tools and activity records** | 这是硬编码可见文案，不经过 i18n。 |

## P0：结果、来源与复现

| 文件/行 | 当前显示 | 建议中文 | 建议英文 |
|---|---|---|---|
| `zh.ts:39,141,156,164,201–202,624,628` / `en.ts:43,147,162,170,207–208,646,650` | 预期产物、产物、受影响产物、任务产物、artifact(s) | **预期结果、结果、受影响结果、任务结果** | **Expected outputs, Outputs, affected outputs, Task outputs** |
| `zh.ts:203–224` / `en.ts:209–229` | 产物来源、Artifact provenance、展开来源、provenance、代码指纹、父产物链、superseded | **结果来源与复现信息**；“展开来源与复现信息”；“代码版本标识”；“上游结果”；“旧结果已标记为过期” | **Sources & reproducibility**; “Show source details”; “Code version”; “Upstream outputs”; “Previous output marked outdated” |
| `zh.ts:222` / `en.ts:229` | `sha256 一致` / superseded | **已复现（SHA-256 一致）**；**结果不同：旧结果已保留** | **Reproduced (SHA-256 matches)**; **Result differs; previous output retained** | 算法名放在详情中，`superseded` 不能直接暴露。 |
| `zh.ts:228–230` / `en.ts` 对应 | 可复现、部分可复现、不可复现 | 保持，必要时加解释：**可按记录重现**、**部分信息可重现**、**无法按记录重现** | **Reproducible**, **Partially reproducible**, **Not reproducible** | 这是科研用户熟悉且有明确含义的词，不必过度简化。 |

## P1：知识库、WebDAV 与审核文案

| 文件/行 | 当前显示 | 建议中文 | 建议英文 |
|---|---|---|---|
| `copy.ts:30,125,218,224,227–229,248–266` | 回执、绑定知识库、绑定、Vault、作用范围、全局绑定 | **执行记录**；**关联知识库后…**；**关联**；首屏“当前知识库”（详情“Vault”）；**适用范围**；**全局关联** | **activity record**; **Associate a knowledge base…**; **association**; **Current knowledge base (Vault in details)**; **Applies to**; **global association** |
| `copy.ts:201,376` / `637,662,665,824` | 还没有绑定 Vault、尚未绑定知识库 / No Vault is bound | **尚未关联知识库** | **No knowledge base associated yet** |
| `copy.ts:343` / `791` | 复现记录 / Reproducibility | **来源与复现** | **Sources & reproducibility** |
| `copy.ts:365` / `813` | 本轮记录的文件与版本 / Files and versions recorded this turn | **本轮读取的文件与版本** | **Files and versions read this turn** |
| `copy.ts:315` / `759` | 阅读凭据 / read receipt | **模型读取记录** | **Model reading record** |
| `copy.ts:30,455` | 独立模型审核的实际回执 / Actual receipt | **独立审核的执行记录** | **Activity record for this independent review** |
| `copy.ts:68,498` | 待核验交接 / unverified handoffs | **待核验的交接摘要** | **Unverified handoff notes** |
| `copy.ts:81,512` | 检索片段，不等于模型已阅读 | 可保留含义，改为 **检索片段不等于模型已读取，也不代表科学结论已验证** | **Search excerpts do not mean the model read the source or that a scientific conclusion was verified** |
| `copy.ts:665` / `copy.ts:824` | 应用级知识库 disabled in this runtime / No Vault bound | **此运行环境尚未启用应用级知识库**（可保留“运行环境”） | **Application knowledge is unavailable in this environment** |
| `copy.ts:779` / `researchAnswerable` | 已达到可回答 / Answerable gate reached | **已满足回答条件** | **Ready to answer** |
| `copy.ts:343–347, 791–797` | 完整性、治理提醒、过期/撤稿 | “完整性”可保留；**研究记录提醒**；**过期或已撤稿** | **Integrity**; **Research record alerts**; **Outdated or retracted** |

## P1：语义检索设置（可读标签 + 专业详情）

| 文件/行 | 当前显示 | 建议 |
|---|---|---|
| `copy.ts:383–408,831–857` | 语义检索、词法 FTS、cosine 相似度、embedding、维度 | 首屏：**相似内容检索** / **关键词检索（FTS）**；说明：**按文本相似度筛选**；折叠详情保留 `cosine similarity`、`embedding`、`dimension`。英文首屏可用 **Similarity search**，详情保留 **lexical FTS / embedding / cosine similarity**。 |
| `copy.ts:390,838` | 端点 / Endpoint | 网络设置中可保留，但建议 **服务地址（Endpoint）**。 |
| `copy.ts:392,840` | 凭据环境变量名 / Credential environment variable name | **凭据变量名**；英文 **Credential variable name**。 |
| `copy.ts:397–399,845–847` | 最低语义相似度、cosine | **最低相似度**，辅助说明“按文本向量相似度计算”；英文 **Minimum similarity**。 |
| `copy.ts:402–407,850–856` | 建立语义索引、嵌入 | **建立相似内容索引**；**向量索引**只在高级设置或帮助中出现。 |

## P1：MCP、权限和运行环境（设置/诊断）

| 文件/行 | 当前显示 | 建议中文 | 建议英文 |
|---|---|---|---|
| `zh.ts:452,787` / `en.ts:465,823` | 权限门控 / permission gate | **权限检查**（说明中可写“权限开关”） | **Permission checks** |
| `zh.ts:569,995–996` / `en.ts:589,1042–1043` | token(s) | 面向普通用户可写 **用量单位（tokens）**；模型高级设置保留 **tokens** 并提供 tooltip。 | **Usage units (tokens)** in summaries; keep **tokens** in model settings with tooltip. |
| `zh.ts:969` / `en.ts:969` | Tools & Skills runtime | **Tools & Skills 运行环境** | **Tools & Skills environment** |
| `zh.ts:1048–1051` / `en.ts:1098–1101` | MCP 运行时未安装/未启动 | **MCP 运行组件未安装/尚未启动**；错误详情保留 `pi-mcp-adapter` | **MCP component is not installed/has not started**; keep `pi-mcp-adapter` in details |
| `zh.ts:1036` / `en.ts:1086` | MCP 服务器、工具能力 | 可保留 MCP；说明改为 **MCP 服务、连接状态与可用工具** | **MCP services, connection status and available tools** |
| `zh.ts:1055` / `en.ts:1105` | CLI、API | 首屏写 **命令行工具（CLI）**、**本地接口（API）**；安装说明可保留命令名。 | **command-line tool (CLI)**, **local API** |

## P2：不必改的专业名词与处理方式

- **Obsidian、Zotero、WebDAV、MCP、CLI、API、Wiki** 是产品或协议名称，保留；首次出现时加角色说明（如“云端知识库（WebDAV）”）。
- **证据、来源、主张、适用范围、不确定性、冲突、可复现** 是科研语义，不属于需要去技术化的词，保留。
- **ETag、revision、SHA-256、cosine similarity、embedding、container digest、JSON、baseUrl** 只应出现在设置或“来源与复现信息”的展开区；首屏用“版本标记”“相似度”“运行环境”等解释性标签。
- **Vault** 在高级设置/路径输入中是生态术语，可显示为“知识库目录（Vault）”；普通状态卡用“知识库”。
- **candidate、draft、managed block** 建议显示为“候选修改”“草稿”“托管区”，避免“候选/托管区”单独出现而不解释。
- **reconcile、coverage、integrity** 建议分别译为“重新核对/索引覆盖/完整性”，不要显示动词名词化的工程术语。

## 需要同步的非 i18n 可见文案

- `components/chat/RunInspector.tsx:234–235` 的“回执/receipts”应与 `panel.processLanes` 使用同一“执行记录/activity records”。
- `components/panel/TasksPane.tsx:223`、`components/chat/TaskRow.tsx:20`、`components/panel/subagents-form.tsx:88–94` 是注释或发送给模型的内部协议文本；只有渲染文本需要改，`contract` 字段和 `[Stage contract · …]` 协议不能改名。
- `components/knowledge/artifacts.ts:5`、`panel/ArtifactsPane.tsx:16`、`panel/FlowCards.tsx:18` 主要是注释，但若同步文档/无障碍文本，应统一为“结果/执行记录”。
- `i18n/index.ts:88` 和 `plugins/slots.ts` 的“回执卡”是扩展接口注释，不是用户显示文案；保留或在下一次 API 文档更新时补充解释。

## 建议验收

1. `rg -n -i "任务契约|阶段契约|宿主门|证据门|回执|Task contract|stage contract|Host gate|receipt|Artifact provenance|read receipt|handoff" packages/desktop/src/renderer/src --glob '!**/*.test.*'` 只应命中内部注释/协议字段或明确的技术详情，不应命中首屏标签。
2. 检查中英文键结构完全一致；只替换 value，不改 key、类型和 IPC 数据。
3. 手动浏览：任务、过程、结果、知识库总览、知识网络、WebDAV 同步、Wiki 审核、MCP 设置、结果来源展开详情。
4. 高级详情仍能看到可复现所需的 SHA-256、版本、运行环境和命令摘要，确保“易读”不牺牲审计能力。
