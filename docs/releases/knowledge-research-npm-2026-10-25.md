# Knowledge / research npm 发布记录 — 2026-10-25

**状态：PUBLISHED_VERIFIED。** 用户授权的三个精确版本已公开发布，公开 tarball 完整性、干净安装、真实会话、Pi CLI 与宿主验证通过。两仓库发布证据已快进合入本地 main，合并后完整门禁 PASS；验证基线与记录见下方 mainIntegration。

发布源码取自 Drone main `9d5bce4fb15ee532771d6152d793f2455a86d0e6`、drone-plugins main `df4ba329821284b46d26e6f5bf86018cd806aa54`。原工作区 `codex/scientific-agent-upgrade` 的未合并工作未纳入发布。

| 公开包 | 发布时间（UTC） | tarball SHA-256 |
| --- | --- | --- |
| @gyoungwe/pi-knowledge@0.2.1 | 2026-10-25T13:39:32.318Z | `c40c15923108067842d2295fe836959ad25870ef3a7ab89361f6e778528ab6b1` |
| @gyoungwe/pi-research@0.2.0 | 2026-10-25T13:58:28.655Z | `f9cd4727910351c8210ffaf4088c9a3585d89312307a09dfc7fb3b1f452adaab` |
| @gyoungwe/research-suite@0.1.10 | 2026-10-25T14:00:35.779Z | `06eef5a4e92896a067e808af1241d2d91d7426672c4f23c201e035d7e0c666c9` |

三个版本均为各自 latest；官方元数据的 integrity/shasum、实际下载的 SHA-256 与发布前候选完全一致。包体无符号链接、私有状态或本地工作区依赖；suite 实含 core 0.1.8、knowledge 0.2.1、research 0.2.0。knowledge/research 与宿主 `plugins.lock.json` 原哈希一致，锁文件无需变动。

## 公开包验证

- 独立包 / suite × Pi 1.1.0 / latest 1.4.0 四组干净安装通过：先通过官方 registry 获取 tarball，再安装下载文件，无源码覆盖或 workspace 链接；知识包另完成两个 SDK 版本的精确包名安装与锁文件完整性核对。
- 知识公开 host 入口启动真实 worker，验证方法 2 / 软件 1，关闭重开一致。知识/研究真实 AgentSession 每组 15 次工具调度、两个同 cwd 会话，覆盖两源阅读、带来源回答、候选笔记回读、空引用阻断及跨会话读回执/账本隔离。
- suite 另加载全部扩展，验证未批准任务被拒绝且 task_status 可执行。上述研究会话单独加载 knowledge/research；不声称完成 suite 内获批研究任务全流程。
- 真实 Pi CLI 使用 `pi install npm:@gyoungwe/research-suite@0.1.10`，Pi 1.1.0 / 1.4.0 的 `/task-status`、`/drone-doctor`、`/drone-example` 均 exit 0，无冲突；历史 suite 0.1.1 在两版中仍为预期冲突失败。
- 官方 knowledge/research tarball 直接装入宿主依赖后，阅读 UI、research loop、知识交付和 research resource 共 4 文件 / 49 测试通过；验证后恢复原依赖目录。
- 宿主 lint、typecheck、完整 test、build、check:arch、migration/lifecycle、严格 extensions、upgrade、Pi 兼容及既有公开插件检查全部通过。该完整序列在 knowledge 已公开、其余发布处理中开始，消费相同锁定字节；上述 49 项公开包检查在三个版本全部下载确认后运行。
- 插件发布前 `npm ci`、`npm run check`、知识包 41 文件 / 341 测试与 smoke 通过。发布后最终 `npm run check` 再次通过，回执见机器证据。

所有消费者使用隔离 HOME/npm 配置与缓存，白名单环境变量，不读取用户凭据。模型为离线 faux provider，工具 dispatch 与会话生命周期真实；不代替在线模型或科学复核。CLI 有可选 Canvas/DOMMatrix/Path2D 警告，本轮未验收 PDF 渲染；doctor 在宿主不暴露版本时返回 unknown，工具/命令检查通过，example 返回 needs-data。

## 发布过程与失败记录

最初 E401 经用户完成官方 npm 浏览器/安全密钥登录后解除。旧 CLI 返回 0 后公共版本曾暂时 404；research 重传返回包括 E409 已 staged 的失败，但 stage 列表为空，随后该版本出现在公共 registry。最终确认公开下载字节一致；没有删除版本或改号绕过。不能只凭 404 或空 stage 列表重传。

suite 使用隔离 npm 12.2.1 创建 stage，待 validating 结束、下载核对哈希后，由用户完成 stage approve 的浏览器/安全密钥认证，再验证公开包。未改全局 npm，未记录认证回调 URL、密码、token 或 OTP。

发布前首次宿主测试因 HOME 位于 /tmp 触发临时目录权限豁免而失败，移到非 /tmp 隔离 HOME 后完整通过。首次 suite 探针错误期待无任务批准执行知识工具，修正为验证拒绝；没有修改产品授权逻辑。发布期间 lint 发现旧证据 JSON 格式，格式化后完整宿主门禁通过。失败日志哈希保留。

## 范围与未完成项

本轮没有重新构建 DMG 或重跑 GUI；分类修复的正式安装包证据保留原范围，发布不改变其字节或结论。研究迁移总体仍为 **PARTIAL**：Zotero 云端写入/身份冲突、用户自有认证 MCP、Protocols.io 写入、其他平台、在线模型质量与科学复核保持未完成；MinerU/GROBID、B8 继续暂缓。

机器回执：[knowledge-research-npm-2026-10-25.json](knowledge-research-npm-2026-10-25.json)。原始日志、合成 Vault/会话内容、tarball 与验证脚本只保存在本机私有验收目录；提交文件仅含脱敏元数据与哈希。

## 2026-10-25 main 合并与后续验收

发布证据快进合入两仓库 main，验证基线为 Drone `e5ec4f01` / drone-plugins `325ac35`。两仓库干净 npm ci 后完整门禁通过，宿主另含 migration/lifecycle、严格扩展、升级、Pi 锁定/latest 与公开插件宿主检查；无本地插件源码覆盖。宿主首轮拉取锁定 GitHub commit 遇到 HTTP/2 错误，命令级切换 HTTP/1.1 后重跑通过；失败哈希保留。后续提交仅追加文档证据，不改变运行时代码或包版本。

获批 suite 全流程的后续探针发现：全部三个扩展加载、任务批准、两源阅读、回答和候选笔记回读通过，但任务文件验收未完成，保持 **PARTIAL**。原生 core 缺少 task-read 权限适配；另 `.pi/research-notes` 属于内部路径，不能直接充当公开文件交付物。后续需修复原生权限适配并验证明确的非私有交付文件，不放宽私有路径规则。此前发布记录仅声称独立研究会话与 suite 任务拒绝回执通过，其范围不变。
