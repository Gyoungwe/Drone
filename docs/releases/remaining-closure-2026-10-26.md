# 2026-10-26 剩余目标收口

当前为 **PARTIAL**，不代表七类目标全部完成。机器回执见 [JSON](remaining-closure-2026-10-26.json)。用户已授权继续及有界临时云端写入；不要再次要求同一操作授权，仍需实际目标、凭据与设备。

| 范围 | 当前结果 |
| --- | --- |
| npm | plugin-api 1.2.0 已公开下载、哈希校验、干净安装、ESM/ui 导入与能力协商通过；core 0.1.9 / UI 0.2.0 已 staged，suite 0.1.11 修正候选也已 staged，UI/suite staged 下载与候选字节一致；其余公开安装/宿主验证待发布 |
| Zotero 云端 | 缺测试库及安全配置凭据；已允许仅 1 条唯一标记临时条目，回读后删除并确认不存在；不改现有条目 |
| 用户认证 MCP | 缺实际服务地址及工具范围；本机配置仍指向 Windows 本地 Zotero 程序，不作为 Mac 可用服务 |
| Protocols.io | 缺测试资源与安全配置凭据；已允许仅 1 个临时书签的写入、回读、删除和复查 |
| 其他平台实机 | 未取得可用 Windows/Linux 桌面；SSH 可达的 CentOS 7 无 DISPLAY，不视为 GUI PASS |
| 在线研究 | N=2 真实 DeepSeek Flash + Pi 1.4.0 会话闭环通过；有限科学复核 PASS_WITH_LIMITS；两篇报告均超过提示的 450 词限制 |
| PDF | 原生 Canvas 缺失依赖已修复并通过干净安装、实际工具读取/页码回执及 Canvas 渲染；知识页链接未挂载预览的问题另行修复，最终正式安装包 GUI 复验通过（macOS arm64） |

## 在线来源与复核范围

来源为 [Attention Is All You Need](https://arxiv.org/abs/1706.03762) 与 [BERT](https://arxiv.org/abs/1810.04805)。实际读取范围为前者第 1–5 页、后者第 1–3 页，模型只依据这些片段作答。第一例主要架构、训练目标和任务差异有来源支持；第二例拒绝“论文证明临床生存获益”的无依据要求，并明确没有完成全文排除性检索。候选笔记和报告均写后回读，独立检查文件字节、SHA256 与 task_reconcile completed 回执一致。报告里的来源 SHA256 指规范化读取文本，不能冒充原始 PDF 文件哈希。

该复核仅支持这两例、两篇 NLP 论文，不是全面科学能力认证。报告为 503/502 个空白分词，未满足 450 词提示，保留原结果并记录格式失败。私有会话、报告正文和账户状态不入库。

## PDF 与回归

旧公开 suite 0.1.10 的文本抽取成功但 Canvas/polyfill 警告可复现。聚合构建遗漏 pdfjs 的可选 Canvas 依赖；suite 0.1.11 顶层声明可选原生包，由安装端选择平台二进制。新 test:pdf 在隔离消费者中读取一页测试 PDF 并渲染 1082 个可见像素，检查 stdout/stderr 不含对应警告。它不替代 GUI 验收。

正式旧 DMG 中另发现：知识笔记点击 PDF 后资源目标已更新，但 ContextPanel 仅挂载在聊天页。PageResourcePreview 在非聊天页面复用宿主 ResourceSidebar，不改变插件所有权、IPC 或权限。组件回归覆盖带页码资源、关闭、重开、返回和聊天不重复预览。最终安装包还修复了窄侧栏画布宽度缩小而高度固定的失真问题，保留原生像素尺寸并以 CSS height:auto 等比显示。

MinerU/GROBID 与 B8/B8-2 按用户要求继续暂缓。

## 本轮门禁

宿主 lint、typecheck、全量 test、build、check:arch、check:plugin-api、test:upgrade、check:native-pi、check:public-plugin-host 共九项均通过，命令与日志 SHA256 见 JSON。插件修复已提交 b5addb1，合入 main 后完整检查通过并推送到 main=aea1a48。宿主最终等比缩放修正 d87aaf48 合入 main 后，九项门禁再次全部通过；日志哈希见 hostMainIntegration。npm 安全认证尚未完成时不得把 staged 标记为 published。

## 最终安装包 GUI 回执

最终 DMG SHA256 `a0907e2fba88266150ab8ba147366cad44bd100f33d6fb5171c9024c156b94be`，app.asar `cf2bc17976258f2415697ac2a6c341c78aa7130055c868ffb8c4a028725f9bc8`，源码 d87aaf48。镜像挂载后安装启动，使用隔离 profile、合成 Vault 和公开 PDF。知识笔记点击引用后显示第 3/15 页且比例正确，下一页为第 4 页；关闭后笔记保留，越界引用重开显示第 1 页及明确提示，返回后笔记仍在。22 个既有 Markdown 的哈希均未改变，仅新增一条测试导航笔记。截图、AX 和构建日志哈希见 JSON。该 PASS 不覆盖 Windows/Linux，不代表尚未公开的 npm 包已经发布。
