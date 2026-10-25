# 知识整页与原生研究流程收口实施计划

依据：[用户已确认设计](../specs/2026-10-25-knowledge-page-closure-design.md)。完整知识 UI 归插件；停用时保留宿主轻量入口。候选版本不等于 npm 已发布。

| 顺序 | 任务 | 完成条件 | 当前状态 |
| --- | --- | --- | --- |
| 1 | 发布证据合入双 main | 门禁通过，远端 SHA 回读一致 | PASS：Drone a2f5e662 / 插件 12140b8 |
| 2 | 修复原生任务回读 | 三个实际扩展在 Pi 1.1.0 / 1.4.0 完成经批准的文件交付；拒绝/隔离回归 | PASS（候选源码与回归） |
| 3 | 保留知识 UI 历史并迁移所有权 | 插件拥有页面/嵌入组件/文案/样式；宿主不保留完整副本 | PASS（候选源码与回归） |
| 4 | 公开知识 UI 合同与宿主挂载 | 数据端口、声明、shim、knowledge.surface 同步；故障/停用可恢复 | PASS（候选源码与回归） |
| 5 | 双仓库与候选 tarball 检查 | 类型、测试、构建、架构、生命周期、干净安装 | PASS |
| 6 | 正式 macOS 安装包 GUI | 页面、设置、阅读、图谱、审阅、切换、停用恢复实际交互 | PASS：最终 DMG；真实合成候选应用回读 |
| 7 | 更新证据与推送实现分支 | 机器回执、计划、INDEX 一致；未完成项保留 | 文档与提交完成；分支远端以交付回读为准 |

发布边界：新候选 pi-core / research-suite / plugin-api / desktop-ui-pack 需要另行按精确版本取得 npm 发布授权。Zotero 云端、认证 MCP、Protocols.io 写入、其他平台与在线科学质量仍未完成；MinerU/GROBID、B8 暂缓。

证据：[说明](../../pluginization/knowledge-page-closure-evidence.md) · [机器回执](../../releases/knowledge-page-closure-2026-10-25.json)。正式 GUI 与组件/fixture 回归各自标明范围；无账户写入或科学质量扩张声明。
