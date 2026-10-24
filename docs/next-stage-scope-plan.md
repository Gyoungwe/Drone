# 下一阶段范围与可选工作计划

本计划承接 v3/v3.1、OmicOS PR1–PR6 和 C0–C4。当前计划内缺口为 0；下面的十项是此前明确标记为范围外、暂缓或未来可选的工作。它们不改变当前已通过的门禁，也不自动进入实现。

## 授权口径

“需要用户授权”只表示开始该项的实现、外部写入、凭据使用、正式发布或改变产品范围前需要一次明确授权。只做本地设计、静态检查、离线评估和文档整理不需要额外授权。涉及真实 Vault、第三方账户、npm 发布或云端写入时，仍须在执行该项前重新确认具体目标和凭据边界。

## 优先级与依赖

| 优先级 | 工作包 | 目标 | 前置依赖 | 需要用户授权 |
| --- | --- | --- | --- | --- |
| P0 | 权限执行与沙箱 | 将插件声明的权限、工具和资源访问范围变成安装、启用和运行时可执行的门禁；补充拒绝和审计证据 | 现有 plugin-api、宿主诊断、安装生命周期；先确定权限模型和兼容边界 | **需要**：这是安全与产品行为变更 |
| P0 | plugin-api 公共发布治理 | 维护已发布的 `@gyoungwe/plugin-api@1.1.0`；只有合同发生变化时才创建新版本、做干净消费者验收并发布 | P0 权限合同稳定、包元数据、变更说明和回滚证据齐全 | **需要**：只有新版本发布时才需要 npm 发布授权与 registry 登录 |
| P0 | 完整交互式 Electron GUI 验收 | 用正式安装包完成关键页面、插件启停、连接器、MCP、引用和回滚的交互式截图/回执 | 当前构建门禁、测试 Vault、可复现的模型或离线验收数据 | **需要环境授权**：测试 Vault、模型凭据和截图范围；不需要代码范围授权 |
| P1 | 官方第三方扩展接入 | 建立第三方扩展审核、签名/来源、安装、升级、停用和回滚流程，接入至少一个真实扩展 | P0 权限执行、公共 plugin-api、扩展来源和版本策略 | **需要**：第三方代码、来源和安装范围需明确批准 |
| P1 | 外部用户 MCP | 支持外部用户配置和运行自己的 MCP 服务，并提供权限提示、诊断、隔离和失败回执 | P0 权限执行；MCP 生命周期和宿主回执链；测试服务与隐私边界 | **需要**：外部服务地址、工具调用范围和测试账户 |
| P1 | research / pi-research / Zotero 迁移 | 将研究来源、PDF 输入和 Zotero 相关运行时继续收敛到插件边界，删除迁移期宿主耦合 | plugin-api 稳定、研究领域合同、真实 PDF/来源验收和回滚方案 | **范围已授权（2026-10-24）**：真实账户写入仍需具体资源授权与凭据 |
| P2 | 整页知识 UI 插件化 | 评估并实现知识库整页由 UI 插件提供的方案，保留默认页面、无插件降级和数据隔离 | UI 插件挂载点 T3、稳定 host API、权限执行、无插件宿主基线 | **需要**：会改变默认 UI 归属和维护边界 |
| P2 | Protocols.io 写入 | 在只读连接器之外增加项目、协议或结果写入，并提供预览、授权、回读和失败恢复 | 账户 OAuth、资源映射、写后回读证据、权限执行和审计日志 | **需要**：第三方账户写入授权；每种写操作单独确认 |
| P2 | MinerU/GROBID 可选 PDF 后端 | 在真实运行时可用、许可和资源预算明确后，作为 opt-in 后端与 pdf.js 做可重复比较 | PR6 评估脚本；固定版本、人工参考文本、运行资源、许可审查 | **需要**：引入新运行时、下载体积和可能的外部服务 |
| P3 | B8/B8-2 云端协作 | 实现身份、同步、冲突、离线、共享权限和云端知识/任务协作 | P0 权限模型；云端存储和身份方案；数据分类、删除和恢复策略；前述第三方写入经验 | **需要**：这是独立产品范围和云端数据处理授权 |

## 推荐执行顺序

```text
P0 权限执行与沙箱
  ├─> plugin-api 后续版本发布治理
  ├─> 完整 Electron GUI 验收
  └─> P1 官方第三方扩展 / 外部用户 MCP

plugin-api + 研究领域合同
  └─> P1 research / pi-research / Zotero 迁移

权限执行 + 稳定 UI host API
  └─> P2 整页知识 UI 插件化

权限执行 + OAuth/写后回读
  └─> P2 Protocols.io 写入

PR6 评估环境 + 许可/资源预算
  └─> P2 MinerU/GROBID opt-in 后端

权限、身份、同步和数据治理全部稳定
  └─> P3 B8/B8-2 云端协作
```

同一优先级内可以并行做设计和离线准备，但只有依赖项的门禁和证据完成后才能进入真实安装、外部写入或正式发布。

## 分阶段交付门槛

### 阶段 A：安全与发布基础（P0）

- 冻结权限声明、工具清单、安装提示、运行时拒绝和诊断格式。
- 维护 plugin-api 的公共包名、版本策略、来源和回滚方式；只有合同变化时才发布新版本，发布前完成临时 tarball 和干净消费者验证。
- 用正式安装包完成一套不含用户正文的交互式验收证据。

### 阶段 B：外部扩展与研究边界（P1）

- 第三方扩展和外部 MCP 均通过权限、来源、停用、回滚和宿主独立性门禁。
- 研究迁移按包逐个切片，先保留可回滚的宿主适配，再删除已满足删除条件的 facade。

### 阶段 C：产品集成（P2）

- 知识整页插件化先完成无插件基线和默认 UI 回退。
- Protocols.io 只在每个写操作具备预览、授权、写后回读和失败回执后开放。
- MinerU/GROBID 只在可用运行时和可比较指标齐全时作为 opt-in，不改变 pdf.js 默认路径。

### 阶段 D：云端协作（P3）

- 先完成身份、数据分类、同步冲突和删除恢复设计，再决定是否实现 B8/B8-2。
- 云端协作不得把当前本地 PASS 证据替换成未经真实会话验证的 fixture 或 loader 证据。

## 当前状态与下一步

- 当前计划内未完成项：**0**。
- `@gyoungwe/plugin-api@1.1.0` 已公开发布；对应工作包是后续版本的发布治理，不是当前发布缺口。
- 上述十项均为 `OUT_OF_SCOPE` / `DEFERRED` / `OPTIONAL`，不应在没有授权时偷偷进入主线。
- 本轮已完成 **P0 权限执行与沙箱** 的进程代理切片，并完成第三方扩展、外部 MCP 与 Protocols.io 公开只读验收；旧 Node 22 网络隔离结论在本轮复核中作废，正式包工具代理沙箱已以 Node 26.12.1 完成 macOS arm64 实机闭环；后续外部写入仍需要具体范围和凭据。
- 本计划不包含任何凭据、Vault 正文、会话正文或真实外部写入记录。

## 2026-10-24 执行切片状态

本轮按用户授权启动第 1–8 项，明确跳过第 9 项 MinerU/GROBID 和第 10 项 B8/B8-2 云端协作。以下状态包含公开包、独立本地进程和公开只读页面的可复现验收；不把真实第三方账户写入混入 PASS：

| 工作包 | 本轮结果 | 证据或剩余边界 |
| --- | --- | --- |
| 权限执行与沙箱 | **PASS（正式包工具代理切片）**：携带校验过的 Node 26.12.1 worker，两个 trust pass 导入前隔离、禁网、按会话授权、退出回收和原始 TS 扩展 GUI 闭环通过；旧 Node 22 假阳性保持作废，不宣称 OS 级恶意代码隔离 | [`p0-security-api-evidence.md`](pluginization/p0-security-api-evidence.md) |
| plugin-api 发布治理 | **PASS（治理）**：维持公共 `@gyoungwe/plugin-api@1.1.0`，补充只增不删、干净消费者和回滚规则；本轮未发布新版本 | [`p0-security-api-evidence.md`](pluginization/p0-security-api-evidence.md) |
| Electron GUI 验收 | **PASS（正式包交互切片）**：`/Applications/Drone.app` v0.33.4 完成知识库、首页、技能/插件启停、MCP 发现/停用、真实模型驱动的 MCP 工具调用、来源行号阅读和回滚；第二次隔离运行的过程面板显示 1 次工具、2 次响应，并返回 `DRONE-GUI-MCP-20261024` | [`next-stage-gui-acceptance-2026-10-24.json`](releases/next-stage-gui-acceptance-2026-10-24.json) |
| 官方第三方扩展 | **PASS（独立第三方工具扩展）**：`@vaayne/pi-web-tools@0.1.1` 已用最终 DMG 中的 CLI 干净安装，经真实 GUI 加载、拒绝/允许联网、科研读取、停用与恢复；见[正式沙箱证据](pluginization/packaged-plugin-sandbox-evidence.md) | [`next-stage-p1-evidence.md`](pluginization/next-stage-p1-evidence.md) |
| 外部用户 MCP | **PASS（独立 stdio 进程切片）**：真实外部 MCP 子进程完成 marker 调用与停用重载反证；用户自有 URL/凭据仍不读取 | [`next-stage-p1-evidence.md`](pluginization/next-stage-p1-evidence.md) |
| research / pi-research / Zotero 迁移 | **PARTIAL**：完整研究核心已迁入 `pi-research@0.2.0`，宿主重复源码与兼容 facade 已删除，真实 SDK 锁定/latest 回归通过；获授权的 Zotero 本机临时条目闭环已完成，迁移后正式包本地两源研究 GUI 闭环已通过（含重启接续与 stale/恢复）；云端账户、新研究包 npm 发布与概览分类问题 RESEARCH-GUI-CATEGORY 仍未关闭。双仓库核心迁移已合入 main，本轮 GUI 修复在 codex/research-workflow-gui；状态继续保持 PARTIAL | [`research-migration-status.md`](research-migration-status.md) |
| 整页知识 UI 插件化 | **PASS（切片）**：新增 `knowledge.page`，有贡献时接管主区，无贡献/停用时回退默认页 | UI SPEC、`PluginRegions.test.tsx`、`registry.test.ts` |
| Protocols.io 只读验收 | **PASS（公开 GET）**：公开协议页无凭据 GET 通过；写入按红线保持 BLOCKED，未执行账户写入 | [`next-stage-p1-evidence.md`](pluginization/next-stage-p1-evidence.md) |

本轮当前可合并的代码切片不代表十项全部关闭；完整研究迁移、Protocols.io 写入和需要用户凭据的范围仍保留明确的 `PARTIAL` / `BLOCKED` 状态。

## 2026-10-24 第 3–4 项收口复验

公开包和本地 MCP 的可复现门禁已补齐，但真实外部边界没有被模拟为完成：

| 工作包 | 收口复验 | 仍然的边界 |
| --- | --- | --- |
| 官方第三方扩展 | **PASS（Drone 维护公开包切片）**：`check:public-plugin-host` 从 registry 干净安装 `pi-evidence`、`pi-connectors`、`desktop-ui-pack`，通过 Pi loader、进程沙箱和 UI 生命周期；`pi-connectors` 另完成 `0.1.0 → 0.1.1 → rollback:0.1.0 → uninstall` | 新增独立 MIT 扩展 `pi-web-access` 0.43.0→0.44.0→回滚/卸载真实 Pi SDK 科研检索 PASS；`@vaayne/pi-web-tools@0.1.1` 的原始 TS 安装、正式包独立进程、科研读取及 GUI 停用恢复现已通过，见[正式沙箱证据](pluginization/packaged-plugin-sandbox-evidence.md)。工具代理之外的 Pi API、其他 OS 实机、原生包 GUI 一键启停未在本轮关闭 |
| 外部用户 MCP | **PASS（本地/诊断切片）**：独立 stdio marker 调用、停用重载、用户级 HTTP 配置元数据诊断、非法 URL fail-closed 和隔离键测试共 8 项通过 | 新增公开 Exa HTTP MCP 启用/停用拒绝/恢复真实检索 PASS；自有认证服务验收仍缺账户与凭据，未把公共端点等同于用户账户 |

## 2026-10-24 PR2–PR6 合并后复验

PR2–PR6 已经随 OmicOS 实现合入；本次以合并结果 `main=94a9a947` 为基线重新执行针对性验收：

| 项目 | 合并后复验 | 结果与边界 |
| --- | --- | --- |
| PR2 PDF 页码引用 | PDF evidence-loop、预览注册表和 PDF viewer 测试 | **PASS**：4 个测试文件、13 个测试通过；页码 fragment、预览跳页和越界回退保持有效 |
| PR3 首页上下文 | `home-cards.test.ts` | **PASS**：4 个测试通过；继续课题、今日发现、新文献及无数据隐藏逻辑保持有效 |
| PR4 证据矩阵技能 | `npm run skills:check` | **PASS**：nature 20/745、scientific 148/1806；`literature-matrix` 已登记 |
| PR5 Paper2Agent | MCP adapter bundle/enabled SDK 测试 | **PASS**：4 个测试文件、8 个测试通过，包含 stdio 发现、调用和停用重载；公开 Paper2Agent 仍按交付物边界处理 |
| PR6 PDF 解析评估 | 重新运行 `scripts/eval-pdf-parsing.mjs` | **PASS（评估完成）**：pdf.js 10/10；MinerU/GROBID 各 10/10 `unavailable`，不进入默认安装或流程 |

这些复验没有改变当前计划状态：计划内缺口仍为 0；PR6 的可选后端集成仍需单独授权和新的人工参考文本、固定版本及资源预算。

## 2026-10-24 第 1 项执行记录

正式安装包 `/Applications/Drone.app`（v0.33.4，`app.asar` SHA-256 `2ac6cd7cdec5a36882e26bdd6346a726acb75f5d8f8623b45a4bc4830f48f5f2`）在隔离 HOME、agent、knowledge 和 userData 下完成交互式 GUI 收口验收。

- 知识库：绑定隔离 Vault 后总览显示 2 篇笔记，网络图和设置页可用；来源阅读器打开 `Library/Papers/acceptance-note.md` 并显示 `L1–7` 行号。
- 首页：新任务页显示项目、编辑器、研究入口、知识库卡片和继续任务卡；停用插件/MCP 后仍能回到首页。
- 技能页：通过正式 UI 安装确认安装 `@gyoungwe/desktop-ui-pack@0.1.1`，安装确认展示 `ui` 能力、`drone-desktop` 宿主和空文件/网络/子进程权限；启用后贡献出现，停用后贡献回到 off。
- MCP：隔离 `acceptance-echo` 被发现并列出 1 个工具；详情显示配置路径；停用后 UI 显示无 MCP 配置。第二次隔离运行配置本地流式模型后，真实 GUI 会话完成 1 次 `echo_marker` 调用，过程面板显示 1 次工具、2 次响应，并返回 `DRONE-GUI-MCP-20261024`。
- 回滚：插件和 MCP 均从 UI 停用，宿主没有崩溃，最终回到默认首页；临时目录和正式包路径已写入 [GUI 验收证据](releases/next-stage-gui-acceptance-2026-10-24.json)。

## 2026-10-24 第 0 项执行记录

`drone-plugins` 的 `codex/next-stage-implementation` 已快进合入并推送到 `main=046f8cbb5d0b3e9d7534e0dd7252b1c91d61ad2a`。
该分支补齐了权限声明一致性检查：`externalWrites` 与
`permissions.readWrite.write` 互相矛盾时清单门禁失败，并增加两个反例测试；同时在
`docs/PLUGIN-SPEC.md` 登记声明门禁与进程沙箱的边界。

- 插件仓库 `npm run check`：PASS（6 manifests、14 manifest tests、workspace typecheck、各包 build/check/test/smoke、clean install、UI smoke、pack check）。
- 宿主 `npm run check:plugin-api -- --migration --lifecycle`：PASS（使用插件仓库 head `046f8cbb`，安装/升级/回滚/卸载全通过）。
- 宿主 `npm run check:public-plugin-host`：PASS（loader、进程沙箱、UI 生命周期，`cleanPrefix=true`）。
- 宿主 `npm run check:arch`：PASS（0 baseline finding，宿主独立性通过）。
- 公开包版本、`plugins.lock.json` 和 npm registry 未改变；本项不产生新的发布缺口。
