# 科研工作台 v3 实施计划

这份计划把 v2 的架构护栏落到面向全科研场景的产品闭环：研究资料可浏览、可审查、可带着来源回执进入知识库，连接器只在 backend/research seam 运行，任何结果都能回到项目、运行、产物和知识快照。

## 已确认的基线

- v0.32.0 整合 PR [#203](https://github.com/Gyoungwe/Drone/pull/203) 已合并到 `main`，合并提交为 `81024cccac2d7a5cf4a7c3f6ccb26807e0e68c7e`。
- 合并前的 CI run [623](https://github.com/Gyoungwe/Drone/actions/runs/38868473828) 在 macOS/Windows 上的静态检查、单元测试、SDK 测试和桌面打包均通过。
- LAN observer 已移除；当前产品依赖本地项目目录、已授权计算主机和显式的 SSH/连接器门控。
- 现有 `listProjectFiles`、`previewFile`、`openResourceExternal` 和 `PreviewHost` 已覆盖文件遍历、文本/表格/图像/PDF/二进制回退，缺口是它们仍藏在会话资源面板里，没有独立的研究资料入口。
- `.local/docs/release.md` 在工作区缺失；正式签名安装包和跨平台自动更新验收因此仍是发布门槛，不能以本地 adhoc 包替代。

## P9 · 研究资料浏览器

目标是提供一个科研化的“资料”工作台面：项目目录中的任意文件都能被检索、预览或交给系统打开，浏览本身不产生知识写入。

- [x] 导航增加 `research` 视图；左侧显示项目文件树、搜索和文件类型/更新时间筛选，右侧复用 `PreviewHost`（首版已落地文件树、搜索、预览/源码、图像缩放和外部打开）。
- [x] 文件动作只有四种：预览、以源码查看、系统外部打开、进入知识捕获确认；路径始终以项目 `cwd` 为根，不能越界或跟随未授权软链接（首版已完成预览/源码/外部打开和主机层项目根约束；捕获确认随 P10 实施）。
- [x] 未知二进制显示大小、MIME、修改时间和哈希提示，并提供外部打开；不把二进制正文塞进会话或知识库。
- [x] 视图通过已有 `window.pi` host API 工作，不在 renderer 引入 backend、Electron 或 Pi SDK；新增文案同时维护中英文。
- [ ] 验收：项目为空、中文路径、超长路径、目录、Markdown/CSV/图像/PDF/FASTQ/未知二进制和外部打开失败均有可解释状态（基础单元回归已通过，跨平台手工验收留在 P11）。

## P10 · 跨科研场景知识沉淀

知识沉淀不绑定 RNA-seq。统一对象链为 `ResearchCase → RunAttempt → Artifact/SourceReceipt → KnowledgeSnapshot/Experience`；连接器只负责发现或取得来源，不能绕过证据门禁写入结论。

- [x] 新增研究资料捕获合同：`cwd + relativePath + byteHash + format + sourceReceipt + scope + freshness + approval`；默认只保存元数据和可引用片段，禁止自动保存会话正文、凭据和未授权私有原文。已落地版本化 capture record、来源回执和待审快照。
- [x] 在 backend/research 层提供 `captureResearchResource` 深模块，使用现有 `JsonStore` 原子写入 `SourceReceipt` 和待审 `KnowledgeSnapshot`；renderer 只调用 host API。已接入 `window.pi` 的 capture/approve/revoke/list 合同。
- [ ] 连接器分层：搜索（Crossref/PubMed/Europe PMC/数据集目录）、文献与引用（Zotero/DOI）、数据与协议（ENA/SRA/Zenodo/OSF/Protocols）、机构资源（EZproxy/机构登录）和项目存储。每个适配器返回同一份来源回执、许可、访问时间、内容哈希和失败原因。
- [x] 连接器的网络、凭据、速率、缓存和重试策略留在 backend/research；知识库只接收通过来源、许可、完整性和用户审批的候选。首批只读 Crossref、PubMed、Europe PMC、Zenodo、OSF、NCBI SRA、OpenAlex、DOI、ENA 已接入 registry，失败结果带 retryable 原因；连接器可在科研资料页逐项开关，状态通过 JsonStore 持久化，关闭后检索 fail-closed；Zotero、Protocols、机构登录和写入型适配器仍未接入。
- [x] 验收：同一文件重复捕获幂等、文件变更生成新 revision、连接器失败可重试但不伪造证据、撤回/过期能阻止旧快照继续发布。重复/变更/根目录/软链接/撤回、过期拒绝发布和同内容过期刷新已覆盖回归测试；PR #208 的 macOS/Windows CI 全部通过。

## P11 · 发布与更新门槛

- [x] 在 `.local/docs/release.md` 恢复私有签名流程说明，并把签名身份、notarization、Windows 签名、更新 feed、回滚和跨平台验收写成可执行清单；Release workflow 已增加证书预检和产物验签。
- [ ] 只有 macOS notarized、Windows signed、自动更新成功且回滚成功的证据齐全后，才关闭正式发布门槛；未签名构建只能标为测试包。
- [ ] 发布前仍执行 `npm run lint && npm run typecheck && npm test && npm run build && npm run check:arch`，再加 `npm run test:upgrade`、扩展/runtime 产物检查和研究资料浏览器回归。

## 实施顺序

1. P9 先落地，复用现有文件/预览 host API，降低新 IPC 数量。
2. P10 接着加入捕获合同和 backend seam，再接第一批只读搜索/文献连接器。
3. P11 与功能并行准备签名和更新证据，但不让未签名状态伪装成已发布版本。

## 当前执行记录

- 2026-10-16：P10 捕获 seam、项目文件来源回执、待审快照、审批/撤回、九个只读连接器（Crossref、PubMed、Europe PMC、Zenodo、OSF、NCBI SRA、OpenAlex、DOI、ENA）及连接器 UI 开关已实现；PR #207 的 macOS/Windows 8 项 CI 全部通过并已合并。
- 2026-10-16（验收复核）：生产桌面 `npm run build`、lint、typecheck、架构检查、研究技能包发布测试、扩展/runtime 生成物检查均通过；全量 `npm test` 在当前 macOS 沙箱有 47 个既有环境/知识发布 fixture 失败，`test:upgrade --fixtures-only` 的语义混合夹具因 `listen EPERM 127.0.0.1` 失败；pi-packages 暂无法在无网络沙箱中暂存（npm registry 连接被 EPERM 拒绝）。
- 2026-10-16（v0.32.1 发布尝试）：PR #206 已合并到 `main`，Release #118 的 macOS/Windows validate 与 prepare 均通过并创建 `v0.32.1` 标签；三个签名构建因仓库未提供授权证书/notarization secrets 按 fail-closed 规则停止，未生成签名安装包、更新 feed 或安装/更新/回滚证据，P11 正式发布门槛保持未关闭。
- 2026-10-16（签名门禁）：`check-release-signing.mjs`、macOS hardened runtime/entitlements、Windows Authenticode 验签和 GitHub Release workflow 预检已加入；真实证书、notarization、跨平台安装/更新/回滚仍需在有授权 secrets 的 GitHub runner 上执行。
- 2026-10-16（PR #208）：连接器列表/启停 IPC、JsonStore 持久化、科研资料页双语开关和过期捕获刷新已完成；评审指出的同内容过期快照无法续期问题已修复，PR #208 已以 squash 合并（`bcbf5b894eb48109507af6e85dc646642cecbae9`）。run [682](https://github.com/Gyoungwe/Drone/actions/runs/38920773631) 的 macOS/Windows 8 项 CI 全部通过。连接器分层剩余 Zotero、Protocols、机构登录和写入适配器；P9 手工边界验收与 P11 正式签名安装包、自动更新、回滚证据仍未关闭。
