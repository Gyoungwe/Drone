# 2026-10-26 剩余目标收口

当前为 **PARTIAL**，不代表七类目标全部完成。机器回执见 [JSON](remaining-closure-2026-10-26.json)。用户已授权继续及有界临时云端写入；不要再次要求同一操作授权，仍需实际目标、凭据与设备。

| 范围 | 当前结果 |
| --- | --- |
| npm | **PASS**：API 1.2.0、core 0.1.9、suite 0.1.11、UI 0.2.0 全部公开，tarball 与候选一致；core/suite 两版 SDK 干净安装与实际会话通过，UI 公开安装、宿主生命周期及正式 macOS 应用加载/停用恢复通过（PDF 需要已选择项目） |
| Zotero 云端 | 缺测试库及安全配置凭据；已允许仅 1 条唯一标记临时条目，回读后删除并确认不存在；不改现有条目 |
| 用户认证 MCP | 缺实际服务地址及工具范围；本机配置仍指向 Windows 本地 Zotero 程序，不作为 Mac 可用服务 |
| Protocols.io | 缺测试资源与安全配置凭据；已允许仅 1 个临时书签的写入、回读、删除和复查 |
| 其他平台实机 | 未取得可用 Windows/Linux 桌面；SSH 可达的 CentOS 7 无 DISPLAY，不视为 GUI PASS |
| 在线研究 | 两个场景累计 7 次真实 DeepSeek Flash + Pi 1.4.0 会话；最终 297/152 词报告经明确审阅反馈后有限范围通过。首次和中间失败保留，不称首次自主科学质量 PASS |
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

## 2026-10-26 在线复核跟进

上述首次 N=2 结果保留历史含义。本次对相同两个公开论文场景进行了两轮双案例复验，以及一次方法案例定向修订，总计 **两个场景、七次真实会话**。第二轮 321/267 词虽然满足格式，但出现部分阅读范围被扩大为全文否定、哈希/联网说明含糊等问题；第三轮纠正了这些问题，但方法案例仍误概括 GLUE 的任务类别。均保留私有原始记录及公开元数据，不删除失败来制造通过率。

最终接受的方法报告 297 词、临床推断报告 152 词，均少于原要求的 450 词；观察、推断、有限页码范围、规范化文本哈希及在线模型/本地来源读取的区别已明确。主要论断由已读来源支持；方法报告经定向反馈删去不准确的指标类别概括。**这是有人审阅反馈后的有限通过，不是首次自主完成或全面科学质量认证。** 两个场景以外的论文和任务未评估。

七次会话均有真实任务批准、双来源读取、候选沉淀和 completed 交付回执；独立读取报告后，其字节长度及 SHA256 与任务回执一致。候选笔记也已独立回读并核对两源身份；临床案例笔记与报告的来源前缀/标题不同，语义经人工复核一致，不宣称两者字节相同。私有会话及报告正文不入库，元数据和哈希位于 JSON onlineFollowup。

上述在线复核时 core 0.1.9、suite 0.1.11、UI 0.2.0 仍为原 stage ID，公开 registry 均为 404；不得重复上传或改版本。Zotero 云端、认证 MCP、Protocols.io 和其他平台设备仍缺实际配置，已有写入授权不重复申请。

## npm 发布跟进与目标自查（发布完成前记录）

npm CLI 返回 E401 后，用户完成官方重新登录，并沿用原 stage 成功批准 pi-core 0.1.9。公开包 SHA256 `4ebf4bf82c2166f07a5312a1b2f6795ff88880bb79698c1f27cce4e26a6358fe`，字节、integrity 与 shasum 均匹配。按公开包名分别干净安装到 Pi 1.1.0 / 1.4.0，真实 AgentSession 各完成一次批准、四次工具调用、文件交付与 task_reconcile completed，并独立回读文件。使用确定性离线模型，不扩大在线科学验收结论。suite 原 stage 的发布认证已发起，但认证回调 GET 返回 E404，进程退出；公开版本复查仍为 404，待重新认证。UI 原 stage 保留，两者仍未公开。

用户已授权自行选择测试目标。本轮检查了 Drone 使用的 agent/zotero-web.json（不存在）、Zotero 环境配置以及实际 PROTOCOLS_IO_API_TOKEN / PROTOCOLS_IO_API_KEY（均未设置）。登记的两台远程桌面均离线；本机存在 Parallels，但 CLI 无法连接其服务，未获得可用 Windows 桌面。这只说明所检查配置不可用，不代表用户没有这些账户；未执行云端临时写入，未完成状态继续保留。

## npm 最终发布与公开消费者验证

四个目标包均已公开，本轮沿用原 stage 完成批准，没有重复上传或更换版本。最终 stage list 为空。此前 E401/认证回调 E404 和候选结果保留为历史；当前状态以本节及 JSON npmPublicationCompletion 为准。

| 包 | 版本 | 公开 tarball SHA256 |
| --- | --- | --- |
| @gyoungwe/plugin-api | 1.2.0 | `056322c91ff96fb05bc0b9d1721d834450e6146f3969b819fc1d6267c33ad960` |
| @gyoungwe/pi-core | 0.1.9 | `4ebf4bf82c2166f07a5312a1b2f6795ff88880bb79698c1f27cce4e26a6358fe` |
| @gyoungwe/research-suite | 0.1.11 | `767c37940aa32741fe133dfc57b0a75d3597521b11fd5d32904ff3d563ef794e` |
| @gyoungwe/desktop-ui-pack | 0.2.0 | `c9f468edb8eef41ca6cb7aae613eedd7040ba6be774e16295170e6dd241ddf2a` |

suite 按公开包名安装到两个全新消费者（Pi 1.1.0 / 1.4.0），每个真实 AgentSession 都完成 13 次工具调用、批准前阻断、一次批准、双来源读取、带来源回答、候选笔记写后回读及 task_reconcile completed。模型为 SDK 确定性离线 provider；不新增科学质量结论。公开 suite 的 PDF 工具读取与原生 Canvas 渲染复验通过（1082 个可见像素），stdout/stderr 无原缺失警告。

UI 按公开包名全新安装，宿主 UiPluginManager 生命周期测试通过。正式 DMG 安装应用加载这份公开安装目录，其 61 个包文件逐一与公开 tarball 一致。知识页、合成笔记、PDF 第 3/15 页、停用后保留 Vault 绑定及打开文件夹/插件管理入口、重新启用恢复页面均有截图和 AX 回执；配置最终回读为 enabled，应用已退出。恢复确认按钮的时限为 3 秒，前两次没有完成确认，最终在时限内确认成功，未将失败尝试记作 PASS。宿主研究适配器另以两个真实会话回归，7 次调用验证读取回执与会话隔离。

**保留的新观察**：新 profile 未选择项目时，知识 PDF 链接显示 `Invalid arguments for host method file:preview`；选择合成项目后正常定位第 3 页。无项目时的提示/预览行为尚未修复，登记为 `PDF_WITHOUT_SELECTED_PROJECT`，不得以本轮有项目 GUI 通过覆盖。市场首次显示旧目录快照，刷新后回读到 UI 0.2.0 与权限声明；未将初始缓存标签用于版本判定。

本轮仅更新发布证据与计划，不改变产品源码；沿用此前双仓库完整门禁的代码基线，增加上述公开安装、真实会话、PDF、宿主 UI/适配器和实际安装包检查，文档 lint 与 diff 检查另行通过。Zotero 云端、用户认证 MCP、Protocols.io 临时书签和其他平台桌面仍缺可用配置/设备，继续未完成；MinerU/GROBID 与 B8/B8-2 继续暂缓。
