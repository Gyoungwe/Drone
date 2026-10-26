# 当前计划最终状态与恢复验收清单（2026-10-26）

这是本阶段的状态汇总，不是“全部完成”声明。用户决定将四类真实账户/设备验收先保留未完成；不继续运行这四项，不删除范围、不改标 PASS。目标当前为 BLOCKED，恢复时沿用原目标与已有有界写入授权。MinerU/GROBID、B8/B8-2 是另行明确暂缓的工作，不纳入这四项。

## 计划最终状态

| 计划/工作 | 当前状态与验收边界 | 证据 |
| --- | --- | --- |
| 插件化 v2、v3 T1–T7、v3.1、C0–C4 | 原定范围完成；含清单/工具声明、任意包 UI 发现、三个挂载区域、宿主独立性、权限展示、重名诊断、analysis registry/loader 迁移及 facade 删除 | [v3](pluginization/v3-evidence.md)、[清理计划](pluginization/gap-closure-plan.md)、[analysis 发布](releases/v3.1-pi-analysis-0.1.2.json) |
| OmicOS PR1–PR6 | 原定范围完成；雷达、页码引用、首页、证据矩阵、Paper2Agent 真实回执及 PDF 评估通过。PR6 选择继续使用 pdf.js；不代表 MinerU/GROBID 已集成 | [OmicOS 计划](omicos-platform-plan.md)、[证据](pluginization/omicos-evidence.md) |
| 权限执行、进程沙箱、第三方科研扩展 | 正式 macOS arm64 工具代理切片通过，含真实安装/加载、网络拒绝、科研读取、停用恢复及进程回收；不宣称 OS 级恶意代码隔离或所有 Pi API/OS 均覆盖 | [正式沙箱证据](pluginization/packaged-plugin-sandbox-evidence.md) |
| research / pi-research / Zotero 迁移 | 源码及 Git 历史迁移、本机 Zotero 临时条目闭环、完整本地研究 GUI、分类修复和 npm 发布已完成；含云端账户与跨平台的整体验收仍 PARTIAL | [迁移状态](research-migration-status.md)、[本机 Zotero](releases/zotero-local-roundtrip-2026-10-24.json) |
| 完整知识 UI 插件化 | 实现、公开包发布、macOS 正式安装包知识页/启停回退恢复通过；停用后保留绑定和管理入口 | [知识整页](pluginization/knowledge-page-closure-evidence.md)、[发布后验证](releases/remaining-closure-2026-10-26.md) |
| 本轮四包 npm 发布 | API 1.2.0、core 0.1.9、suite 0.1.11、UI 0.2.0 全部公开；tarball 完整性、干净安装、实际 SDK/宿主和安装包验证通过，无待批准 stage | [发布记录](releases/remaining-closure-2026-10-26.json) |
| 在线研究与科学复核 | 两个场景、两篇公开 NLP 论文、累计七次真实会话；最终 297/152 词报告经审阅反馈后在已读页码范围内通过。保留首次/中间失败，不称首次自主成功、全文验证或全面科学认证 | [在线复核](releases/remaining-closure-2026-10-26.md) |
| PDF Canvas 与知识引用预览 | 原生 Canvas、知识页挂载、等比渲染及未选择项目时预览均已修复；新 DMG 的第 3/15 页、翻页、关闭返回、越界提示通过 | [无项目专项证据](releases/projectless-resource-preview-2026-10-26.md) |
| 四类真实外部验收 | **保留未完成**：Zotero 云端/身份冲突、用户自有认证 MCP、Protocols.io 写入、其他平台桌面 | 下方恢复清单 |

以上“完成”均限于对应计划与证据范围；其他架构提案或未来工作不由本汇总宣布完成。

## 已发布版本

2026-10-26 重新读取官方 npm registry 的 latest 元数据，九包均已公开：

| 包 | 公开版本 |
| --- | --- |
| `@gyoungwe/plugin-api` | `1.2.0` |
| `@gyoungwe/pi-core` | `0.1.9` |
| `@gyoungwe/pi-knowledge` | `0.2.1` |
| `@gyoungwe/pi-research` | `0.2.0` |
| `@gyoungwe/research-suite` | `0.1.11` |
| `@gyoungwe/pi-analysis` | `0.1.2` |
| `@gyoungwe/pi-evidence` | `0.1.1` |
| `@gyoungwe/pi-connectors` | `0.1.1` |
| `@gyoungwe/desktop-ui-pack` | `0.2.0` |

版本是公开 registry 快照，不等于源码 main、宿主锁定版本或桌面安装包版本。最新元数据及 tarball/integrity/shasum 见[版本快照](releases/plan-final-status-2026-10-26.json)；安装、会话、宿主证据沿用各次发布回执，本次元数据查询不冒充重新安装验收。主要发布记录：[知识/研究](releases/knowledge-research-npm-2026-10-25.json)、[四包收口](releases/remaining-closure-2026-10-26.json)、[analysis](releases/v3.1-pi-analysis-0.1.2.json)、[其余插件](releases/v1.1-external-plugin-packages.json)。

## 后续恢复验收需要的配置

| 未完成项 | 需要准备的目标与配置 | 恢复后必须取得的真实证据 |
| --- | --- | --- |
| Zotero 云端写入/身份冲突 | 指定测试库 ID 和 user/group 类型；在 Drone 的 Zotero Web API 设置中安全保存具备该库读写权限的 key，或在实际启动进程中配置 `ZOTERO_API_KEY`、`ZOTERO_LIBRARY_ID`（个人库可用 `ZOTERO_USER_ID`）、`ZOTERO_LIBRARY_TYPE=user/group`。设置持久化位置为实际 agentDir 的 `zotero-web.json`，默认 `~/.pi/agent`，受 `PI_CODING_AGENT_DIR` 影响；不要提交/发送文件内容 | 先核对密钥权限与库身份；仅创建 1 条唯一标记临时条目，回读、核对 DOI/身份/幂等与冲突拒绝，再删除该条并确认 key 不存在、标记查询为零。冲突用例限定同一临时对象和只读/拒绝路径，不修改已有文献 |
| 用户自有认证 MCP | 服务 URL、实际传输类型、已在本机安全配置的认证方式/位置，以及可调用的工具名和允许数据范围。通过 Drone“技能与连接”的 MCP 配置或实际 agent 配置接入，确认当前 Mac 能启动/连通；Windows 本地命令不能直接用于 Mac | 真实安装包/会话完成认证、权限提示、至少一次允许的科研工具调用与回执；会话隔离、停用后拒绝、重载恢复、认证/服务失败诊断。公共 Exa/Paper2Agent 或本地 stdio 不能替代自有认证服务 |
| Protocols.io 临时书签 | 可访问的测试 protocol ID/URI，以及本机安全配置的 token（适配器识别 `PROTOCOLS_IO_API_TOKEN` / `PROTOCOLS_IO_API_KEY`）；选取该账户尚未收藏的资源。**还需接入真实账户书签状态回读**，不能仅凭 token 或协议正文 GET 判定完成 | 先证明未收藏 → 创建 1 个临时书签 → 证明已收藏 → 删除 → 证明未收藏，并核对目标身份。已有授权仅覆盖这一闭环，不扩展为协议/项目正文修改。无法证明状态时不写入、不标 PASS |
| 其他平台真实桌面 | 在线 Windows/Linux（或另一个待覆盖 Mac）的机器与 OS/架构、可操作的图形桌面连接、安装权限和隔离测试目录。可将现有远程桌面设备上线或提供可用连接；SSH 无 DISPLAY 不能替代 GUI | 对应平台的真实安装包安装/启动，知识库、首页、技能页、插件启停恢复、MCP、PDF 引用及回滚；保留截图/回执、产物哈希和清理结果。每个实际测过的平台单独判定，不扩写覆盖范围 |

Protocols.io 的具体代码限制：`packages/backend/src/services/reversible-write-adapters.ts` 中，`createProtocolsBookmarkWritePortFromEnv` 即使存在 token 仍返回 undefined；`createProtocolsBookmarkWritePort` 需要注入 `bookmarkStateProbe` 才能证明写前/删除后未收藏，当前并未以该 probe 验证写后“已收藏”。恢复时须先明确可用的真实账户读取机制并补齐连接与正向回读，不能只设置环境变量就声称已可验收。这一实现/接入条件连同账户条件一并保留，当前不继续修改代码。

凭据只通过本机设置或安全凭据配置提供；聊天只需给出非敏感目标、工具范围、配置位置与设备可用状态。已有临时写入授权不重复申请；若目标、操作或数据范围改变，再单独确认新增范围。

## 恢复顺序与通过标准

1. 用户明确恢复其中一项或全部；重新读取双仓库 main 与本机配置状态，先做只读连通/权限/身份检查。
2. 在测试账户/库、隔离 profile 与 Vault 中运行真实安装包或真实会话；仅使用已批准的工具和临时写入范围。
3. 外部写入逐项保存写后回读、清理及不存在证明；中断后先对账，不自动创建第二个对象。
4. 证据只提交版本、哈希和脱敏结果；更新计划中的对应一项，通过相关门禁后提交推送。其他未验收项保持原状态。

## 代码与构建基线

本次文档整理前：Drone main `16318a4173914353598bbadd8805a612c84d7b55`，drone-plugins main `d2f76a0894ba7de685ba90117f1db63ebd8176f5`，均与远程一致且工作区干净。无项目预览产品源码为 `090fbe7f`；macOS arm64 DMG SHA256 `229ce073158ef3426f95e225c3637d8a24eed6ddee5ba8e375f66b9cbd34be2d`，本机从镜像安装验收通过。这里不宣称新建 GitHub 桌面版本或上传发行资产。

产品源码已通过宿主完整门禁和插件完整检查，合并后架构/插件集成回读见[专项 JSON](releases/projectless-resource-preview-2026-10-26.json)。本次仅整理文档及 registry 元数据，执行文档 lint、链接与 diff 检查，不重复生成产品测试结论。
