# 迁移后研究工作流：正式安装包 GUI 验收

2026-10-24，分支 `codex/research-workflow-gui`。**本地两源研究闭环 PASS，研究迁移总体仍为 PARTIAL**。
机器可核对的提交、安装包、35 条工具回执、2 个会话、7 张截图和门禁日志哈希见
[本轮证据](../releases/research-workflow-gui-acceptance-2026-10-24.json)。

## 实际运行边界

- 源码 `1d544db9fb6da9d153a024d3dd8c3a748792e167`；插件仓库 `ff1d65998716df4831540957857a945bed3626a7`，本轮未修改插件仓库。
- Drone 0.33.4 macOS arm64 DMG SHA-256：`96adf863f9cd46238ee29cec3db2324c307c448f931b0e58d99a483a9e085496`。
- 将 DMG 挂载后复制到 `/tmp/drone-research-accepted-installed/Drone.app`，卸载磁盘映像，再启动该应用；`app.asar` SHA-256：`6a110152e82cde8415783245e3802eb48f02116883d699288193937cfc1ca2e2`。这是本地未签名、未公证安装包，不是开发服务器。
- HOME、agent、userData、project、knowledge 配置和 Vault 均隔离在 `/tmp/drone-research-workflow-accepted`，不使用正式 Vault 或账户凭据。GUI 操作使用原生窗口点击、输入及截图。
- 本地脚本模型只编排工具调用；安装包、Pi SDK dispatch、知识 worker、公开 HTTP 下载、持久化与 GUI/IPC 均真实运行。不是在线模型质量或科学有效性验收。模型总结文字不能替代工具回执。

## 已完成的链路

| 环节 | 实际结果 |
| --- | --- |
| 绑定与授权 | GUI 确认隔离 Vault；任务计划只允许隔离 project/Vault 写入，不包含远程计算或账户写入 |
| 本地优先 | preparation/search 返回 ready；跨轮重复读取不再被误判为重复写入 |
| 两源归档 | 下载 minimap2 v2.28 README 与 SAMtools 1.20 README，落盘字节和回执 SHA-256 一致 |
| 读取与负向门禁 | 实际读取两份归档的前 75 行；未绑定 claims 时 finalize 返回 `must reach claims_bound`，不报成功 |
| 引用绑定与回答 | 绑定原始文档第 55 行和第 1 行，最终 `answerable=true`、archive_count=2、2 个结构化绑定；科学验证仍为 false |
| 草稿沉淀 | 写入 Library/Methods 下 `type: method`、`status: draft` 笔记，保留来源与未解决问题；真实读取返回 L1–32 和哈希 |
| 总结与课题 | 保存 run summary，创建 Wiki/课题，首页可见该课题；记忆注明仅用于导航 |
| GUI 引用阅读 | 点击会话中的实际笔记引用，阅读页显示 L1–32、哈希、2 个来源链接、2 个反向链接；人工复核留空 |
| 重启新会话 | 退出 PID 94195，重启为 PID 95263；不同会话 ID 重新检索并阅读笔记，哈希完全一致 |
| 过期与恢复 | 外部修改隔离测试笔记后，正式包 `research_resume_topic` 返回 `stale`、`reason=changed`；恢复原字节，再由工具回读并通过 GUI 打开，原 SHA-256 一致 |

原笔记 SHA-256 为 `694b17dfcaa9716ebbc40fe5010895d5e68227e82ce73af3387aa5258fd099b8`。
恢复字节不自动将课题标为已核验；任务中的 human_review 里程碑也未伪造完成。
本轮读取的是上游 README 行号，绑定回执的 `originalFulltextReadThisTurn=false`；不冒充 PDF 全文或页码验收。

过期测试首个脚本步骤误请求研究模式未暴露的 `edit`，未发生编辑；已保留该记录。
改用外部测试进程追加标记，模拟用户编辑，再通过真实 GUI 会话查询过期状态；恢复也由外部测试进程完成。
截图 `stale-receipt.png` 展示调用过程，具体 `stale/changed` 以落盘工具回执为准。

## 验收中修复的阻塞

1. **会话工具清单丢失**（`63ded0ef`）：SDK hook 离开注册上下文后，把只读研究工具当作副作用。任务 journal 现在绑定所属宿主解析清单；独立 bundle/event bus 回归覆盖跨轮读取和另一会话不继承声明。
2. **旧产物被新清单背书**（`6e02fe32`）：默认保留 extension bundle 却更新传递依赖哈希。构建器现在拒绝该情况，并要求 `--force` 重建；回归验证失败时不能刷新 manifest。已重建实际发布资源。
3. **知识阅读器缺宿主端口**（`1d544db9`）：backend 与扩展是不同模块实例，前者没有 workspace config 读取端口。backend 显式配置该端口；独立构建扩展的回归重现并修复 `Workspace config host is not configured`。

上述失败安装包不计为最终 PASS。源码提交、失败阶段及其安装包哈希保留在证据 JSON 的 `discardedAttempts`。

## 门禁

宿主 lint、typecheck、test、build、check:arch、migration/lifecycle、check:extensions、test:upgrade 全部通过；
插件仓库完整 `npm run check` 通过，Pi 1.1.0 / latest（本轮为 1.4.0）矩阵通过。
最终宿主后端 236 文件通过/3 跳过、1917 测试通过/17 跳过；前端 161 文件、824 测试通过。
最终 typecheck/test/build 使用 `--ignore-scripts`，已单独执行准备、资源和插件门禁；不是跳过这些主命令。
插件门禁复用相同 `ff1d659` 上的结果，之后仅修改宿主阅读器。静态产物检查 17 PASS、4 路由合同另行记录，不能替代上述 GUI 证据。

## 明确保留的未完成项

- **RESEARCH-GUI-CATEGORY（当时 OPEN；2026-10-25 后续已关闭）**：旧包中方法笔记文件名含 tools 时误归软件，方法计数为 0，存储与阅读器正确。原始失败快照保留；显式 type/目录优先级修复、回归及新正式包重验见[分类修复证据](knowledge-category-fix-evidence.md)。旧表述“标题启发式”更正为文件名/路径启发式。
- Zotero 云端写入/身份冲突、用户自有认证 MCP、Protocols.io 写入，仍缺账户环境或可核实的具体范围；过去的本机/公开只读 PASS 保持原范围。
- 当时的 `pi-research@0.2.0` 与 `research-suite@0.1.9` 未发布 npm；后续 suite 候选已更新为 0.1.10（仍未发布）；原 GUI 验收阶段不发布 npm；本次 main 合并也未发布 npm。
- 其他系统/架构、在线模型质量、PDF 解析与科学结果复核不由本轮关闭。MinerU/GROBID 和 B8 继续暂缓。
- 脚本模型在任务自动接续中会重复总结并触发“本轮没有检索”提示；本轮只以实际回执判断已执行步骤，不将其作为在线模型体验已验收的证据。

截图、原始会话和 Vault 内容仅留在本机；仓库仅保存元数据、状态及哈希。

## 2026-10-25 main 合并门禁

`codex/research-workflow-gui` 已从 `8a2b323c` 快进合入 `main=fe41db7e`。插件仓库仍为 `ff1d659`，没有版本或源码变化。
合并后在干净工作区、无 `DRONE_PLUGINS_DIR` 覆盖的条件下，完整运行 lint、typecheck、test、build、check:arch、migration/lifecycle、check:extensions、test:upgrade 和插件仓库 `npm run check`，全部通过。typecheck/test/build 本次包含原有准备钩子，从锁定远端提交构建并验证插件 tarball。

typecheck 与 build 的首次尝试各在准备钩子的 GitHub TLS 拉取阶段失败，尚未进入对应主命令；重试原命令成功，两份失败日志保留在机器证据 `mainIntegration.failedAttempts`。测试中生成清单曾短暂变化，完整构建后恢复至 Git 基线，pi-core 字节哈希也与原 GUI 验收一致。
本次未重做 DMG/GUI；快进合并不改变原验收源码，原安装包证据继续有效。上述未完成项保持原状态，研究迁移整体仍为 PARTIAL。
