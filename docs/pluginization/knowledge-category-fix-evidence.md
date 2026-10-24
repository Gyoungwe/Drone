# 方法笔记分类修复与正式安装包验收

2026-10-25，双仓库分支 `codex/knowledge-category-fix`。**RESEARCH-GUI-CATEGORY 已关闭（PASS）**，本轮只处理该分类缺口，研究迁移总体保持 PARTIAL。机器回执见 [knowledge-category-fix-2026-10-25.json](../releases/knowledge-category-fix-2026-10-25.json)。

## 原因与实现

旧 worker 与 recent 分组将 frontmatter type 和完整路径拼接，再优先匹配 paper/software；`Library/Methods/mapping-tools.md` 的 `tools` 因此盖过 `type: method`。此前证据称“标题启发式”，更准确的是文件名/路径关键词；笔记标题字段没有参与这一规则。renderer 最近笔记标签又独立猜测路径，造成第二处不一致。

插件新增内部 `note-category.ts`，计数与最近分组共用：显式类型优先；无类型时采用最近的已知分类目录；最后才使用文件名。无法映射的显式类型保留 other。宿主最近标签直接消费 worker 分组，搜索/图投影遵守类型与目录优先级。没有改写笔记、复核状态或索引格式，也没有新增 IPC 合同。

插件源码 `831e3995c1a1dd35a8e77632978c06457e5c9f8c`，宿主源码 `e38312a9de65a14a8cc5bd6b2c7186685ef3943f`。宿主锁定远端 commit 与 tarball SHA-256，并在无 `DRONE_PLUGINS_DIR` 的条件下完成 npm ci、fetch 和扩展重建。`pi-knowledge@0.2.1`、`research-suite@0.1.10` 是未发布候选；研究包仍为未发布的 `pi-research@0.2.0`。没有修改 main 或发布 npm。

## 回归与门禁

- 插件定向回归：修复前 11 项中 8 项失败；修复后 11 项通过，包括带冲突名称的 method/software/paper/idea、未知显式类型、无类型目录回退，以及真实 worker 重开索引后的计数与分组。
- 宿主定向回归：4 项通过，覆盖目录/类型冲突和最近标签采用实际分组。
- 首次宿主类型检查发现数组索引可能为 undefined；改用字符串切片后类型检查通过。失败日志单独保留，不计 PASS。
- 插件完整检查通过，含知识包 41 文件 / 341 测试、clean install、smoke 和真实 Pi SDK 1.1.0 / latest 1.4.0 研究矩阵。
- 宿主全量测试通过：后端 236 文件通过 / 3 跳过、1917 测试通过 / 17 跳过；前端 161 文件 / 826 测试通过。其余 workspace 测试也通过。
- 宿主 lint、typecheck、test、build、check:arch、plugin-api migration/lifecycle、严格扩展检查与 test:upgrade 全部通过；typecheck/test/build 包含准备钩子，没有 ignore-scripts。静态产物严格检查 17 项通过，不能替代真实 GUI。

## 正式安装包 GUI

从 DMG 挂载复制到 `/tmp/drone-knowledge-category-installed/Drone.app`，卸载映像后启动；应用为本地未签名、未公证的 Drone 0.33.4（Electron 43.3.0）。DMG SHA-256 为 `39835dad55a2cfb6f797ada60b3940b7a14e2bdf0f6279874d1724e9137180d0`，ASAR 为 `77c6c8bedf25eb3eb3ac8ac0e55cb5b7d7891ada70ed8f8ab43368d23d1e595d`；随包 worker 与锁定插件字节一致。

| 对照 | 原生 GUI 结果 |
| --- | --- |
| 旧正式包复现 | 同一既有隔离库：16 篇，软件 7、方法 0；方法笔记错误标记软件 |
| 新正式包概览 | 16 篇，软件 4、方法 1；原笔记标签为方法。另两条显式非软件类型记录不再被路径 tools 误计软件 |
| 方法页 | 只列出原方法笔记，路径仍为 Library/Methods |
| 软件页 | 4 条软件记录，原方法笔记不存在于该列表 |
| 阅读器 | 从方法页打开原笔记，显示 L1–32、原哈希前缀 694b17dfcaa9、来源与人工复核区域 |
| 重启 | PID 53891 退出后以 PID 55841 重启同一安装应用/状态，仍为方法 1、软件 4；方法页仍正确 |
| 字节保持 | 全部 23 个 Markdown 文件前后 SHA-256 相同；原方法笔记完整哈希 694b17dfcaa9716ebbc40fe5010895d5e68227e82ce73af3387aa5258fd099b8；无需重新沉淀或搬动笔记 |

6 张截图与安装包/日志哈希记录在机器回执；原生窗口操作完成后测试应用正常退出。没有发送新的模型提示、没有执行入库/人工复核或账户写入。本轮关闭分类问题，不把该结果扩展为科学验证。

## 验收范围与剩余边界

真实 GUI 使用从 DMG 安装的 macOS arm64 应用，以及上轮已经存在的隔离测试库；本机生产 Vault、账户凭据和科学结论不在本轮验收范围。原始截图、会话和 Vault 正文仅留本机，仓库只保存哈希和状态。

Zotero 云端写入/身份冲突、用户自有认证 MCP、Protocols.io 写入仍未完成；上述候选包尚未发布 npm；其他平台、在线模型质量和科学复核没有关闭。MinerU/GROBID 与 B8 保持暂缓。
