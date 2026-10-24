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
| P1 | research / pi-research / Zotero 迁移 | 将研究来源、PDF 输入和 Zotero 相关运行时继续收敛到插件边界，删除迁移期宿主耦合 | plugin-api 稳定、研究领域合同、真实 PDF/来源验收和回滚方案 | **需要范围授权**：这是跨包结构迁移，会改变扩展边界 |
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
- 本轮已完成 **P0 权限执行与沙箱** 的进程代理切片，并完成第三方扩展、外部 MCP 与 Protocols.io 公开只读验收；后续仍需单独授权的写入、凭据和范围迁移不自动开启。
- 本计划不包含任何凭据、Vault 正文、会话正文或真实外部写入记录。

## 2026-10-24 执行切片状态

本轮按用户授权启动第 1–8 项，明确跳过第 9 项 MinerU/GROBID 和第 10 项 B8/B8-2 云端协作。以下状态包含公开包、独立本地进程和公开只读页面的可复现验收；不把真实第三方账户写入混入 PASS：

| 工作包 | 本轮结果 | 证据或剩余边界 |
| --- | --- | --- |
| 权限执行与沙箱 | **PASS（进程代理切片）**：host-mediated 权限拒绝、授权委托、脱敏审计和 Node 22 子进程代理已实现；不支持的 Pi 扩展 API 会 fail closed | [`p0-security-api-evidence.md`](pluginization/p0-security-api-evidence.md) |
| plugin-api 发布治理 | **PASS（治理）**：维持公共 `@gyoungwe/plugin-api@1.1.0`，补充只增不删、干净消费者和回滚规则；本轮未发布新版本 | [`p0-security-api-evidence.md`](pluginization/p0-security-api-evidence.md) |
| Electron GUI 验收 | **PASS（本地切片）**：report、workflow-catalog、task-delivery、knowledge 四个真实 Electron 脚本通过，覆盖页面导航、知识库设置/Wiki 审核、来源阅读、任务交付、暗色和窄屏布局 | [`next-stage-gui-acceptance-2026-10-24.json`](releases/next-stage-gui-acceptance-2026-10-24.json) |
| 官方第三方扩展 | **PASS（公开包切片）**：`@gyoungwe/pi-connectors@0.1.1` 临时 prefix 安装后经进程沙箱注册并调用，UI 包仍完成宿主生命周期 | [`next-stage-p1-evidence.md`](pluginization/next-stage-p1-evidence.md) |
| 外部用户 MCP | **PASS（独立 stdio 进程切片）**：真实外部 MCP 子进程完成 marker 调用与停用重载反证；用户自有 URL/凭据仍不读取 | [`next-stage-p1-evidence.md`](pluginization/next-stage-p1-evidence.md) |
| research / pi-research / Zotero 迁移 | **BLOCKED_BY_BOUNDARY**：当前源码仍依赖宿主 research-loop、Zotero 和 host ports，未强行删除 facade | [`research-migration-status.md`](research-migration-status.md) |
| 整页知识 UI 插件化 | **PASS（切片）**：新增 `knowledge.page`，有贡献时接管主区，无贡献/停用时回退默认页 | UI SPEC、`PluginRegions.test.tsx`、`registry.test.ts` |
| Protocols.io 只读验收 | **PASS（公开 GET）**：公开协议页无凭据 GET 通过；写入按红线保持 BLOCKED，未执行账户写入 | [`next-stage-p1-evidence.md`](pluginization/next-stage-p1-evidence.md) |

本轮当前可合并的代码切片不代表十项全部关闭；研究迁移、Protocols.io 写入和需要用户凭据的范围仍保留明确的 `PARTIAL` / `BLOCKED` 状态。
