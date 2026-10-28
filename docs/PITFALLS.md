# Drone 踩坑记录（来之不易，勿重踩）

> **遇到怪问题先来这里查**：疑难 bug、构建/打包异常、SDK 行为反直觉——先按下方「症状快速索引」找条目，再决定要不要自己踩一遍。
> 配套阅读：`docs/INDEX.md`（项目索引，「想改 X 改哪里」）；AGENTS.md「UI 截图调试」「常用命令·本地内测打包」两节还有各自的实操坑。
> 新踩的坑记到这边（注明日期与修复点），别只在会话里说。

## 症状快速索引

| 症状 / 场景 | 条目（章节） |
|---|---|
| 全 app 卡死、日志/磁盘分钟级 GB 暴涨、renderer unresponsive | 一 · 0.4.6 冻结事故 |
| 流式期间白屏、`error #185`、无限重渲染整树卸载 | 一 · 0.5.0 白屏事故；四 · Zustand selector（#185 另一成因） |
| 扩展注册的工具模型用不了、模型说「工具列表为 none」 | 二 · createAgentSession tools 白名单 |
| 设置页永久 Loading、模型列表为空 | 二 · runtime.refresh 网络挂起 / getAvailable 返回空 |
| 权限 confirm 弹窗不生效 | 二 · bindExtensions 注入点 |
| preload 加载失败（sandbox 下 require is not defined） | 三 · preload 必须 CJS |
| main 进程 import workspace 包行为异常（外部化/旧产物） | 三 · externalizeDepsPlugin |
| 打包产物缺 pi SDK、Electron 版本漂移 | 三 · 打包两个坑 |
| Electron 二进制下载不动、npm 拦 postinstall | 三 · Node/npm 环境 |
| 新增 UI 文案只显示一种语言 | 四 · i18n 双字典 |
| 凭证泄漏风险、密钥误提交 | 五 · 绝不打印/提交 API key |
| LAN 页连接僵死不重连、状态「重连中/已连接」反复跳 | 二 · SSE 心跳必须是命名事件帧 |
| LAN 对话页正文重复出现在末尾、run 结束又恢复正常 | 二 · 流式增量帧不可重放（healing 兜底差量） |
| 流式输出时整个 Markdown 区域随 token 节奏闪烁、尾部文字半透明往上爬 | 四 · markstream fade 的临时合成层（已修：组件 API 关闭 fade） |
| 代码块顶部两行无法拖选、标点偶发橙色框 | 四 · 悬浮 header 命中层 + Monaco Unicode 高亮 |
| onDragStart 里拿不到拖拽尺寸（`active.rect.current.initial` 恒 null） | 四 · dnd-kit rect ref 填充晚于 onDragStart |
| 报错文案悬在空态页不消失、切新会话还在 | 四 · store 级 error 字段永不清理（已修：改 toast + 乐观回滚） |
| Google Vertex 填了 key 仍 401「API keys are not supported by this API」 | 二 · Vertex 只支持 ADC/服务账号（api_key 路径必败，桥接层已剔除 api-key 选项） |
| 随便说「你好」就弹出「知识库检查未通过（interrupted）」 | 二 · 知识发布门禁把 LLM 失败误报成知识检查失败 |
| `/obsidian-setup` 等斜杠技能填完路径后输入框像卡死 | 二 · 扩展命令里嵌套 await sendUserMessage 会占住 sending |
| B3 RNA-seq 在本机无法直接验证 Nextflow/Slurm | 六 · Compute B3 只走 fake runner；真实集群条件单独确认 |
| 设置页提示「已保存」但实际没保存（参数超出 schema 限制） | 四 · 宿主契约参数校验失败曾是 resolve 错误信封（已在 preload 统一转 reject） |
| Google Antigravity 登录后返回 400 `INVALID_ARGUMENT` 或 403 `UNSUPPORTED_CLIENT` | 二 · Cloud Code Assist ClientMetadata 枚举 |
| 生信任务 trace 显示 `skills: []`，模型退回临时脚本 | 二 · 研究 skill 路由与开发态资源同步 |
| 未选项目时知识 PDF 预览报 `Invalid arguments for host method file:preview` | 2026-10-26 · 可选 IPC 参数与显式 undefined |
| 读取型 native 工具注册即报 Unsupported native Pi API: events | 2026-10-28 · 原生适配器提前读取未支持 API |
| 摘要写过但缺 reviewed receipt、specialist 不继续 | 2026-10-28 · 研究摘要必须消费真实 delivery handle |
| 不装知识插件后扩展通知丢失、旧 context 继续通知 | 2026-10-28 · SDK 退订与通用通知 |

## 2026-10-28：原生适配器提前读取未支持 API

managed Pi proxy 的属性读取本身会明确拒绝未支持 API。`createKnowledgeNativeAdapter` 曾在注册前读取 `pi.events`，让只用 registerTool/on 的两个读取工具也加载失败。按扩展实际请求再读取，保留真正请求时的拒绝；不要用 optional chaining 探测会抛错的 API，也不要静默伪造 event bus。真实 tarball→权限受限进程→SDK 回归需启用，默认跳过的 fixture 不能证明包可加载。

## 2026-10-28：研究摘要必须消费真实 delivery handle

只注册工具却丢弃 `registerResearchExtension` 返回值，会让旧 writer 只写 summary 而缺少 reviewed receipt；手写 answerable metadata 的成功测试因此是假前提。生产链必须经过当前 read ledger/revision、真实模型隔离审阅和写后回读。首次写入前逐一检查 summary/history/Vault 的真实路径，run_dir 校验不能保护其兄弟 symlink 目录；临时文件完成后再检查 preimage，失败清理本次临时文件。这里是乐观路径 CAS，不宣称跨进程原子 compare-and-replace；回滚遇到人工更改须保留并报告 partial。

## 2026-10-28：SDK 退订与通用通知

官方 `events.on()` 返回退订函数，测试替身应使用 `createEventBus`。Pi 1.1.0 的 session.dispose 不会移除 extension onError 监听，`session/extension-errors.ts` 用同 callback 的公共 runner.onError 退订，并覆盖 reload；升级 SDK 后需重新验证删除条件。notify 沿通用 SessionEvent 发送到 toast，主/子会话结束后旧 context 不能继续发，消息不落 trace，不能依赖知识插件。生成 `.pi` 后对 manifest 运行 Biome formatter，并验证 source/output 哈希；不手工修改 bundle。

## 2026-10-26：可选 IPC 参数与显式 undefined

`previewFile(target, cwd?)` 的调用方会将不存在的 cwd 显式传为 undefined，Electron 保留这个参数位置。若 schema 只有 `[string]` 和 `[string, string]` 两个元组，`[target, undefined]` 会在读取文件之前被拒绝。按公开 PiApi 的可选签名修正 filePreview/resourceOpenExternal 的对应 schema；不要要求用户先选项目，也不要全局删除 undefined（其他接口可能需要保留其参数位置）。`preload/file-preview-contract.test.ts` 穿过真实合同绑定与文件读取，覆盖空项目绝对路径和 confinement 边界；打包后还须用没有选过项目的 profile 点击 PDF 引用。

## 2026-10-25：npm 缓存可能掩盖本地候选包锁完整性错误

相同版本的候选 tarball 重建后，`package-lock.json` 的 integrity 可能仍指向旧字节。已有 npm 缓存时 `npm ci` 曾通过，但空缓存直接报 `EINTEGRITY`；不能据此删除校验或更换已验收包。先核对受版本控制的 tarball 与证据 SHA-256，再将锁文件 integrity 与该文件的 SHA-512 对齐，使用隔离 HOME/npm 缓存重新安装并跑完整门禁。知识整页合并时仅修正插件仓库 API 1.2.0 锁校验值，候选包字节未变；此前缓存安装结论由本次空缓存检查替代。

## 2026-10-25：npm 发布成功退出仍可能尚未公开

`npm publish` 返回 0 不等于公共版本可安装。本轮 research 发布后 `npm view` / 官方 tarball 均返回 404，随后上传报 `E409 Cannot publish over previously staged version`；因此不能仅凭 404 判断“没有写入 registry”，也不要通过升级版本号绕过。先确认公共元数据、tarball 和 `npm stage list`；本轮也观察到被拒绝重复上传的研究版本未出现在可批准列表，不能把空列表作为重传依据。该研究版本随后出现在公开 registry，最终下载哈希与原候选一致。

明确使用 staged publishing 时，`npm stage publish <tarball>` 返回 stage ID；`validating` 是 npm 正在处理，必须等到可批准状态，再核对阶段包哈希并完成 `npm stage approve <stage-id>` 的 2FA。公开下载、完整性、干净安装和宿主验收完成后才能关闭发布项。该命令需要 npm CLI 11.15.0+ / Node 22.14.0+；本轮使用隔离安装的 npm 12.2.1，没有修改全局 npm。认证回调链接、token 和 OTP 不得进入日志或证据。见 [npm 官方 staged publishing 文档](https://docs.npmjs.com/staged-publishing/)。

## 2026-10-24：任务门禁必须使用所属会话的工具清单

正式包中 `research_prepare_knowledge` 的 `drone.readOnly` 已进入宿主 runtime，但 SDK 的 `tool_call` 钩子在注册作用域外运行。任务门禁读取了默认 runtime，首轮把只读调用记为副作用，下一轮同参数调用被 `idempotency-check` 拒绝。不要通过清空账本、硬编码工具名或进程级清单来绕过。

`registerWorkbench` 现在注入通过 `withHostRuntime(pi, ...)` 查询的只读判定，每次调用解析当前绑定，兼容宿主稍后宣布 runtime 的加载顺序。`task-manifest-session.test.mjs` 使用真实独立构建的知识扩展，检查跨轮读取不受阻、另一独立 event bus 未声明同名工具时仍拦截重复效果；源码单测通过后仍须重新打包做 GUI 验收。

同轮正式包重验还发现：`build:extensions` 默认保留现有输出，但曾把传递依赖的新摘要写进旧输出的 manifest，`check:extensions` 因而误判通过。生成器现在拒绝这种依赖漂移且不更新 manifest；必须 `npm run build:extensions -- --force` 重建。回归在 `scripts/check-build-inputs.test.mjs`，第二个含旧 bundle 的中间 DMG 已废弃，不能计入最终 PASS。

知识阅读器还必须在 backend 自己的 `pi-knowledge` 模块实例安装 `loadWorkspaceConfig` 端口；只在动态扩展的 bundle 中配置不会影响 backend。带 `project` 的真实方法笔记曾在点击引用时触发 `Workspace config host is not configured`。`knowledge-host-ui-reading.test.mjs` 独立打包扩展、从宿主 UI 端读取实际笔记，避免源码测试共享模块后掩盖此问题。

## 2026-10-24：正式包沙箱的运行时与打包边界

- Electron 43 的 Node 24 无网络权限控制。禁止把 bad-port fetch 错误当禁网成功；必须用父进程可达的 HTTP 端点检查 `ERR_ACCESS_DENIED` 和服务端零请求。正式包现使用独立、摘要校验的 Node 26.12.1。
- Pi 1.1.0 的 `extensionsOverride` 发生在源码执行之后，不能用于沙箱拦截。补丁必须在两个 trust pass 的 import 前运行，错误返回诊断，不得回退宿主执行。
- esbuild 会启动本地二进制；从 `app.asar` 加载会出现 `ENOTDIR`。通过物理 `app.asar.unpacked` 解析 esbuild，第三方依赖保留安装位置以支持 jsdom 的资源读取。临时目录用 realpath，避免 macOS `/var` 与 `/private/var` 权限路径不一致。
- 打包前必须固定输入。不要把会触发 `fetch:plugins` 的 typecheck/test prehook 与 electron-builder 并行；本轮中间产物曾出现 ASAR 内文件内容错位，已废弃。依次完成资源准备、检查、构建、打包，再从最终 DMG 安装复验。
- 市场首次挂载若先切换 catalog type 就 return，会跳过 installed packages 刷新；首次进入的已安装列表必须独立刷新，已有回归测试。

## 一、事故复盘（含可复用诊断手法）

## 六、Compute B3：本地 seam 不等于真实集群

`@drone/compute` 的 WorkflowSpec 编译、Nextflow `-preview` argv、direct/Slurm
executor 选择、固定 runner 协议、MultiQC 阈值和远程 provenance 都可以在本地
用 fake runner 验证。它们不会证明目标主机已经安装 Nextflow、容器镜像已经缓存、
Slurm 命令可用，或样本结果具有科学有效性。内置 nf-core/rnaseq test-profile
使用的是 preview fixture；其 `test-profile-pinned` revision 和 unresolved
container digest 会被 B3 authorization/scheduler gate 拒绝，不能作为真实提交。
真实 smoke 必须在一次授权合同内由宿主 transport 执行，并保留流程 revision、容器 digest、scheduler job id
和回收产物校验；MultiQC 通过也仍保持 `reviewed=false` 与
`scientificallyVerified=false`。

### 0.4.6 全 app 冻结事故（2026-08-23）

glm-5.3 流式输出病态空白 thinking（纯 `\n    ` 洪流永不终止），pi SDK 每条 `message_update` delta 都携带全量累积快照（`partial`+`message` 两份）→ trace 落盘平方放大，**3 分钟写 12.7GB**；巨型事件再经 IPC 无上限转发 renderer → 堆爆 unresponsive。

修复三层全在 `pi-backend.ts` 的 `emitEvent` 单点：

1. `session/event-slim.ts` 剥快照（下游只吃 delta 白名单，终态靠 `message_start/end` 全量）
2. `session/stream-guard.ts` 熔断（连续空白 >8KB / 单消息 >2MB → abort+丢弃后续）
3. `session/trace.ts` 加固（巨事件截断标记、join 失败丢批不重试、flush 后按字节轮转、缓冲兑底）

**教训**：任何转发模型流式事件的中间层，都必须先瘦身再分发。诊断现场在正式版 `~/Library/Application Support/@drone/desktop/logs/` + `~/.pi/agent/sessions/*/traces/`。

### 0.5.0 流式期间反复白屏（2026-08-24，React #185）

`StreamingMarquee.tsx` 的无依赖 `useLayoutEffect(() => measure())` + ResizeObserver 双测量通道自成反馈环（measure→setMetrics→重渲染→再 measure，仅靠测量值相等守卫刹车），文本增长跨过溢出 class 翻转边界时 RO 回调与 effect 交错 → 守卫失效 → 无限更新 #185 → 整树卸载白屏。概率性触发，0.4.6 引入、当天 4 次。

修复：effect 加 `[text]` 依赖；防御：`AppErrorBoundary` 接线进 `main.tsx`（渲染期异常落到可恢复错误页而非白屏）。

**注意 #185 有两个不同成因**：本条是 effect 自激，zustand selector 不稳定是另一条（见下）。

**诊断手法可复用**：正式版症状在 `logs/main-*.log` 搜 `error #185`；dev 复现 = 把 trace 事件序列直接注入 renderer（`useTranscriptStore.getState().applyEvent`，详见 `scripts/repro-full.mjs` + `docs/INDEX.md`），比猜快得多。

## 二、pi SDK 集成

### 研究 skill 路由与开发态资源同步（2026-10-07）

研究 skill 有两层边界：`scripts/sync-research-skills.py` 按锁定清单把允许分发的
SKILL.md 同步到 `packages/desktop/resources/research-skills`，发布脚本会强制校验这些
回执；`CapabilityRuntime` 再按当前用户消息识别能力和研究阶段，只把选中的 skill
放进本轮模型上下文。开发态的 `npm run build` 和 `npm run dev` 不会下载外部 skill 包，
因此资源目录为空时，发布清单里存在的 scientific/nature skill 也不会出现在 dev 会话，
trace 的 `skills: []` 只说明本轮没有可见 skill，不能反推发布包缺 skill。先运行
`npm run skills:sync -- --sources nature scientific`（或使用已校验缓存的 `--offline`），
再测开发态路由。

路由不能只依赖“研究/论文”这类宽词。基因、蛋白、序列、联配、结构域、NCBI、FASTA
等生信术语需要命中 `bioinformatics` 阶段；否则能力和阶段都会是空集，即使 `bio_db`
已经注册，模型也可能自行生成无超时保护的远程脚本。阶段应优先选择已安装的
`scikit-bio`/`waypoint-bio`，缺包时明确报告 unavailable stage，不得假装 skill 已加载。

### Cloud Code Assist ClientMetadata 枚举（2026-10-07）

症状：Google Antigravity OAuth 回调和 token exchange 都成功，但项目发现的
`loadCodeAssist` 请求返回 400 `INVALID_ARGUMENT`。

原因：`MACOS`/`WINDOWS`/`LINUX` 不是协议的有效平台枚举。另一个误区是把
Gemini CLI 的公开类型表当作完整协议：本机 Antigravity 2.19.1 的 descriptor
明确包含 `ANTIGRAVITY=9`，使用 `IDE_UNSPECIFIED` 会被视为另一种客户端，
真实登录返回了 403 `UNSUPPORTED_CLIENT`。

发现、开通、模型目录、聊天请求统一使用 Antigravity metadata（`ideType=9`、
`pluginType=2`，平台按 descriptor 的 Darwin/Linux/Windows 与架构映射到 1–5），
请求体和请求头共用同一个值。平台名和编号以本机官方客户端 descriptor 为准，
不要从过期第三方片段推断，也不要混用 Gemini CLI 与 Antigravity 的标识。

诊断：先确认 loopback OAuth 回调页面显示完成，再只查看脱敏后的 UI 错误卡；
不要打印授权 URL、code、access token 或响应正文。

### 权限注入点：`session.bindExtensions({ uiContext, mode: "tui" })`（不是 `createAgentSession` 选项）

`pi-backend.ts` 的 `makeUiContext` 已有全量 no-op 实现（约 25 个成员）——只改 `confirm`，别重写。

### `Model`/`ThinkingLevel` 类型来自 `@earendil-works/pi-ai`（coding-agent 不 re-export）

### Google Vertex 只接受 ADC/服务账号认证（2026-09-05 实测）

症状：Google Vertex AI 在 UI「编辑」填 Key 后显示已配置，但请求必 401 `"API keys are not supported by this API. Expected OAuth2 access token..."`（`aiplatform.googleapis.com` 的 `PredictionService.StreamGenerateContent`），对照组 Gemini API（`google` provider）同样假 key 是 400 `"API key not valid"`——即 Gemini 端点支持 API key、Vertex 端点明确拒绝。

事实：Vertex 可用的认证 = OAuth2 类（ADC / 服务账号），需 project + location + 凭据文件，且三者当前只经 `auth.json` 的 `env` 字段（CLI `/login` 交互产生，`ModelRuntime.login(providerId, "api_key", ...)` 的 `AuthInteraction`）或进程环境变量（GUI 从 Finder 启动读不到 shell env）。

已修（2026-09-05）：`LoginService` 放宽为支持 api_key 交互登录，`login.ts` 的 `filterAuthSelectOptions` 对 `google-vertex` 剔除必败的 `api-key` 选项；ProviderRow 对 `apiKeyLogin` 标记的内置 provider 显示「登录」入口。复现/验证脚本：`scripts/verify-vertex-auth.mts`（401 事实）与 `scripts/verify-vertex-login.mts`（ADC 交互落盘→configured）。

补充坑：**「已配置」徽章 = auth.json 有条目，不等于凭证真正可用**（pi CodingAgent `getProviderAuthStatus` 的 `storedProviders` 优先判定，不 resolve；CLI 同语义）。Vertex 输错凭据文件路径时列表仍显示「已配置」，发请求才失败——引导用户用「测试」按钮真实验证。

### 知识发布门禁把 LLM 失败误报成知识检查失败（2026-09-14）

症状：Windows 安装包读到了 `~/.pi/agent` 的本地 provider，但对话立刻返回「【知识库检查未通过】本轮的最终回答尚未完成发布（interrupted）」。会话 jsonl 里 `usage` 全 0、`stopReason:"error"`，真实 `errorMessage` 被换成「请求出错；未经检查的回答没有发布。」

原因：桌面端始终设置 `DRONE_KNOWLEDGE_DIR`，`publication.mjs` 把 `stopReason` 为 `error`/`aborted`/`length`/`pending` 一律当成知识检查 `interrupted`，并剥掉 provider 错误。两条常见失败都会撞上这条：

1. 会话落到未配置的 Pi 默认模型（`auth.json` 里没有对应 key）
2. 已配置的自定义网关返回 502/503（`Upstream service temporarily unavailable`）

错误卡系统本来会展示 `errorMessage`，但门禁先把它盖掉了。

已修：`stopReason=error` 不再发布知识检查文案；正文留空，保留脱敏后的 `errorMessage` 给 LLM 错误卡。`aborted`/`length`/`pending` 仍走 interrupted。

诊断：`~/.pi/agent/sessions/*/traces/trace-*.jsonl` 看 `message_start` 的 `provider`/`model`/`stopReason`；用同一 `auth.json`/`models.json` 对 SDK `streamSimple` 打一次即可拿到被盖掉的原文。

### 扩展命令里嵌套 await sendUserMessage 会占住 sending（2026-09-14）

症状：输入 `/obsidian-setup`（或同类扩展斜杠命令），弹出 Vault 路径问答后，再在输入框打字/回车，界面像卡死：发不出去，停止钮也常被输入内容顶掉。

原因：SDK 对扩展命令是 `await handler()` 之后才 `preflightResult(true)`。`/obsidian-setup` 在 handler 里直接 `sendUserMessage(..., { expandPromptTemplates: true })`，而这条消息以 `/skill:research-vault` 开头，会再嵌套一整轮 `session.prompt()` / `_runAgentPrompt`。桌面端 `sending` 一直为 true，直到整轮模型结束；输入框看起来像冻住。

已修：setup 问答结束后用 `setTimeout(0)` 再交接模型回合，让斜杠命令 IPC 先返回；问答弹窗打开时把焦点收进对话框，sending 期间禁用 composer textarea。

`Model` 有 `name` 无 `label`；`model.provider` 是字符串。

### 无凭证时 `getAvailable()` 返回 `[]` —— 不能当可靠的模型列表

`runtime.getModel(provider, id)` 始终可用。

### `runtime.refresh()` 不传参时 `allowNetwork` 缺省为 true（除非 `PI_OFFLINE`）

会向 pi.dev 拉全部 provider 的远程模型目录，且 `fetchWithRetry` 无内置超时，网络不可达时一直挂（设置页曾因此永久 Loading）。`SettingsService.listProviders` 默认显式 `allowNetwork:false` 走本地，仅用户点刷新才 `forceNetwork`（`force:true` + 15s 超时兜底）。

### `createAgentSession({ tools: [...] })` 传数组 = 允许清单

数组外的工具（含扩展 `registerTool` 注册的）会被 `isAllowedTool` 整个过滤掉（sdk.js `_refreshToolRegistry`）——扩展工具要生效必须不传 tools（undefined，桌面正式路径）或把工具名列进数组；冒烟/测试脚本极易踩（ACP 冒烟 V3 曾因此假阴性：模型明说「工具列表为 none」）。

### SSE 心跳必须是命名事件帧（`: ping` 注释不触发 EventSource 任何事件）（2026-08-28）

LAN observer 最初用 SSE 注释帧 `: ping` 做心跳——注释按规范不派发任何 JS 事件，客户端 **无法感知连接是否还活着**：移动端切网/锁屏后的半开 TCP 连接会僵到内核超时（可达十几分钟），页面既不来数据也不重连。且 onerror→「重连中」无迟滞，锁屏必杀连接的移动端常态让状态药丸反复跳。

修复（`lan/server.ts` + `lan-web/store.ts`）：心跳改命名事件 `event: ping`（`LanSseFrame` 联合加 ping 变体）；客户端任意帧刷新 `lastFrameAt`，超 `PING_MS*2.5` 无帧即主动断开重连（watchdog）；onerror 延迟 3s 才显示「重连中」（期间 EventSource 自动重连大概率已成功，防闪烁）；服务端下发 `retry: 1500` 加快自动重连；重连才重拉快照，首次连接跳过双拉。

### 流式增量帧不可重放：种子含 in-flight partial + healing 兜底 = 正文重复（2026-08-28）

LAN 页重连/中途进入时，快照种子经 `messagesToUIMessages` 重建——**SDK 的 in-flight partial assistant 消息就在 `session.messages` 里**（`agent.state.messages` 实时含流式中对象），种子含 partial 正文但无流式容器；后续 `text_delta` 是增量（reducer 累积语义），无容器时整体空转 → `applyFrame` 误标 `streamHealing` → ChatView 底部渲染 `view.assistantTail` 兜底气泡 → **同一段正文两份**（消息流一份 + 底部一份），直到 run 边界摘标记 + 立即重拉快照才恢复。用户观感：「正文重放拼到末尾，新事件来了又正常」。

修复：`streamHealing` 从 boolean 升级为「种子后新到 text_delta 字节数」计数器（`store-pure.ts`），兜底气泡只渲染 `assistantTail` 尾部新增后缀（`healingTailSuffix`）——种子已含的不重复，文字持续 live；标记加 `view.agentActive` 守卫（空闲会话的陈旧帧不标记/不触发边界重拉）；重种子时清空标记。**教训**：增量语义的帧不能靠重放/重种子恢复，必须给「已应用多少」一个显式边界（seq 或字节计数）。

## 三、构建 · 打包 · 环境

### preload 必须是 CJS

sandbox 下渲染进程不加载 electron-vite 默认的 ESM 产物。config 强制 `format: "cjs", entryFileNames: "index.cjs"`；`main/window.ts` 加载 `../preload/index.cjs`。

### `externalizeDepsPlugin` 会把 workspace 依赖也外部化

main config 用 `exclude: ["@drone/backend", "@drone/shared"]` 并 alias 到源码；pi SDK 保持 external。

### Node >= 22.19。npm 11 默认阻止 Electron postinstall（需 `npm approve-scripts electron`）

二进制下载走 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。

### 打包两个坑

pi SDK 必须声明进 `packages/desktop/package.json` dependencies（electron-builder 只从 desktop 依赖树收集）；electron 必须钉精确版本。发版/CI 细节全在 `.local/docs/release.md`（本地文档，不入库）。

## 四、Renderer / React

### Zustand selector 必须返回稳定引用（模块级 `EMPTY_ENTRY`）

内联 `?? []` 新数组会触发 React error #185 无限渲染（与 0.5.0 事故的 effect 自激是两个不同成因，症状相同）。

### CDP 冒烟往 store 注入状态必须用完整对象形状（2026-08-29）

`cdp-eval` 里 `useSessionsStore.setState({ sessions: [ { sessionId: 'x' } ] })` 这类缺字段注入会炸渲染组件（如 `TabPill` 读 `session.name.split` → TypeError，错误边界兜住但 UI 白屏重挂）。安全手法：**不碰 sessions 列表**，只对 transcript `bySession` 做函数式合并注入完整 SessionEntry 形状（各字段齐备），测完删 key；或先存原 entry 引用、最后还原。同理不要整体覆盖 `bySession`（会抹掉真实会话，App 重载时连锁出错）。

### CDP 小区域 clip 截图偶发连续 blank，全窗截图正常（2026-09-06，permission-mode 手测）

症状：`Page.captureScreenshot` 带 `clip`（如 composer 底栏 560×95 的小区域）时偶发 4 次重试全 blank；同帧全窗无 clip 截图正常。与 AGENTS.md 已记的「偶发整帧空白」同类合成器瞬时状态，但**小 clip 更易触发且重试也救不回**。对策：能用全窗截图就全窗（事后裁）；必须要小区域时改用 DOM 计算样式断言（`getComputedStyle` 颜色/位置）代替像素级验证，别在重试上耗时。

### markstream fade 的临时合成层 = 整个 Markdown 区域随流闪烁（2026-09-05 初修，2026-09-08 根治）

症状：流式输出时正文随 token/commit 节奏整块闪一下；慢模型频率低，快模型频率高。库机制：`fade=true` 时每次可见文本 commit 都把新增量包进 `span.text-node-stream-delta`，跑 `opacity:0→1` 动画并带 `will-change:opacity`；动画结束后再沉淀进普通文本。除了尾部直接变淡，高频创建/销毁临时合成层还会让同一文本排版区域的合成/抗锯齿观感一起跳，看起来像整个 Markdown 被重绘。

2026-09-05 初修把 `--stream-update-fade-duration` 压到 8ms，只缩短了动画，没有消除临时 span 与合成层切换，仍会按模型输出频率闪。2026-09-08 根治：桌面和 LAN 的 `Markdown` 都从组件 API 传 `fade={false}`，保留 `smoothStreaming` 的 pacing。注意这与 CSS `animation:none` 不同：`fade=false` 会让库直接走稳定文本 span 分支，不创建 fading span，也不依赖 `animationend` 沉淀。

已排除的候选（实证手法可复用）：组件 remount / 整树重渲 / 块级 fade-node 重播 / controller.reset 重播（reset 是即时全亮）。给 store 注入合成 `text_delta`，页面侧用 MutationObserver + 节点身份采样 + `animationstart` 监听验证：`.markdown-body` / `.markstream-react` 身份不变，而开启 fade 时每个 smooth commit 都启动 `markstream-react-text-node-stream-update-fade-*`。次级因素：代码块 fence 打开后先渲纯文本 fallback 再换 Monaco（空闲时约 32ms，主线程忙时更长）。

### 代码块顶部不可选 + 标点橙框（2026-09-08）

两个独立原因。顶部不可选：为保留复制按钮而把 `.code-block-header` 绝对定位到代码块顶部，header 实际高 38px，恰好覆盖 18px 行高的前两行；`:hover/:focus-within` 曾把整条 header 设为 `pointer-events:auto`，透明区域也会截获拖选。修复为 header 始终 `pointer-events:none`，仅 `.code-action-btn` 恢复 `pointer-events:auto`。

标点橙框：Monaco 默认 `unicodeHighlight` 会给全角标点、不可见字符和易混淆字符生成 `.unicode-highlight` 描边，模型输出中混入这类字符时看起来像随机残留框选。只读展示没有可执行的修复动作，桌面与 LAN 的 `Markdown.tsx` 都通过 `monacoOptions` 关闭三类 Unicode 高亮，并一并关闭同词、符号 occurrence 和括号匹配 decoration；真实拖选高亮保留。诊断时用 `elementFromPoint` 检查顶部文本命中、`.view-overlays .selected-text` 检查 Monaco 内部选区；不要用 `window.getSelection()` 判断，Monaco 选区不走浏览器 Selection API。

### dnd-kit：`onDragStart` 里 `active.rect.current.initial` 恒为 null（2026-09-05）

`activeRects` 是个 ref，初始 `{initial:null, translated:null}`，**在 onDragStart 分发之后的 effect 里才填充**——事件回调里读到的永远是 null。要拖拽起始尺寸：给可拖节点加 `data-tab-id` 之类的锚点，回调里 `querySelector` 实测（SessionTabBar ghost 宽度就是这么做的）。

### UI 文案走 `useT()` + `zh`/`en` 字典（`renderer/src/i18n/`）

新增字符串两个都要加。

### store 级 `error` 字段永不清理 + 裸字符串渲染 = 报错跨会话残留（2026-09-12 修复）

症状：新会话空态页 Logo 下方永远悬着一条红色报错（如 `Error invoking remote method 'session:setModel': ...`），切会话/新建会话都不消失。根因：`useSessionsStore` 曾有全局 `error` 字段，7 处 catch 写入却无处重置，唯一渲染点是 EmptyState 里一段裸 `<p>`（统一报错系统建立前的遗留）。教训：**会话动作类失败（建/开/分叉/撤回/切模型）是 UI 动作反馈，走 toast（非阻塞自动消失），不进 store 长期态**；乐观更新失败按 `setSessionPermissionMode` 范式回滚。已删字段改 `pushToast` + 乐观回滚；`errText` 顺带剥 Electron IPC 包装前缀（`Error invoking remote method 'x': Error: `）保证 toast detail 可读。后续任何新 catch 不要再往 store 塞裸错误字符串。

### 宿主契约参数校验失败是 resolve 错误信封，不是 reject（2026-10-06）

症状：设置 › Zotero › 网页 API 填 21 位群组 ID（schema `maxLength: 20`）点保存，界面显示「已保存」，上方仍是「未配置」。根因：`main/ipc/bind-contract.ts` 在 `Check(method.args, args)` 失败时**返回** `{ code: "invalid_arguments", titleKey, detail, ... }`，preload `exposeContract` 原样透传，`await window.pi.x()` 不会进 catch；调用方把任何返回值当成功。修复点：先在 `ZoteroWebApiSection` 用 `isZoteroWebApiStatus` 校验返回形状；随后统一在 preload `exposeContract` 里把 `invalid_arguments` / `invalid_result` 信封转成 reject（`HostApiValidationFailure`，消息为信封 detail），所有经契约的 `window.pi.*` 调用失败都会进 catch。教训：IPC 层的「失败」必须是 reject，不能是 resolve 一个看起来像结果的对象。

### Pi 的 mcp.json 认 `enabled: false`，不认 `disabled`；ZOTERO_LIBRARY_TYPE 要单数（2026-10-08）

症状一：MCP 面板里关掉的服务器（以及 `/zotero-setup` 注册的「默认关闭」zotero）照样被 pi-mcp-adapter 启动。根因：`~/.pi/agent/mcp.json` 和项目 `.pi/mcp.json` 是 Pi 自己的格式，adapter 5.x 用 `translatePiMcpServer` 翻译，只把 `enabled: false` 变成禁用，`disabled` 当未知字段丢掉；`.mcp.json`、`~/.config/mcp/mcp.json`、`mcp-adapter.json` 才是 adapter 原生格式（`disabled: true`、`excludeTools`）。修复：`McpService` 按文件方言写字段（Pi 文件写/删 `enabled`，原生文件写/删 `disabled`），读取时两种都认，启动时把用户级 Pi 文件里遗留的 `disabled: true` 改写成 `enabled: false`；`test/mcp-enabled-adapter-sdk.test.ts` 用打包的 adapter 实际验证被关掉的服务器不会启动。

症状二：在设置 › Zotero › 网页 API 保存密钥后，zotero-mcp / zotero-cli 的网页 API 请求全部 404，URL 是 `https://api.zotero.org/userss/<id>/…`。根因：Drone 往 process.env 注入 `ZOTERO_LIBRARY_TYPE=users`，MCP 子进程继承后交给 pyzotero，pyzotero 自己再补一个 "s"。修复：注入单数 `user` / `group`（`research/src/zotero-library.ts`），Drone 自己的读取方（`zoteroWebApiConfig`、对账 reconciler、网页 API 状态）两种拼写都认；`/zotero-setup` 生成的条目也显式写 `ZOTERO_LIBRARY_TYPE`。

## 五、工程纪律

### 绝不打印/提交 API key

`models.json` 用环境变量引用（`$AI_OPS_API_KEY`），key 由用户自持。

### 已开源：github.com/Jaxton07/drone

git remote 走 SSH（本机直连 github.com:443 不通）。`main` 有分支保护（PR + CI `check` 必过 + squash merge），Release 由 tag 触发（`.github/workflows/release.yml`）。

### ssh2 可选原生模块不能打进主进程 bundle（2026-10-03）

新增 ssh2 后，electron-vite 会顺带把 `cpu-features`/`sshcrypto` 的 `.node` 文件复制进 `out/main/chunks`。这些文件是在运行构建的 Node ABI 下生成的，electron-builder 随后重编译依赖树时不会替换已经打进 bundle 的副本，因此 `.app` 在载入主模块时会报 `NODE_MODULE_VERSION` 不匹配，窗口和 CDP 端口都不会出现。`electron.vite.config.ts` 必须把 `ssh2` 保持为 external，让打包阶段按 Electron ABI 和目标架构准备依赖；用实际 `.app` 的隔离首次启动冒烟验证，不能只看 `npm run build` 成功。

### 交互式 HTML 预览不能用 srcdoc / blob（2026-10-06）

`<iframe srcdoc>` 和 renderer 创建的 `blob:` 文档会继承宿主页面的 CSP（`script-src 'self' blob:`），图表 HTML 里的内联脚本因此全部被拦，用户以为「交互模式坏了」。可运行脚本的预览必须走独立的自定义协议 `drone-html://<token>/…`：响应头自带严格 CSP（允许内联脚本，`connect-src 'none'` 禁网），iframe 用 `sandbox="allow-scripts"` 且**不加** `allow-same-origin`；宿主 `index.html` 的 `frame-src` 只放行 `'self' drone-html:`，脚本即使把自身 iframe 导航到外网地址也会被宿主 CSP 拦下，不能借此外传数据。

## task_reconcile 不能用 book.revision 做并发校验

`reconcile` 在 await 验收器/文件检查期间，同一批并行工具调用（如 `set_status`）会保存并抬高 `book.revision`。若 reconcile 仍按开始时的 revision 校验，会抛 `stale-task-view` 并逼 agent 多绕几轮。reconcile 只确认任务仍在册且是同一个对象，再就地合并；UI 的 `command()` 仍保留严格 revision 校验。

## `npm run typecheck` 停在第一个出错的包（2026-10-09）

根脚本是 `npm run typecheck --workspaces && npm run check:pi`，第一个失败的 workspace 会让后面的包和 `check:pi` 全部不执行。backend 有一个报错时，desktop 里的类型错误一直没人看到。修完一个包的报错后要重新跑完整的 `npm run typecheck`，直到退出码为 0，不要只看上一次的输出。

## WebDAV 首个请求不能带 Basic（2026-10-09）

默认地址是 HTTP。首个请求若直接带 `Authorization: Basic …`，只支持 Digest 的服务端也会收到可还原的密码。传输层现在首个请求不带凭据，由 401 的 `WWW-Authenticate` 决定用 Digest 还是 Basic；改认证逻辑时保留这个顺序，并保持 `webdav.test.ts` 里“只有服务端要求才发送 Basic”的测试。


## 2026-10-12：路线摘要与临时目录测试

路线摘要的 `findIndex` 在全部节点已处理时返回 -1，应选择末节点而非回到第一步；路线节点状态仅是路由快照，不等于实际任务执行已完成。流程 `textPair` 的英文默认值是中文，新增固定文案必须显式填写英文。权限元数据测试不能假定 checkout 不在 `/tmp`；该测试只对自身 fixture 注入非临时区分类，其余临时区行为仍由真实分类测试覆盖。

## 2026-10-20：Pi 包更新回执不等于版本替换

`pi update npm:<name>` 可以返回成功，但在 Pi 1.1.0 的独立 HOME 中，managed package 目录仍可能保留旧 `package.json` 版本。市场验收必须同时读取安装目录版本；Drone `PackageService` 检测到版本未变时会用 unpinned source 重装，再把真实版本写入生命周期回执。若宿主领域源码改变，先运行 `npm run build:extensions -- --force`，再运行 `npm run check:extensions`，否则生成扩展的依赖时间戳会让检查失败。

## 研究包迁移：空 claims 与会话回执

自包含打包不等于保留证据语义。简化的内存 research_loop 曾允许空 claim_bindings 后 finalize；必须保留归档、读取回执与结构化 claim 的完整状态机。用真正的 SDK 会话验证空引用拒绝，并同时测共享扩展闭包、独立 event bus、相同 cwd/toolCallId 和单会话 shutdown。Pi SDK 的身份来自 sessionManager.getSessionId()；不得用 cwd 代替有效会话身份或把账本放到 process 全局。迁移后的源码位置检查应核对公开 /host 边界，而不是仍要求已删除的宿主实现路径。

安装包启动验收不能只用 `#root.childElementCount`：开屏 DOM 也会令它为真。等待 `#splash` 消失且 workbench-nav 可见后再截图，才能证明用户实际看到工作台；IPC 可用与完整研究交互验收仍需分别记录。

## 进程沙箱：连接失败不等于权限拒绝

`fetch("http://127.0.0.1:9")` 的 bad-port 错误不能证明禁网。使用父进程已验证可达的 HTTP 服务，断言子进程 `ERR_ACCESS_DENIED` 且服务端没有新增请求。Node 22/24 permission model 没有网络控制；正式 Electron 内置 Node 24 时必须拒绝加载沙箱。支持网络权限的运行时使用 `--permission`；`--allow-net` 为全网布尔授权，不能把 hostname 参数当域名白名单。Electron worker 必须设置 `ELECTRON_RUN_AS_NODE=1`。

## Zotero 临时条目验收：标题规范化与清理

Zotero Connector 会规范化英文标题大小写（本轮 `NOT A PUBLICATION` 被保存为 `NOT a PUBLICATION`）。临时条目身份应由唯一标记、DOI、标签和忽略大小写的完整标题共同核对；不能因逐字标题断言失败而误报未写入。清理必须只针对已确认的测试条目，带版本前置条件删除，再核对 key 404 和标记搜索为空。SDK 会话使用 `session.dispose()`；Pi 1.1.0 的 `ModelRuntime` 无 `dispose()`，验收驱动器不能调用不存在的方法掩盖原始错误。

### 分类关键词不能覆盖笔记的显式类型

`Library/Methods/mapping-tools.md` 曾因完整路径先匹配 tool 被算作软件。插件 worker 计数与最近分组应共享显式 type → 分类目录 → 无类型文件名的优先级；前端最近标签直接消费已有分组，不能再次按路径猜测。真实 worker 的关闭/重开回归与正式包旧索引验收同时覆盖此问题。


## 原生 Pi 任务产物回读不能依赖 Desktop 权限监听器

症状：已批准 task_plan、研究候选笔记也成功保存，但 task_reconcile 返回 file-unavailable，任务保持 partial。公开 pi-core 0.1.8 只有 Desktop 注册 drone:task-read-check 监听器，原生 Pi 没有接管者。

修复：core 0.1.9 候选增加所属会话的读取适配，每次核对当前 task.readRoots、session、cwd 和根目录真实路径；不跨会话缓存授权，Desktop 公告权限运行时时让原引擎接管。候选 SDK 回归同时覆盖拒绝、无 UI、撤权、独立 event bus 和读到一半切换上下文。

边界：`.pi/research-notes` 是内部候选资料，按现有私有路径规则不能作为普通交付文件的验收目标。完整工作流需通过实际 write 工具交付普通工作区文件，再由宿主读回；不能为了完成状态放宽私有路径规则。loader 成功或 reconcile 返回非错误并不意味着里程碑 completed。

### 外置 UI 样式不能只加选择器前缀

知识 UI 外迁后的正式安装包暴露了两类 CSS 污染：`@theme` 中同名自引用变量会遮蔽宿主继承的颜色；`@property --tw-*` 注册与 cascade layer 属于全局，给普通选择器加前缀无法隔离。插件需只引用宿主语义 token，并给生成的 Tailwind 属性与 layer 使用专属名称。回归应比较启用前、启用后、移除后的宿主 computed style，同时覆盖浅色/深色；只有组件 DOM 渲染通过不能证明样式隔离。插件侧复现与检查位于 `desktop-ui-pack/scripts/check-styles.mjs`。

## 2026-10-26：非聊天页面资源链接与聚合包 PDF 原生依赖

知识笔记复用 Markdown，点击链接会更新 resourcePreview；只在聊天分支挂载 ContextPanel 时，知识页面没有读者可显示。App 现在为非聊天视图挂载 PageResourcePreview，复用 ResourceSidebar；回归检查关闭、返回及聊天不重复展示。

聚合研究包只遍历 dependencies 时会漏掉 pdfjs 的 optionalDependencies，工作区提升的 Canvas 依赖掩盖干净安装问题。suite 顶层声明可选 Canvas，由消费者安装平台原生二进制；test:pdf 必须只安装 suite 和 SDK，并捕获 stdout/stderr、真实读取和渲染。源码加载或文本提取成功不能推导 GUI 已通过。

PDF Canvas 设置 max-width 时不可同时固定 CSS height；否则窄侧栏只压缩宽度。保留像素 width/height，CSS height 用 auto，让浏览器按固有比例缩放。

## 2026-10-26：插件关闭回执与 Node 读权限

锁定 Pi 1.1.0 的 `AgentSession.dispose()` 不发送 `session_shutdown`。SessionEngine 必须先启动扩展关闭通知，同时启动 SDK abort，等待两者结束后才 dispose：关闭 hook 可能等待工具收到 AbortSignal，工具也可能等待关闭 hook 释放 UI 请求，串行等待任一方都会互等。即使某一步失败，也要完成其他清理并聚合错误；官方 ExtensionRunner 会把 hook 异常转为 onError，需在关闭期间订阅 session_shutdown 错误，不能仅检查 emit() 是否拒绝。会话关闭和应用退出都要等待整条链路；并发关闭共用同一次销毁。`packages/backend/test/session-shutdown-sdk.test.mjs` 用真实 SDK 工具回归两种依赖方向；worker 回收还须核对真实 PID，不能以 dispose 被调用替代退出回执。

Node permission 的目录读取授权会跟随包内数据符号链接。只校验入口 realpath 不够：新的 desktopRuntime 在启动前检查整个包的链接目标，拒绝包外链接。该检查仍依赖启动期间安装目录不被其他宿主流程改写；完整包不可变快照/安装代次属于 P6，不能将预扫描描述为解决任意并发文件替换。

UI 授权等待、配置落盘和进程清理都是异步阶段。停用/关闭先撤销调用资格，安装/配置变更维持转换屏障；替换实例要等待旧清理回执，不能因旧 token 已删就越过在途清理。失败仍向上报错并刷新真实存留配置；一个插件拒绝加载不能阻断其他插件。

## 2026-10-26：原生工具注册成功但生产能力筛选隐藏工具

P2 的打包知识 runtime 在实际 SDK 直接调度时通过，但正式 DMG 聊天的模型工具清单缺少两项知识工具。独立进程 native 注册只传 name/label/description/parameters，丢失了插件声明的 `drone` 元数据；生产 `CapabilityRuntime` 将未分类工具视为 external，知识能力激活时不会曝光它们。通用进程协议必须保留可选 JSON 元数据，让现有 `ToolManifest` 边界解析分类，不能靠硬编码工具名或关闭 lazy capabilities 修复。

artifact 回归现在同时启用真实 SDK、生产 CapabilityRuntime 与只读会话：断言知识分类工具实际进入 active tools，并令控制工具即使自报 `drone.readOnly=true`、仍因未知/write toolEffects 被 broker 拒绝。分类是曝光信息，不是文件或副作用授权。真实安装包仍必须在重建后复验。
# 受管工具可见不等于任务守卫允许执行

原生工具的 `drone` 分类元数据进入模型清单后，旧 task guard 仍只查领域 runtime 的工具登记表，可能把实际只读工具误判为需要 task_plan。守卫应读取当前真实 SDK 会话的官方 `ToolInfo.annotations.readOnlyHint`；受管 native 由 toolEffects 投影此值，unknown/write 明确覆盖为 false，不能被同名旧元数据或另一个会话污染。此提示只用于任务编排，实际能力授权仍经过 broker。回归需加载真实任务守卫并检查 toolResult.isError，不能只数工具卡或模型请求。

应用开始异步退出后，macOS `activate` 仍可能到达；如果再次创建窗口，会恢复已清理后端上的会话并出现空白/失效页面。退出、失败和已完成状态都必须禁止新建窗口，失败保留错误并允许明确重试退出。日志中的 `backend disposed` 仅指 session service，不能代替整个 Desktop cleanup、will-quit 和实际进程退出证据。

## 2026-10-27：候选插件与干净宿主检查

根 `pretypecheck/pretest/prebuild` 会从 `plugins.lock.json` 重建并覆盖已安装插件。本地候选包的定向测试通过后，若锁仍指向旧版，下一次根命令会丢失新 host exports。必须先提交插件源码、从干净依赖构建并记录 tarball SHA-256，再更新源码锁并验证默认 fetch；开发目录 override 不能证明锁定安装通过。源码候选版本与公开 npm 版本分别记录。

独立宿主 checkout 没有 sibling `drone-plugins` 或已忽略的沙箱二进制。默认 `npm test` 在 pretest 按既有 checksum lock 准备 Node runtime；公开 UI 包集成测试只接受 `check:public-plugin-host` 提供的真实安装目录，默认宿主测试保留空安装根与自包含 fixture 覆盖，不回退读取另一仓库源码。缺少外部包时该集成用例明确跳过，不能算公开包验收通过。


### Managed native 工具不能只传 name/description/schema

现象：包加载成功，但 outputSchema、namespace、executionMode 等标准字段消失，execute 的 onUpdate 永远是 undefined。原因：受限 worker 注册回执只提取基础四项，调用协议也没有 progress 消息。处理：显式传输标准 JSON 字段；不能序列化的 prepareArguments/prepareLoadout/renderCall/renderResult 在加载时报错；进度绑定尚未结束且未撤销的调用 ID，取消和迟到回调不得串给其他 attachment。`native-tool-protocol-sdk.test.mjs` 用真实 SDK/受限进程回归。普通第三方沙箱也需从两条 SDK 注册路径传入 observer，不能仅修改 worker；共享 `tool-progress.ts` 的进度边界 schema。不能借此切片宣布全 API 兼容。

### npm ci 不会清掉已从 workspace 删除的包内缓存目录

复用旧 checkout 验收任务包迁移时，`packages/tasks` 的已跟踪源码均已删除，但旧 `packages/tasks/node_modules` 空壳仍可能存在。根脚本的源目录删除检查因此会失败，而各 workspace 测试已通过。先核对该临时 checkout 的目录确实只剩旧依赖缓存，再清理这个缓存；不要修改门禁把真实源码残留当作通过。首次失败与完整重跑见 `native-plugin-owner-migration-2026-10-28.json`。这不是产品源代码修复，干净来源和缓存残留应分别记录。

- 扩展 UI 动作不能用普通 prompt 的未知 slash 回退：SDK 1.1 会把未注册命令当作模型输入。API 1.3 的 `sessions.command` 直接从当前 SDK runner 取 command/context 并调用 handler，缺失明确失败；handler 异常通过同一 runner 的 onError 诊断并向调用者失败。UI 卸载不等于 native owner 卸载，包设置到 native 生命周期的动态发现仍需独立接线。

### Discovery 的 closed 状态不能代替资源关闭

杀死 Docker CLI 并不保证 daemon 内的容器已停止。每次 runner 使用唯一容器名和 ownership label；取消、超时、关闭和 dispose 必须等待 CLI 退出，只删除 label 匹配的自有容器，再以成功的 daemon 查询确认精确名称不存在。inspect 非零可能是 daemon 故障，不能据此报告清理成功。`DiscoveryRunner.run` 以 `DISCOVERY_CLEANUP_FAILED` 保留无法验证清理的错误，插件 execute/close/dispose 必须继续拒绝；迟到的执行不能将 closed 恢复成 ready。

真实容器首次运行暴露 `--mount type=bind,...,rw` 无效，移除末尾 `rw`（bind 默认可写）后通过。验收不得依赖隐式拉镜像；本轮仅使用已缓存的 python:3.12-slim，`--pull=never`。本机出现 tag inspect 失败而 image ID inspect 成功的情况，保留失败并使用同一已缓存镜像的完整 ID 验证，未 pull 或 retag。完整 B5 UI 与正式安装包须单独验收。


### Optional tuple item 不等于兼容较短 IPC 参数数组

TypeBox 的 `Type.Tuple([... Type.Optional(...)])` 在此项目的运行时 Check 中仍拒绝原四参数调用。`PluginRuntimeContract.invoke` 的兼容合同显式使用四参数 tuple 与带 request ID 的五参数 tuple 联合；主进程 IPC 回归必须实际调用两个形状，不能只依赖 TypeScript optional 参数通过。取消传输只发送 request ID，AbortSignal 留在 renderer/main 各自的实际生命周期中。

### channel-watch 恢复订阅一次性超时（原因未确认）

`4abdae43/253c47e` 的独立全量门禁首次在恢复订阅后的 2000ms 内未收到文件监听唤醒，backend 其余 1987 项通过。原失败日志保留；同目录定向完整文件 20 项通过，随后该用例 4 路并行共 20 次均通过，完整同源码重跑 backend1988/17 skipped、Desktop934/1 skipped、root25/25 通过。首次压力脚本曾使用重复 config 路径，在测试前退出，不能当作产品复现证据。没有修改生产代码、超时或断言；根因仍待稳定复现，完整重跑通过不代表已经修复。见 `native-plugin-ui-model-cohort-2026-10-28.json`。


### 直接调用 operation.execute 不能证明 IPC/运行时合同通过

模型评审的只读 `modelReviewInfo` 只接受 revision/id/hash/profile；写操作另外要求 acknowledged/autoApply。直接适配器测试忽略未用字段时看似成功，真实 packed owner 的 broker 会按 additionalProperties:false 拒绝复用写 DTO。回归必须跨真实 registry/worker 调用，并分别构造读 DTO 和写 DTO；不要放宽 schema 来让 fixture 通过。详见 `native-plugin-knowledge-model-command-2026-10-28.json`。

### Pi 1.1.0 abort 不会自动拦截迟到的 message_end 发布

真实 SDK 会 await subscriber/extension hook，所以持有 message_end 时 prompt、waitForIdle、abort 都等待；但已有 hook 迟到返回后，SDK 仍会公开并持久化它修改的正文。普通注册顺序也不能保证最后一个 hook。钉版 host-only delivery boundary 放在全部 SDK hooks 之后、公开/append 之前，再核对真实 run signal；取消/失败只保留安全 SDK envelope 与实际 toolCalls，dispose 后不再 append。源码与真实 RED→GREEN 见[机制回执](releases/native-publication-sdk-fence-2026-10-28.json)，完整 managed owner/consumer 尚未完成。

### 原生 SDK 的 dispose 不会代发扩展 shutdown

Pi 1.1.0 的 `AgentSession.dispose()` 只中止/失效内部运行时，不会发出 `session_shutdown`。独立 SDK 子进程若只调用它，扩展拥有的 writer lease 会留下，并正确阻止后继 writer。嵌入端必须执行公开 extensionRunner 的 shutdown 生命周期、abort、dispose，并收集 SDK onError；Drone 的 `SessionEngine.close` 已使用该顺序。不得通过 process exit 全局账本自动删除 lease，也不能把 SDK 吞下的 shutdown handler 错误记为成功。复现与真实交接见 P5 shared-owner 机器回执。

### 只读旧 owner 不能在交接后用缓存覆盖新 journal

旧 Discovery Domain 可先只读缓存 JSON，再等另一个 owner 完成写入并释放 lease。此时仅靠新取到的 lease 不能证明内存快照仍新鲜。迁移中的旧 journal 端口使用真正 JsonStore 的 `writeChecked`、原始字节 SHA 与回读；版本变化时明确要求关闭重开。新 UI 接管也必须保留唯一既有 projectId，混合 ID 拒绝；不能取第一条或重新生成 ID 后覆盖历史。

### 容器 runs 根不能分别 canonicalize 后当成授权根

如果 `workspace/runs` 已是指向外部的 symlink，分别对 runs 和执行子目录做 realpath 再比较包含关系，会把两个外部路径错误接受为工作区内。容器 runner 现在固定 canonical workspace，逐级创建并检查 runs 路径，拒绝任一 symlink/non-directory 并回读真实路径；不能在 realpath 失败后退回字符串路径。回归验证顶层和嵌套 symlink 都不会创建外部文件或启动容器。

## 2026-10-28 · SDK append 失败后的内存 phantom 与 reload

Pi 1.1.0 的 SessionManager 先把 append entry 加入内存，再写磁盘；EISDIR 后 reload 仍复用这个 manager。不要从 reload 成功推断数据已保存，也不要继续 sendMessage 以 phantom leaf 为 parent 延长磁盘链。TaskApplication 必须 fail closed、保留最后 committed 诊断，真正从磁盘重开后验证；禁止 poke SDK 私有数组做假 rollback。extension 的 events.on 监听会在 invalidate 被解除，不能靠 bus listener 伪装跨 reload 持久状态。实际双入口反证和 S2 剩余边界见[TaskSession 证据](pluginization/native-plugin-task-session-actor-evidence.md)。

### 已安装 UI 构建产物不能写回其原生来源树

同包原生与 UI 共用完整包树 hash。把 esbuild 的 `dist/index.js` 写回已安装 UI 目录，会让宿主自己改变正在使用的原生来源，之前在 readCode 后重算 hash 的做法也不能建立稳定的代次。安装包 UI 现在按已验证 hash 编译到宿主 `ui-plugin-builds` 缓存；用户本地 UI 目录继续使用原目录 dist。回归比较编译前后完整树 hash、native/UI 描述对象身份与重新扫描后的 built 状态；这不授予新的文件权限，也不替代包级停用/卸载。

### 失败的 native abort 与清理必须保留停止屏障

停止流程并行等待真实 SDK abort 和 runtime 清理；`allSettled` 返回不等于关闭成功。必须先检查每项结果，再删除 stopping 记录。UI-only 配置变化也要等待之前失败的 UI 停止记录，不能只扫描仍然存活的 binding 后报告配置成功。原有重激活回归与新增 UI 配置回归均先实际失败；最小修复后 103 项 Desktop/IPC/preload/UI 联合通过。后继真实 SDK 会话在实际 abort 完成后注入回执失败，确认领域进程已退出；原屏障仍允许同包 UI alias 重绑。`stopping` 现在记录实际 source 身份和失败状态，`bind` 通过原失败停止 receipt 阻止同 `source.pluginId` 的所有 alias 重开，同时保持既有外层错误语义。实际 SDK 10/10、Desktop bridge/host 48/48 与 backend typecheck 通过；这项故障注入不代表完整 required-source publication 已验收。

## 2026-10-28 · 原生 input 的空字符串不等于取消

Pi 1.1.0 的 input 在 Enter 时提交原字符串，空串和两侧空格都是合法回答；取消才是 undefined。Desktop 的 trim() || undefined 与必填 text 曾改变 SDK 语义。普通输入必须保留原值，领域路径等解释由调用方处理；AskDialog 的可选 text 应明确提交空 customText，能力结果 schema 不得用 minLength:1 把合法空输入拒绝。真实 SDK、受限 worker 与表单点击证据见[会话问答](pluginization/native-plugin-session-questions-evidence.md)。
