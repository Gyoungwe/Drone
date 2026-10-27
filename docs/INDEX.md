# Drone 项目索引

> 改动代码前读这份索引，定位「该改哪块」；改动完成后检查是否过时（文件增删、导出变化、职责变化都要同步）。
> 排查疑难问题优先看 `docs/PITFALLS.md`（症状索引 + 事故复盘）；打包发版流程见 AGENTS.md 与 `.local/docs/release.md`。
> 本文件只做**导航**：职责一句话 + 指到源码；实现细节以代码为准，坑记 PITFALLS，不在此堆积。

当前计划最终状态、九个 npm 公开版本及四项未完成验收的恢复配置，统一见[阶段状态汇总](plan-final-status-2026-10-26.md)。
下一代“通用 Pi 宿主 + 可卸载功能与 UI 同包”的[架构设计](superpowers/specs/2026-10-26-native-pi-plugin-architecture-design.md)已批准并开始实施；[P0–P7 执行计划](pluginization/native-plugin-implementation-plan.md)记录阶段状态，[SDK 运行时证据](pluginization/native-plugin-runtime-evidence.md)区分真实会话、执行适配与自动发现，[P1 正式安装包切片](pluginization/native-plugin-p1-packaged-evidence.md)记录窗口作用域后台的启停、拒绝、恢复与退出，完整领域迁移仍未完成。[P2 知识只读共享 owner](pluginization/native-plugin-knowledge-readonly-evidence.md)记录候选包、权限/资源边界、实际会话和安装包验收及完整功能缺口。
原生迁移的[能力切片证据与当前缺口](pluginization/native-plugin-capability-slice-evidence.md)与执行计划同步；完整历史分别见[计划归档](archive/native-plugin-implementation-plan-through-2026-10-27.md)和[切片证据归档](archive/native-plugin-capability-slice-evidence-through-2026-10-27.md)。历史 PASS 只适用于原版本与范围，四项外部验收不属于本轮 P0–P7。
锁定 SDK 的 33 API、41 事件、28 UI 成员与三条运行路径的支持/拒绝边界见[原生 API 盘点](pluginization/native-pi-api-compatibility-matrix.md)；P0 仍未完成，不能用格式兼容替代运行 API 验收。
当前四包源码锁与宿主 `6c9400c6` 的独立 checkout 根门禁见[整合回执](releases/native-plugin-integrated-host-2026-10-28.json)，包含失败与修复重跑，领域边界仍为 INCOMPLETE。较早 `c29c5037` 的[干净宿主回执](releases/native-plugin-clean-host-2026-10-27.json)保留历史范围，不代替当前结果。
版本化的通用 pi-core 宿主合同位于 `packages/plugin-api/src/core.ts`，桌面端通过 `packages/desktop/src/main/optional-plugin-hosts.ts` 按已安装包清单发现 `coreHostLoader` 并贯穿会话组合；task host 通过既有 `PluginNativeSession` 生成每会话 adapter，与标准 Pi 根入口共用 canonical owner；完整任务 UI、动态安装停用与正式安装包工作流仍待验收。

后继 [应用 owner 安装包证据](pluginization/native-plugin-app-owner-packaged-evidence.md)基于 `561a370c` 的真实 DMG，覆盖两个真实离线会话间的身份切换、同一后台实例复用和停用恢复；不代表知识 native/UI 已共享领域 owner，也未关闭零领域插件宿主门禁。后继[关闭流程安装包证据](pluginization/native-plugin-shutdown-packaged-evidence.md)记录真实 SDK 互等/异常回归及活跃模型请求期间正常退出。

P2 后继[设置与修复后的正式安装包验收](pluginization/native-plugin-knowledge-state-gui-evidence.md)固定 `ad3cd189` DMG，覆盖状态保存拒绝/回读、真实模型工具、停用恢复和正常退出；完整知识迁移与资源关闭新合同仍待下一轮验证。
知识状态 broker 的 `state.ensureDirectory` 提供显式受授权的单层初始化，读取不建目录；合同与限制见[状态能力](pluginization/native-plugin-state-capabilities.md)。

## 硬约束（改代码前必知）

- renderer 绝不 import pi 包，只经 `window.pi`（preload）通信
- Pi SDK 运行时值导入统一收敛在 `packages/backend/src/session-engine/**`（钉 1.1.0）；`pi-backend.ts` 仍是兼容门面
- 新增 IPC 四处同步：`shared/src/ipc.ts` → `desktop/src/preload/index.ts` → `main/ipc/`（按域选文件）→ backend；事件转发在 `main/ipc/index.ts`
- preload 必须保持 CJS（sandbox 限制，见 PITFALLS）
- 新增 UI 文案：`i18n/zh.ts` + `en.ts` 双字典都要加
- zustand selector 必须返回稳定引用（模块级空对象/数组；#185 无限渲染，见 PITFALLS）
- 新增 renderer hook/store 要暴露给插件 = 源模块 + `plugins/host-api.ts` + `plugins/env.d.ts`（DroneUiApi）+ `main/ui-plugins/build.ts` SHIM + `resources/drone-ui.d.ts`（必要时 SPEC.md 导出清单）五处同步
- JSON 持久化一律走 backend `JsonStore`（原子写 + 损坏语义），不自写 fs
- `@drone/compute` 只依赖 `@drone/shared` 与 Node 标准库；宿主连接、SSH、Pi SDK 和 Electron 适配留在组合根（R7）。
- NGS/生信编排门禁见 `packages/shared/src/analysis-orchestration.ts`：阶段到 `capability_load` 能力映射、数据/重复数/参考版本/授权检查，以及执行、结果审查和发布暂停状态机。
- 持久化宿主门面见 `packages/backend/src/services/analysis-orchestration.ts`：通过 `JsonStore` 保存分析快照并在重启后恢复；计算提交仍必须经过既有 Compute 授权与 B7 preflight。
- NGS 任务控制器适配见 `packages/backend/src/services/analysis-task-controller.ts`：按阶段自动激活 `capability_load` 能力，绑定已评估的 Compute 规格，并在提交和重启恢复后继续执行门禁。
- NGS review→delivery 闭环也由该控制器负责：收集并读取已校验产物，调用会话模型生成审查报告，持久化限制说明，并仅在审查通过后完成交付。
- 分析适配器由 `@gyoungwe/pi-analysis/host` 提供版本化 registry/loader：通用编排器只消费公开的 adapter contract、readiness 与确定性结果检查；契约快照、工具合同和宿主执行上下文会进入 provenance。当前提供 bulk RNA-seq/DESeq2 和 assembly 适配器，并持久化 adapter、workflow、method 版本及 artifact lineage/reproducibility 状态。
- analysis/evidence 只读工作流组合位于 `packages/backend/src/services/analysis-evidence-host.ts`：宿主消费 manifest 声明的 `analysis_prepare_evidence`、`evidence_validate_manifest` 与 replay 元数据校验 `evidence_verify_replay`，要求准备计划 `execution=host-required`，并返回内容寻址稳定回执；缺失插件能力显式为 `unavailable`，持久化 checkpoint/replay receipt 仍由 evidence service 通过 `JsonStore` 持有。
- 分析证据与不可变 checkpoint 位于 `packages/backend/src/services/analysis-evidence.ts`，通过 `shared/host-api/evidence.ts`、preload、main IPC 和 Artifacts 面板提供本地查看、分叉、导入/导出和重现回执；checkpoint 分支不会继承执行授权或 review。
- checkpoint、分支工作区和可复现 evidence capsule 见 `packages/backend/src/services/analysis-evidence.ts`：冻结内容寻址字节，分支不继承执行审批，失败分支可在校验 checkpoint/context 后重试，replay 分开记录环境与输出匹配状态；capsule 支持 private/restricted/public 三档发布，导入会重新校验 manifest、字节哈希和 omission 清单，并拒绝凭据/私有状态路径与被省略的私有 blob。桌面端通过 `packages/shared/src/host-api/evidence.ts`、`packages/desktop/src/main/ipc/evidence.ts` 和产物面板 `packages/desktop/src/renderer/src/components/panel/EvidencePane.tsx` 提供冻结、分支、导入/导出、回放及复现结果查看。
- Wisp/OpenScience 的官方源码快照、功能研究和迁移建议见 [open-science-wisp-adapter-research.md](open-science-wisp-adapter-research.md)。

架构升级规划（v2，提案）：见 [architecture-v2.md](architecture-v2.md) 与任务拆解 [architecture-v2-tasks.md](architecture-v2-tasks.md)。
A5-1～A5-4 的收益、当前完成度和建议执行顺序见 [A5 领域包收敛摘要](a5-impact-summary.md)。
本轮 A5 生产切片的提交、验收与剩余兼容层见 [A5 迁移验收记录](releases/a5-migration-2026-10-18.json)。
插件化执行计划与当前门槛见 [final-pluginization-plan.md](final-pluginization-plan.md)；本机构建产物和能力验收清单见 [v3-desktop-capability-acceptance-plan.md](v3-desktop-capability-acceptance-plan.md)。插件仓库构建、分层热插拔、会话边界重载与回滚的下一阶段设计见 [plugin-hot-reload-plan.md](plugin-hot-reload-plan.md)。双仓库维护、架构红线和 npm 发版执行规约见 [drone-maintenance skill](../.agents/skills/drone-maintenance/SKILL.md)。
插件化 v2 的 P1 迁移边界与 extensions 归属清单见 [pluginization/p1-inventory.md](pluginization/p1-inventory.md)；执行主计划见 [pluginization/v2-plan.md](pluginization/v2-plan.md)，本轮验收记录见 [pluginization/P1-evidence.md](pluginization/P1-evidence.md)。
P2 知识源码与插件入口迁移、插件仓库全量门禁和 Git 历史验收见 [pluginization/P2-evidence.md](pluginization/P2-evidence.md)。
插件平台 v3 的 T1–T7 执行计划见 [pluginization/v3-platform-plan.md](pluginization/v3-platform-plan.md)，插件清单和宿主合同见 `../drone-plugins/docs/PLUGIN-SPEC.md`，实现证据见 [pluginization/v3-evidence.md](pluginization/v3-evidence.md)。下一阶段 P1 的第三方扩展、外部 MCP 与 Protocols.io 真实只读验收见 [pluginization/next-stage-p1-evidence.md](pluginization/next-stage-p1-evidence.md)。
截至 2026-10-23，v3 合并基线为 Drone `main=a6a6ade0ad3f86224c2a580d19a6d5b1d4230a6c`、drone-plugins `main=127db2658f465337fe9ad936692302d8536c09ba`；公开包版本与真实安装/加载证据见 [`v1.1.0 npm 发布证据`](releases/v1.1.0-npm-packages.json)、[`pi-analysis 0.1.2 发布证据`](releases/v3.1-pi-analysis-0.1.2.json) 与 [`PR5 真实回执证据`](releases/v1.1-pr5-paper2agent-acceptance-2026-10-23.json)。
2026-10-24 的插件仓库权限声明门禁已合入并推送到 `drone-plugins/main=046f8cbb5d0b3e9d7534e0dd7252b1c91d61ad2a`；该提交只增强 manifest 检查与规范，不改变公开包版本或 `plugins.lock.json`，门禁和宿主绑定证据见 [P0 权限执行证据](pluginization/p0-security-api-evidence.md)。

插件化与 OmicOS 计划缺口清理顺序见 [pluginization/gap-closure-plan.md](pluginization/gap-closure-plan.md)。
范围外与未来可选工作的下一阶段优先级、依赖和授权矩阵见 [next-stage-scope-plan.md](next-stage-scope-plan.md)。
P0 权限执行切片、plugin-api v1 合同治理与当前进程沙箱实现见 [p0-security-api-evidence.md](pluginization/p0-security-api-evidence.md)；进程沙箱代码位于 `packages/backend/src/plugin-sandbox.ts`，回归测试位于 `packages/backend/test/plugin-sandbox.test.ts`。不支持网络权限的运行时拒绝加载插件；正式安装包现携带经校验的 Node 26.12.1 worker，macOS arm64 原始第三方 TS 包的真实 GUI/联网拒绝/停用恢复见 [正式沙箱证据](pluginization/packaged-plugin-sandbox-evidence.md)。自动发现代理位于 `packages/backend/src/session-engine/sandbox-loader.ts`，双 trust pass 回归位于 `packages/backend/test/plugin-sandbox-loader.test.ts`，Pi 1.1.0 的 import 前钩子与安装脚本禁用补丁位于 `patches/@earendil-works+pi-coding-agent+1.1.0.patch`。 合并点 `main=84244eb6` 的最终门禁见同一证据的 `mainIntegration`；未完成项不变。
2026-10-24 研究边界分支已合入双仓库 `main`，源码基线 Drone `c14f3154` / drone-plugins `ff1d659`；合并后检查与未完成项见[研究边界证据](releases/research-boundary-acceptance-2026-10-24.json)。
迁移后正式安装包本地两源研究闭环、重启新会话接续、来源过期/恢复与当时发现的分类问题见 [研究 GUI 证据](pluginization/research-workflow-gui-evidence.md) 和 [机器回执](releases/research-workflow-gui-acceptance-2026-10-24.json)；2026-10-25 已快进合入 `main=fe41db7e`，合并后完整门禁见 `mainIntegration`；分类后续状态见下方修复证据。

方法笔记误归软件的修复、分类优先级回归与正式安装包验收见 [分类修复证据](pluginization/knowledge-category-fix-evidence.md)；两分支已快进合入 main（宿主 a853230e / 插件 c43f7b4），合并后双仓库最终门禁见机器回执 `mainIntegration`，其余未完成项不变。

2026-10-25 知识/研究插件 npm 正式发布与发布后验收见 [发布记录](releases/knowledge-research-npm-2026-10-25.md) 和 [机器回执](releases/knowledge-research-npm-2026-10-25.json)。三个目标包已公开，下方版本快照同步更新。
2026-10-26 的公开包、在线两场景研究复核（累计七次真实会话）和 PDF 修复进展见 [剩余验收](releases/remaining-closure-2026-10-26.md)；未完成的账户与其他平台验收保留状态。非聊天页面资源预览由 `renderer/src/components/diff/PageResourcePreview.tsx` 挂载，复用现有资源读者；研究聚合包原生 PDF Canvas 安装检查归插件 `research-suite test:pdf`。
知识整页所有权迁移（方案 1）候选已合入双仓库 main，合并后门禁与此前正式 macOS 安装包验收均通过，见 [验收证据](pluginization/knowledge-page-closure-evidence.md)；实施见 [实施计划](superpowers/plans/2026-10-25-knowledge-page-closure.md) 与 [已确认设计](superpowers/specs/2026-10-25-knowledge-page-closure-design.md)。宿主 `components/knowledge/` 只保留挂载、绑定状态回退及事件桥；完整界面、组件回归、文案与样式移入插件仓库的 UI 包，保留 Git 历史。公开 `KnowledgeUiPort` / `KnowledgeUiBindings` / `KnowledgeSurfaceProps` 位于 `packages/plugin-api/src/ui.ts`；`ui-wire.ts` 由 `scripts/generate-knowledge-ui-contract.mjs` 按 `packages/plugin-api/scripts/knowledge-ui-contract.json` 的有限清单生成并校验。宿主适配在 `renderer/src/plugins/knowledge-api.ts`，嵌入区为 `knowledge.surface`；无插件及停用恢复回归见 `KnowledgeView.test.tsx`。
原生 Pi 的任务文件回读适配已迁至插件仓库 `packages/pi-core/src/native-task-readback.ts` 与同包测试；它复用所属会话当前批准的产物范围，Desktop 仍使用现有权限引擎。公开 core 0.1.9 与 suite 0.1.11 的历史干净安装及双 SDK 会话证据保留；本轮 core 0.2.0 属源码锁候选，宿主不再保留或构建旧 `packages/pi-core/`。发布后 UI 0.2.0 正式安装包验收见上述剩余验收；未选项目 PDF 修复及新安装包验证见[专项证据](releases/projectless-resource-preview-2026-10-26.md)。空项目资源参数合同位于 `shared/src/host-api/app.ts`，preload→主进程校验→文件读取回归见 `desktop/src/preload/file-preview-contract.test.ts`，不改变文件 confinement 规则。

知识库分类由插件 `src/core/note-category.ts` 统一决定；worker 计数与最近分组共享规则。插件知识 UI 的最近标签读取分组结果，路径推断只用于已有搜索/图投影；回归见 `../drone-plugins/packages/pi-knowledge/test/category.integration.test.ts` 和 `../drone-plugins/packages/desktop-ui-pack/ui/knowledge/KnowledgeHome.test.ts`。
跨 bundle 的知识阅读器回归见 `packages/backend/test/knowledge-host-ui-reading.test.mjs`，backend 显式配置工作区读取端口。任务门禁的会话工具清单隔离回归见 `packages/backend/test/task-manifest-session.test.mjs`；SDK 回调的只读判定由插件 `packages/pi-core/src/task-runtime/register.mjs` 绑定所属宿主，避免跨轮只读操作误触重复写入门禁。
P1 第三方扩展、外部 MCP 与 Protocols.io 真实只读验收见 [next-stage-p1-evidence.md](pluginization/next-stage-p1-evidence.md)；研究运行时迁移边界见 [research-migration-status.md](research-migration-status.md)。 GUI 真实 Electron 验收回执见 [next-stage-gui-acceptance-2026-10-24.json](releases/next-stage-gui-acceptance-2026-10-24.json)。
OmicOS 文献雷达与阅读闭环的六个 PR 计划见 [omicos-platform-plan.md](omicos-platform-plan.md)，实现证据见 [pluginization/omicos-evidence.md](pluginization/omicos-evidence.md)，原始 handoff 见 [claude/drone-omicos-handoff.md](../claude/drone-omicos-handoff.md)。
P3 宿主消费锁定的 `@gyoungwe/pi-knowledge`、本地 macOS DMG/ZIP 构建与资源验收见 [pluginization/P3-evidence.md](pluginization/P3-evidence.md)；P4 自动维护调度、IPC、UI 和插件测试见 [pluginization/P4-evidence.md](pluginization/P4-evidence.md)。
P4/P5 外部验收记录见 [pluginization/acceptance-1.md](pluginization/acceptance-1.md)、[pluginization/acceptance-2.md](pluginization/acceptance-2.md) 与 [pluginization/acceptance-3.md](pluginization/acceptance-3.md)（`acceptance-3.md` 为最终复核）。
两份计划的旧执行日志已按 30 行上限归档到 [`docs/archive/`](archive/)。
插件化前端交接、宿主/插件仓库边界和 UI 验收顺序见 [pluginization-ui-handoff.md](pluginization-ui-handoff.md)；设计稿源文件见 [Drone 插件化界面.html](design/plugin-ui/Drone%20插件化界面.html)，构建产物四视图视觉对照由 [`scripts/check-visual-design-comparison.mjs`](../scripts/check-visual-design-comparison.mjs) 生成 [视觉证据](releases/visual/drone-visual-comparison.json)；资源搜索连接器设计见 [resource-search-connectors.md](resource-search-connectors.md)；科研工作台 v3 规划见 [scientific-workbench-v3-plan.md](scientific-workbench-v3-plan.md)。

“技能与连接”页 v2 的 Pi 官方市场、Drone 插件仓库、连接器、MCP、Skill 和手动 Skill 仓库更新设计见 [skills-connections-ui-v2-plan.md](skills-connections-ui-v2-plan.md)。
Paper2Agent 生成的 MCP 服务器接入方式和证据边界见 [paper2agent.md](paper2agent.md)。

主机页的 SSH 配置发现、主机选择器和科研计算卡片设计见 [host-picker-ui-plan.md](host-picker-ui-plan.md)；实现位于 `packages/desktop/src/main/ssh-config.ts`、`packages/shared/src/host-api/compute.ts` 和 `packages/desktop/src/renderer/src/components/panel/ComputePane.tsx`。

`.pi/tsconfig.json` 对生成的 `.pi/extensions/*.mjs` 保持可检查的资源边界；知识、任务、研究运行时由领域包 TypeScript 源码和 checked-in package-owned artifacts 负责，根 `npm run typecheck` 会串接 `npm run check:pi`。`.pi/lib` 兼容树已删除。

2026-10-19 实机验收问题、截图编号与下一轮修复状态见 [real-device-acceptance-20261019](real-device-acceptance-20261019/README.md)。

插件公开合同见 `packages/plugin-api/`：它是依赖零实现的 `@gyoungwe/plugin-api` 包，暴露 `DroneHostPort`、能力协商、`drone-result/v3` 结果状态和回执类型、host-neutral analysis contract、版本化 `AnalysisHostPort` registry/loader 合同、research connector/write registry 的 `ResearchConnectorHostLoader`/`ResearchWriteAdapterHostLoader` 合同，以及隔离任务验收 registry 的 `TaskAcceptanceHostPort` 合同。`@gyoungwe/pi-analysis/host` 是宿主唯一的分析 adapter 入口；`npm run check:plugin-api` 会同时检查生成的 UI 插件 API、包产物、临时 tarball 安装，以及已绑定 `../drone-plugins` workspace 是否引用 Drone 源码相对路径。

通用领域可用性只读投影位于 `packages/backend/src/plugins/domain-capabilities.ts`，由组合根登记当前 provider；它是迁移诊断边界，不承载领域实现或替代插件生命周期。
本轮切片的命令回执和剩余边界见[能力发现与 clean-prefix 包验收](pluginization/native-plugin-capability-slice-evidence.md)。

任务级一次授权与自动续作：见 [task-authorization.md](task-authorization.md)（可写目录、总预算、取消与校验边界）。

研究技能包的锁定来源、许可记录、缓存与离线恢复：见 [research-skill-packs.md](research-skill-packs.md)。

云端知识库、科研化产品语言与知识库自动维护的升级方案：见 [knowledge-cloud-research-upgrade.md](knowledge-cloud-research-upgrade.md)。

WebDAV 云端知识库第一阶段实现、读写边界、同步/冲突和离线提示：见 [knowledge-webdav.md](knowledge-webdav.md)。

PR #113 与 1–6 的整合证据、生成物修复和未决风险：见 [PR113 整合审查](superpowers/reports/2026-10-11-pr113-integration-review.md) 与 [PR113 逐项审查](superpowers/reports/2026-10-11-pr113-review.md)。

客户端控件、事件、IPC 行为和科研风格 UI 升级基线：见 [核心客户端 UI 盘点](ui-audit/2026-10-11-core-client-ui-inventory.md)、[设置/知识/WebDAV/研究 UI 盘点](ui-audit/2026-10-11-settings-knowledge-ui-inventory.md)、[白色科研风格覆盖矩阵](ui-audit/2026-10-11-white-ui-coverage.md)、[术语审计](ui-audit/2026-10-11-terminology-audit.md)、[术语改写表](ui-audit/2026-10-11-terminology-map.md) 与 [发布治理和 UI 升级计划](superpowers/plans/2026-10-11-release-governance-and-ui-upgrade.md)。

v0.26.1 的验证命令、生成物检查、资产清单和“先验证再建标签”顺序见 [发布门禁清单](releases/v0.26.1-gate-manifest.json) 与 [验证记录](releases/v0.26.1-validation.md)。

v0.33.0 无证书跨平台资产、发布 run 和 SHA-256 清单见 [发布说明](releases/v0.33.0.md) 与 [资产校验清单](releases/v0.33.0-assets.sha256)。

v0.33.1 公开插件宿主收口与无证书补丁发布说明见 [发布说明](releases/v0.33.1.md)。
v0.33.2 知识库 worker 修复、onboarding 状态和主线指标见 [发布说明](releases/v0.33.2.md)；离线主线评估证据见 [`docs/evals/mainline-2026-10-19.json`](evals/mainline-2026-10-19.json)，本机 arm64/x64 正式资源验收见 [`v0.33.2-knowledge-package.json`](releases/v0.33.2-knowledge-package.json)。
v0.33.3 发布候选的构建后/上传后安装包验收设计与本机 unsigned DMG/ZIP 证据见 [发布说明](releases/v0.33.3.md) 与 [资产验收证据](releases/v0.33.3-asset-validation.json)。
v0.33.4 技能仓库来源卡片、GitHub 限流回退更新检查、市场栏和 macOS 安装包验收见 [发布说明](releases/v0.33.4.md)、[资产验收证据](releases/v0.33.4-asset-validation.json) 与 [P4 UI 验收证据](releases/v0.33.4-p4-ui-acceptance.json)。
v0.33.5 插件门禁收口见 [插件门禁证据](releases/v0.33.5-plugin-gates.json)：包含 Skill 仓库管理、worker 回滚、真实 registry `pi-core@0.1.5`/Pi 1.1.0、native MCP 和深色四视图对照；Pi CLI 版本更新替换、外部 MCP 与交互式 Electron GUI 仍按边界记录。

历史首批 `@gyoungwe` npm 包的版本、tarball、完整性和干净安装验收见 [npm 发布证据](releases/v0.33.0-npm-packages.json)；历史 `pi-knowledge@0.1.1`、`pi-core@0.1.3`、`research-suite@0.1.5` 的 task ownership、onboarding commands、弃用和真实 Pi CLI 回归见 [v0.33.2 Pi CLI 证据](releases/v0.33.2-pi-cli-regression.json)。当前公开版本见下方 registry 快照与本次知识/研究发布记录；历史 `0.1.1` 冲突证据仍保留在 [v1.1 onboarding commands 证据](releases/v1.1-onboarding-commands.json)。

2026-10-21 正式 npm 发布与官方 registry 干净消费者、Pi loader、公开插件宿主验收见 [v1.1.0 npm 发布证据](releases/v1.1.0-npm-packages.json)。
当前公开 registry 版本：`@gyoungwe/plugin-api@1.2.0`、`pi-core@0.1.9`、`pi-knowledge@0.2.1`、`pi-research@0.2.0`、`research-suite@0.1.11`、`pi-analysis@0.1.2`、`pi-evidence@0.1.1`、`pi-connectors@0.1.1`、`desktop-ui-pack@0.2.0`；历史版本证据保留在各 release JSON，不与当前源码 head 混写。
2026-10-23 PR5 Paper2Agent 公共包干净安装与正式 Drone 安装包原生 MCP 回执见 [PR5 真实回执证据](releases/v1.1-pr5-paper2agent-acceptance-2026-10-23.json)。

2026-10-23 PR1 文献雷达真实安装包运行、入库和同日稳定键去重见 [PR1 雷达验收证据](releases/v1.1-pr1-radar-acceptance-2026-10-23.json)。
2026-10-23 v3 T3 合并后真实 macOS 安装包、npm tarball UI 插件三页面挂载与停用恢复见 [T3 UI 验收证据](releases/v1.1-t3-ui-acceptance-2026-10-23.json)。

v1.1 `pi-analysis` 的 0.1.0 历史闭环见 [v1.1 pi-analysis 证据](releases/v1.1-pi-analysis.json)；当前 0.1.2 的公开 registry tarball、安装后 Pi loader、host loader 和宿主验证见 [pi-analysis 0.1.2 发布证据](releases/v3.1-pi-analysis-0.1.2.json)。

v1.1 外部插件仓库的 `pi-evidence`、`pi-connectors`、`desktop-ui-pack` registry tarball、Pi loader 和 Desktop 宿主生命周期验收见 [v1.1 外部插件包证据](releases/v1.1-external-plugin-packages.json)。

Drone 状态链五轮测试原始证据、报告和实现留痕：见 [五轮迭代记录](superpowers/reports/2026-10-04-drone-five-round-iteration.md) 与 [状态链修复设计](superpowers/specs/2026-10-04-drone-state-chain-fixes-design.md)。

任务路由过程看板的列式草图与边界：见 [任务路由过程看板设计](superpowers/specs/task-route-process-board-design.md)、`ui-preview/task-route-process-board.html` 和 `scripts/check-task-route-process-board-sketch.mjs`。

全量历史 PR 模拟用户测试分类与执行规约：见 [simulated-user-testing-plan.md](simulated-user-testing-plan.md)（覆盖 PR #1–#97，九大用户任务分类、63 个核心用例矩阵与下一阶段实施优先级）；测试执行汇总报告见 [simulated-user-testing-report.md](simulated-user-testing-report.md)。

历史 PR 与下一阶段架构整合审计：见 [pr-architecture-upgrade-audit.md](pr-architecture-upgrade-audit.md)（按知识沉淀、通用生信、动态决策、持久化、扩展性和交付硬化分组，并映射到 ResearchCase / KnowledgeSnapshot / DecisionProposal / CapabilityVersion / Evidence 的目标架构）。

科研模拟测试脱敏夹具与大文件规范：见 [research-test-fixtures.md](research-test-fixtures.md)（服务器真实大文件勘查登记、脱敏样本 SHA-256 校验清单、动态大文件合成器与机构登录用例阻塞标记）。

Windows PowerShell 调试桌面 dev：在 `packages/desktop` 中运行 `npx electron-vite dev --remote-debugging-port=9224`；根目录 `npm run dev -- --remote-debugging-port=9224` 的参数不会穿过嵌套的 workspace 脚本。验证 `http://127.0.0.1:9224/json` 返回页面列表后再运行 CDP 冒烟脚本；普通开发仍用根目录 `npm run dev`。

## 总览

npm workspaces monorepo，9 个 workspace 包；知识、原生研究与完整知识 UI 的源码归外部插件仓库：

```
packages/
├── shared/     IPC 契约层（纯类型 + 通道常量，三方共享）
├── plugin-api/ 插件公开合同（HostPort、能力协商、结果/回执、analysis 与知识 UI 合同）
├── backend/    纯 Node；pi SDK 适配层
├── research/   文献回执与来源交付合约（TS 包，迁移中）
├── compute/    远程计算与声明式工作流领域包（TS 包，B3 垂直切片）
├── inquiry/    研究状态层领域包（TS 包，B5a 五本账与工作区合同）
├── discovery/  研究发现领域包（TS 包，B5d–B5f 内核、批评、多路径与评测）
├── extensions/ 扩展入口的构建源（迁移中）
└── desktop/    Electron 应用（main / preload / renderer）
```

| 脚本 | 用途 |
|---|---|
| `scripts/build-extensions.mjs` | 将 `packages/extensions/src/*.ts` 打包到 `.pi/extensions/*.mjs`（默认保护已有产物，并写入 `.build-manifest.json` 记录源/产物哈希） |
| `scripts/check-native-pi.mjs` | 静态扫描一方工具注册，按 fixture 映射原生 Pi 可用性、源码位置和目标插件包（不读取生成的 `.pi` 产物） |
| `scripts/smoke-backend.mts` | 真实 SDK 冒烟（需 `AI_OPS_API_KEY`） |
| `scripts/smoke-error-events.mts` | 报错系统冒烟：本地 HTTP 伪造 provider（401/429）驱动 PiBackend，零凭证离线 |
| `scripts/smoke-subagent.mts` | subagent 冒烟 |
| `scripts/smoke-evaporation-ui.mjs` | 蒸发设置二态 CDP 冒烟（dev 实例带 `--remote-debugging-port=9224` 运行后执行） |
| `scripts/check-report-ui.mjs` | 隔离 Electron 验收：桌面长回答贴底、主动上翻、引用短标题/完整路径/点击、运行记录展开；不调用真实模型 |
| `scripts/check-local-desktop-artifact.mjs` | 本机构建产物验收：不启动 Electron，核对 main/preload/renderer 产物、四视口路由标记、插件启停合同、skill/MCP/connector/memory/结果红线资源；`--strict` 另检查已 stage 的 MCP 资源 |
| `scripts/check-ui-skill-acceptance.mjs` | UI-01 与 SKILL-01 的隔离真实宿主验收：构建并执行内置 UI 插件 bundle，验证 renderer contribution/禁用/重载/持久化；用 pinned Pi SDK + offline faux provider 验证真实 `/skill:` invocation 与禁用反证；输出无凭据 JSON 摘要 |
| `scripts/check-remaining-gates.mjs` | 收口 `MEM-01`、`MCP-01`、`CONN-01`、`REDLINE-01` 的隔离跨实例/SDK/只读连接器/领域门禁验收；输出无凭据 JSON 摘要 |
| `scripts/eval-mainline.mjs` / `fixtures/mainline-questions.json` | 固定 20 题×两轮的本地回答率评估；使用离线 faux provider，统计本地命中、联网次数、引用可解析率和耗时，写入 `docs/evals/mainline-<日期>.json` |
| `packages/backend/test/mem-gate.test.mjs` | `MEM-01` 隔离跨实例 topic memory：`DRONE-MEM-001`、来源回读、stale/changed |
| `packages/backend/test/mcp-connector-gates.test.ts` | `MCP-01` 本地 stdio marker 的启用/真实调用/关闭重载，以及 `CONN-01` 只读唯一词 source receipt 与关闭重试 |
| `scripts/check-scientific-sandbox.mjs` | 在支持网络权限的 Node 中干净安装独立科研扩展，验证禁网、Europe PMC 读取及关闭/恢复；[真实回执](releases/scientific-sandbox-acceptance-2026-10-24.json)，不等同正式 Electron 验收 |
| `scripts/stage-plugin-runtime.mjs` | 校验官方归档摘要并暂存 Node worker、LICENSE 与 Pi schema peer；锁位于 `packages/desktop/plugin-runtime/lock.json`，beforePack 自动调用，生成二进制不入 Git |
| `scripts/check-public-plugin-host.mjs` | 临时 npm prefix 安装公开 registry 包，并通过 Pi loader、进程沙箱代理和 Desktop UI 宿主验收；独立第三方包需另行授权 |
| `scripts/check-protocols-readonly.mjs` | 对公开 Protocols.io 协议页执行无凭据 GET；不执行写入 |
| `packages/backend/test/skill-acceptance-sdk.test.mjs` | `SKILL-01` 真实 Pi SDK + offline faux provider 的 `/skill:research-workflow` invocation、visible skill、provider call 和 `disable-model-invocation` 自动选择反证；显式 slash 的 manual-only 语义 |
| `packages/backend/test/redline-acceptance.test.mjs` / `npm run check:redline` | REDLINE-01 隔离验收：通过 publication/orchestration/metacognitive 门禁注入缺来源、stale source、数字/方法漂移、重复数不足、断线和权限拒绝；断言阻断原因、差异路径与 sealed audit proof |
| `scripts/check-plugin-api.mjs` | 宿主 DroneHostPort 合同和本地 npm pack 安装→升级→回滚→卸载生命周期验收 |
| `scripts/check-pi-compat.mjs` | Pi 1.1.0 锁定全套依赖、latest 与 next 标签的隔离兼容矩阵（含已安装的 pi-analysis、pi-evidence、pi-connectors） |
| `scripts/check-public-plugin-host.mjs` | 从 npm registry 安装三个公开插件包到干净 prefix，验证 Pi loader、工具清单、公开包生命周期和 Desktop UI 生命周期；不调用模型或真实连接器 I/O |
| `scripts/check-market-plugin-lifecycle.mjs` | 离线真实 npm pack/install/update/uninstall 市场 fixture，输出生命周期回执；公开 Pi/Drone registry 包仅在授权的真实宿主运行中验收 |
| `scripts/smoke-channel-watch.mts` | channel-watch 机制冒烟 V1–V6 |
| `scripts/replay-trace.mts` | 事件 trace 离线重放（`--last` 自动找最新；排查 UI 状态问题首选） |
| `scripts/replay-evaporation.mts` | 上下文蒸发离线 replay 调参（误杀率/体积曲线；`--core` 与线上实现同构对比；默认数据指 `.local/replay-data/sessions` 副本，指向正式 `~/.pi/agent` 会直接 abort） |
| `scripts/verify-vertex-auth.mts` | google-vertex 认证链路隔离验证（临时 `PI_CODING_AGENT_DIR`，不碰正式配置）：api_key 路径会 401「API keys are not supported by this API」→ 只有 ADC/服务账号可用 |
| `scripts/verify-vertex-login.mts` | google-vertex 完整登录桥验证：PiBackend.login 交互（select 剔除 api-key）→ ADC credential 落盘 auth.json → configured |
| `scripts/repro-full.mjs` | 把 trace 事件序列直接注入 renderer 复现（#185/白屏类问题，手法见 PITFALLS 0.5.0） |
| `scripts/shoot-rail.mjs` | UI 动画 CDP 确定性逐帧截图模板（SessionRail 演示，换场景照抄三步：触发状态 → pause 动画钉 currentTime → captureScreenshot） |
| `scripts/cdp-eval.mjs` / `cdp-shot.mjs` / `shoot-demo-gif.mjs` | CDP 页面单次求值 / 截图 / demo gif |
| `scripts/check-task-route-process-board-sketch.mjs` | 校验任务路由过程看板草图的 Todos 阶段列、代表性过程卡和越界内容 |
| `scripts/test-compute-runner.py` / `scripts/test-compute-runner.sh` | 使用显式真实可执行 fixture 验证 runner 协议、断线后持久化、幂等提交、取消与校验回收 |
| `scripts/test-compute-docker.sh`、`scripts/compute-fixtures/` | 可选 Docker SSHD + 单节点 Slurm 集成 fixture；需用户启动 Docker daemon，不用于生产 runner；细节见 [compute.md](compute.md) |
| `scripts/b3-pipeline/` | 显式 opt-in 的真实 nf-core/rnaseq 3.18.0 test-profile smoke 与 digest-backed provenance；缺 Nextflow/OCI digest 时拒绝提交 |
| `docs/real-rnaseq-execution-plan.md` | 从本地 fixture 到真实 RNA-seq 结果的输入、设计、运行、QC、绘图和写作门禁；禁止把演示产物当科研结论 |

依赖补丁：`patches/` + patch-package（root devDep + postinstall）。目前一处 `thinking-orbs+0.3.1.patch`（移除 IntersectionObserver+visibilitychange 门控，Win11 恢复事件丢失会冻住 rAF）。改法：手改 `node_modules/thinking-orbs/dist/index.{es.js,cjs}` 两份 → `npx patch-package thinking-orbs`；升级该包前重评补丁是否仍需要。

数据与凭证：用户数据在 `~/.pi/agent/`（sessions/*.jsonl、auth.json、models.json、trust.json、workspaces.json），与 CLI pi 共享；**dev/预览态自动隔离**到 `~/.pi/agent-dev/`（`main/dev-agent-dir.ts`，含五配置种子拷贝）。会话事件 trace 在 `sessions/<dir>/traces/trace-<sessionId>.jsonl`。应用自身数据在 Electron `userData/`：tabs.json、ui-state.json、backgrounds/（renderer 经 `pi-bg://background/<文件名>` 协议加载，main 注册）。

## packages/shared — IPC 契约层

**何时改这里**：新增/修改 IPC 通道或跨进程类型（然后按硬约束四处同步）。

| 文件 | 关键导出 | 职责 |
|---|---|---|
| `src/ipc.ts` | `IpcChannels`、`PiApi` | 通道名常量 + `window.pi` 完整类型（sessions/settings/packages/app/ui-plugins/login/compute 全域通道 + 同步属性 `platform`） |
| `src/host-api/` | `defineDomain`、`SessionsContract`、`AppContract`、`PermissionsContract`、`PackagesContract`、`KnowledgeContract`、`ComputeContract`、`DiscoveryContract`、`DecisionsContract`、`InstitutionalContract`、`SubagentsContract`、`UiPluginsContract` | TypeBox Host API 域契约；供 desktop bindContract 与适配器复用；`ComputeContract` 覆盖主机登记、健康、作业日志、终端和引导状态，远端副作用由 backend adapter 继续做授权门控；`DiscoveryContract` 提供 B5d–B5f 内核会话、批评、多路径、探索计划和评测的只读投影，关闭会话保留 desktop 权限；`DecisionsContract` 提供项目决策账本的列表、撤销和人工确认；`KnowledgeContract` 覆盖知识库管理、审核、语义索引、研究运行路线与 Zotero 状态；机构访问保留 desktop 权限；`SubagentsContract` 覆盖会话内子智能体列表、派发、中止与运行记录 |
| `src/contracts.ts` + `src/research-contracts.ts` | `VersionedRecord`、`ResearchCase`、`KnowledgeSnapshot`、`CapabilityRequest/Version`、`DecisionProposal/Decision`、`RunAttempt` | P0 统一版本合同、SHA-256 内容校验和旧 AnalysisContext/PlanProposal/EvidenceCheckpoint 的无副作用迁移；未来 schema fail closed，RunAttempt 从 unknown 恢复必须显式回到 queued，迁移不会继承执行授权；`contract-hash.ts` 保持浏览器可用 |
| `src/compute.ts` | `ComputeHost`、`ComputeAuthorization`、`ComputeBudget`、`checkComputeAuthorization` | 远程主机/作业/终端/引导共享 schema，以及任务计算范围、路径和预算的 fail-closed 检查；B1 runner 通过稳定 adapter 接入 |
| `src/session.ts` | `SessionMeta`、`SessionStats`、`AvailableModel`（可选 `thinkingLevels`/`imageInput`，缺省 fail-open）、`SessionEvent`、`SessionMessage`、`UiState`、`PermissionRequest`、`PermissionMode`（default/fullAccess）、`TrustRequest`、`LoadedResources` 等 | 会话/事件跨进程类型。`SessionEvent` = pi `AgentSessionEvent` ∪ Drone 自有 UI 事件（`subagent_mutex`/`stream_guard_tripped`/`model_wait`/`subagent_run`，不进 trace）；`SessionMessage` union：user/assistant（均带 `entryId` 供 fork/撤回；user 专属 `skill`/`sourceText`）+ `role:"image"`（show_image 回放）+ `role:"subagent"` |
| `src/transcript/` | `reduceEvent`、`messagesToUIMessages`、`buildChatRows`、`deriveTurnChanges`、`deriveTurnTimings` | **UI 消息状态机（桌面共用同一份）**：`types`（UIMessage/StreamingState 等）、`helpers`（事件载荷解析）、`reducer`（pi 事件 → UI 状态）、`mapping`（历史回放）、`parse-patch`（unified diff 结构化解析）、`turn-files`（按轮聚合文件变更）、`turn-timings`（按轮计时派生 + runEndedAt 定格）、`chat-rows`（行序列分组 + 轮末行定位规则）、`meta-summary`（工具语义分类统计） |
| `src/process-lanes/` | `deriveProcessEvents`、`deriveProcessLaneState`、`deriveProcessLaneTurns`、`estimateProcessLayout`、`PROCESS_DEMO_STEPS` | 公开 transcript 事件到六泳道位置的纯归约器与布局投影；状态只消费可见回执，不读取私有思维或写入任务、研究、引用账本 |
| `src/errors.ts` | `UiError`、`classifyLlmError`、`buildLlmUiError`、`buildStreamGuardUiError`、`DETAIL_MAX_LENGTH` | 统一报错信封：错误卡数据源（live reducer / 历史回放 mapping / Composer 内联共用）；`classifyLlmError` 按 401/429/context/网络模式分类，误判只影响标题措辞 |
| `src/ui-plugins.ts` | `UiPluginManifest`、`UiPluginInfo`、`UiPluginsConfig`、`KNOWN_UI_SLOTS`、`KNOWN_UI_REGIONS`、`UI_PLUGIN_ANCHORS` | UI 插件跨进程类型：manifest（slots/contributions/headless 三选一）/ 扫描合成信息 / 持久化配置 / 事件载荷；`KNOWN_*` 供 main 校验，与 renderer `plugins/slots.ts` 对齐（registry.test.ts 断言） |
| `src/packages.ts` | `CatalogPackage*`、`NPM_NOT_FOUND_SENTINEL`、`isSubagentPackage` | pi.dev 社区包目录类型（设置页扩展面板用；`isSubagentPackage` 启发式仅供安装警示，非安全边界） |
| `src/settings.ts` | `ProviderInfo`、`CustomProviderInput`、`KNOWN_APIS`、`LoginAuthPrompt/LoginEventPayload` 等 | provider 设置类型（含订阅登录 OAuth 镜像） |
| `src/subagent.ts` | `SubagentRunData`、`extractSubagentRuns`、`isSubagentToolName`、`SubagentPanelRun`/`SubagentPanelAgent`/`SubagentDispatchInput`、`SUBAGENT_DISPATCH/RESULT_CUSTOM_TYPE`、`subagentRunDataFromPanelRun` | 子代理结果提取（结构检测不依赖工具名；single/parallel/management 三形态），backend 历史映射与 renderer 共用；面板派发（会话内专属调用）的运行记录 / 快照 / 派发输入 / 会话文件记录解析，见 [subagents-panel.md](subagents-panel.md) |
| `src/skill-invocation.ts` | `parseExpandedSkillInvocation`、`formatSkillCommand` | 成功展开的 skill 调用展示投影：严格匹配 SDK canonical producer 格式，提取安全 name/args；backend 命名/撤回与 renderer 实时映射共用 |
| `src/todo.ts` | `TodoItem`、`TODO_TOOL_NAME`、`extractTodos` | todo 工具契约（backend 注入与 renderer 面板共用） |
| `src/example-tasks.ts` + `.json` | `EXAMPLE_TASKS`、`exampleTaskForDirection`、`composeExampleTaskPrompt`、`missingExampleTaskInputs` | 六方向内置示例任务（数据 + 首条消息组装纯函数；不建任务、不写文件）；说明与新增方法见 [example-tasks.md](example-tasks.md) |
| `src/permission-settings.ts` | `PermissionSettings*`、`PermissionProbe*`、`PERMISSION_SELF_PROTECTION_PATTERNS`、`PERMISSION_KNOWN_TOOLS` | 设置 → 权限 面板的 IPC 形状（快照 / 保存输入与结果 / 试算 / 审计尾部）+ 自保护模式常量；backend 校验与 renderer 编辑模型共用；见 [permissions-settings.md](permissions-settings.md) |
| `src/update.ts` | `UpdateState` | 自动更新事件载荷（`available.manual=true` = 当前构建无法自动安装，跳 release 页） |
| `src/marquee-motion.ts` | `tailOffsetForWidths` | 流式正文 tail-follow 位移纯函数（无 DOM，可单测） |

## P5–P10 knowledge / reliability map

| Area | Files | Responsibility |
|---|---|---|
| Zotero literature | `.pi/extensions/zotero-literature.mjs` + `../drone-plugins/packages/pi-research/src/core/zotero-*.ts` + `skills/zotero-literature` | Zotero owns PDFs/metadata; Vault `Library/Papers` notes are citable knowledge; CLI preferred, MCP optional/disabled（用户级 Pi `mcp.json` 用 `enabled: false` 关闭，`disabled` 会被 adapter 忽略，见 `docs/zotero-literature.md`「MCP config dialects」）。写入：`research_zotero_save` 只新建；`research_zotero_update` 经网页 API 更新已有条目。 |
| Topic lifecycle | `../drone-plugins/packages/pi-knowledge/src/core/topic-memory.ts` + `.pi/extensions/obsidian-workbench.mjs` | bounded Vault+project topic memory, continuation/resume, stale-source checks, proposal/artifact linkage; memory is navigation only |
| Specialist orchestration | `../drone-plugins/packages/pi-knowledge/src/core/{specialists,specialist-host,orchestration-policy}.ts` + `backend/src/knowledge/specialist-runner.ts` | deterministic dispatch decisions, queue/concurrency/run/tool/token/reported-cost budgets, cancellation-safe isolated workers |
| Human management | `../drone-plugins/packages/pi-knowledge/src/core/ui-service.ts` + desktop knowledge IPC/preload + `packages/desktop/src/renderer/src/plugins/knowledge-api.ts`；页面位于 `../drone-plugins/packages/desktop-ui-pack/ui/knowledge/{SemanticManagement,TopicManagement}.tsx` | semantic settings/index batches and project-scoped topic browsing/archive/resume；UI 只经公开 `window.DroneUI.knowledge` 调用宿主 |
| Knowledge loop | `extensions/src/internal/knowledge-extension.ts`（`LOCAL_FIRST_GUIDANCE` 每轮引导：本地优先 → 联网 → `research_deposit_knowledge` 按 paper/software/method/idea 沉淀 → 带来源回答）+ `../drone-plugins/packages/pi-knowledge/src/core/wiki-review.ts`（`autoApplyWikiProposal`：自动审核模式下新页面 / Agent 生成过的页面直接写入，人工改过的页面仍待审核） | 知识闭环；Library 新增 `Ideas` 类型（三处 profile 定义同步：`vault-profiles.ts` / `vault.ts` / `vault-layout.ts`） |
| Knowledge reuse lifecycle | `../drone-plugins/packages/pi-knowledge/src/core/reuse.ts` | 将真实来源 receipt 聚合成带 project/workspace、证据等级、Analysis/Evidence checkpoint 引用的 `KnowledgeSnapshot`；按 freshness、方法/参考/输入 manifest 与上下文门禁复用，并通过可注入存储端口维护可复用索引 |
| Observability | `shared/src/transcript/run-inspector.ts` + Desktop `RunInspector` | retrieval counts/fallbacks, public specialist stop reasons, actual read paths; no private chain-of-thought |
| Release gates | `scripts/{benchmark-semantic,stress-knowledge,check-upgrade-release,check-packaged-desktop,check-ui-skill-acceptance,check-remaining-gates}.mjs` + `packages/backend/test/mcp-connector-gates.test.ts` | synthetic stress, production-pipeline benchmark, consolidated gate, isolated packaged-app smoke, UI/skill real-host acceptance, MCP marker and read-only connector close/reopen acceptance |

## 外部 `pi-knowledge` 源码包

`@gyoungwe/pi-knowledge` 的 canonical runtime source 位于绑定的 `../drone-plugins/packages/pi-knowledge/`：`src/core/` 保存知识领域源码与测试，`src/extension/` 生成 native Pi 入口和 worker，`src/maintenance/` 提供自动维护纯函数，`src/host.ts` 是 Drone backend 的唯一 host API。Drone 通过 `plugins.lock.json` 锁定仓库提交和 tarball SHA-256，构建时复制到 `vendor/plugins/pi-knowledge/`；宿主不再保留 `packages/knowledge` 或知识 worker 源码。

知识入库标准（`drone-note/1`）：`ingest-policy.ts`（知识 / 运行结果 / 临时内容九条有序分类规则）、`ingest-frontmatter.ts`（frontmatter 模式、受限 YAML 解析、校验与确定性序列化）、`ingest-identity.ts`（DOI / PMID / arXiv / ISBN / URL 规范化、去重键、内容与结论哈希）；均为纯函数，尚未接入写入路径。规范见 [knowledge-ingest-standard.md](knowledge-ingest-standard.md)。

## 外部任务 owner 与通用宿主装配

任务状态机、guard、acceptance registry、规范化、授权续作及 SDK checkpoint 恢复由 `../drone-plugins/packages/pi-core/src/task-runtime/` 和 `src/milestone-plan.ts` 拥有。标准 Pi 根入口与版本化 `taskHostLoader` 使用同一 owner 构造器；每个 native session 拥有独立 registry/journal，官方 Pi event bus 只在同一会话内路由版本化声明与当前 journal。知识/Zotero 扩展声明验收器，不再创建任务引擎。

宿主 `packages/backend/src/session-engine/extensions.ts` 实际消费已安装 task host 的 `createNativeSession`；缺少 adapter 时能力 unavailable，无本地引擎回退。`packages/extensions/src/internal/runtime/` 仅保留旧扩展仍使用的通用 scheduler/slot/tool 声明机制；`packages/tasks`、compiled runtime、反向 workbench handler 和 acceptance collector 已删除。已发布 `plugin-api/tasks` 的旧 helpers/字段保留 1.x 类型兼容，不作为生产 owner。

规则回归位于插件 `packages/pi-core/test/task-runtime/`，宿主的 `test/task-plugin-activation-sdk.test.mjs` 与 `test/packed-core-host-sdk.test.ts` 检查实际安装包、生产 SessionService、独立会话和停用后的基础权限；`scripts/knowledge-ui-smoke/task-owner.mjs` 从安装包读取 UI fixture 的 journal，不复制算法。完整任务 UI/可选资源生命周期和正式安装包验收仍未完成。

## packages/research — 宿主研究合同与知识桥

`@drone/research` 保留 `connectors.ts`、`write-connectors.ts`、`capability-discovery.ts` 的 shared/宿主端口合同，以及 `run-summary.ts` 的知识沉淀组合桥。证据状态机、归档、回执、provenance、Zotero 与 research-run-ui 已由外部 `@gyoungwe/pi-research/host` 提供；宿主不再维护这些领域模块的副本。

知识项目身份：`@gyoungwe/pi-knowledge/host` 导出的 project identity 是唯一解析器（日常空间会话选择 `/project` → 工作区 `knowledgeProjectId` → 目录派生 `<目录名>-<sha10>`，无 `research-workbench` 回落）；`research_loop`、`research_deposit_knowledge`、`research_summarize_run`、来源 / 讲解归档、知识检索范围与 WikiSkill 共用。规则与旧笔记迁移见 [knowledge-project-identity.md](knowledge-project-identity.md)。

## packages/compute — 远程计算与工作流领域包（B1–B3 / B5c / B7）

`@drone/compute` 只依赖 `@drone/shared` 与 Node 标准库，遵守 R7；它不连接 Electron、Pi SDK、backend 或真实集群。`src/types.ts` 定义 B1 runner-facing `WorkflowSpec`、B3 `ComputeWorkflowSpec` 与 B5c 的先验/注册/失败检索端口；`src/workflow.ts` 提供模块目录、类型/环检查、稳定哈希和提交前注册门禁；`src/nextflow.ts` 将已批准图编译为 DSL2 和配置，并通过注入的 runner 做 `-preview`；`src/repair.ts` 提供仅修改声明式 spec 的有界（最多三次）自主修复循环与“我替你决定的”决策记录；`src/executor.ts` 暴露 direct/Slurm 的 argv seam；`src/rnaseq.ts` 提供固定 nf-core/rnaseq 3.18.0 revision、官方 test profile 与已解析容器 digest 记录；`src/qc.ts` 解析 MultiQC 并保留 `reviewed=false`、`qcVerified=false`、`scientificallyVerified=false`；`src/provenance.ts` 提供可适配到 `@gyoungwe/pi-research/host` 的远程执行声明并拒绝未解析 digest；`src/runner.ts`、`jobs.ts` 只定义固定子命令和状态机，真实 SSH/Slurm 由宿主适配层接入。部署资源 `packages/backend/resources/compute-runner/runner.py` 实现同一 stdin JSON 协议的 POSIX/Windows runner。

B7 的数据集、样本表、分析计划、功效/MDE、公共数据校验和确定性 RO-Crate 实现在 `src/dataset.ts`；宿主把设计合同放入任务授权并以合同哈希绑定。远端 transport、桌面投影和本地/ Docker/Slurm fixture 的运行说明见 [compute.md](compute.md)。

## packages/inquiry — 研究状态层领域包（B5a）

`@drone/inquiry` 只依赖 `@drone/shared`，遵守 R8。`src/models.ts` 定义产物、发现、问题/假设、分析尝试、Agent 决策与异步重跑账本；`src/lineage.ts` 校验安全路径、checksum、引用和血缘环；`src/provenance.ts` 提供最多 20 层父链的无正文来源投影；`src/reproducibility.ts` 提供代码指纹 + run-provenance 三态纯判定；`src/storage.ts` 提供宿主可注入的账本存储接口，并附带排序稳定、原子写入的文件适配器与 Node 22 `SqliteInquiryStorage`，schema v2 将旧 v1 与早期重跑记录迁移并保留读取兼容；`src/workspace.ts` 提供 `runs/` 冻结后只移动的晋升计划、索引页和只读清理 dry-run；`src/service.ts` 汇总宿主调用，撤销决策只标记账本与下游产物待复核，不触发外部写操作，并提供授权异步重跑。backend 的 `services/inquiry.ts` 通过 `canonicalProjectId` 将真实工作区 realpath 作为桌面项目账本键，按项目懒创建隔离 SQLite，并通过宿主注入的 compute/task/扩展成功回执登记已校验的 artifact/attempt/decision、串行化事件写入并提供项目只读快照；旧单账本由 StorageRegistry 以只读 preserve 条目登记。shared `host-api/inquiry.ts` → desktop `main/ipc/inquiry.ts` → preload → `ArtifactsPane` 提供来源展开、三态徽标和重跑入口，Electron IPC 的 decisions.list/revoke/confirm 与任务面板复用该只读投影。

## packages/discovery — 研究发现领域包（B5d–B5f）

`@drone/discovery` 保持 runner 与 Inquiry 端口注入，不执行宿主 shell。`src/kernel.ts` 提供容器能力门控、空闲/执行超时、分级输出过滤、runs-only 导出与 Python/R 受控 fixture；`src/exploration.ts` 提供独立探索预算、先验/意外度、竞争解释和 Inquiry 记录；`src/critic.ts` 提供只读批评者、多路径执行与稳健性等级；`src/evaluation.ts` 提供 BixBench、重新发现、不一致拦截、混杂发现、线索命中、核验耗时和重复失败指标及基线协议。评测数据与外部缺口说明见 [research-evaluation.md](research-evaluation.md)。


## packages/extensions — Pi 扩展适配层（迁移中）

`src/*.ts` 是可打包的扩展入口：当前 generated entries 包括 `institutional-access`、`knowledge-extension`、`research-loop`、`research-wikiloop`、`research-wikiskill`、`subagent-research`、`workspace-config`；`scripts/build-extensions.mjs` 将它们生成到 `.pi/extensions/`。上述扩展均由源码重新生成；`check:extensions --strict` 校验 12 个生成入口及传递依赖的源/产物哈希，不把研究兼容产物排除在漂移检查之外。

## 外部 `pi-knowledge` 包 — 原生 Pi 知识插件（PR-3 / PR-4）

`pi-knowledge` 的源码权威版本位于 `drone-plugins/packages/pi-knowledge/`（GitHub `Gyoungwe/drone-plugins`）。公开 npm 版本仍为 0.2.1；当前宿主源码锁固定 `b1c11f3` 的 0.3.0 候选，记录可复现 tarball SHA-256。插件负责 manifest、host 声明、native extension、worker 和 maintenance；`src/core/maintenance-topic.ts` 负责绑定 revision、canonical/mirror CAS 更新与回读。保留双方历史的整合已恢复同包 `ui/`、`src/native/` 和 `src/desktop/`；完整 hooks 共享 owner、undo、surfaces 与正式安装包 GUI 继续按 P2 跟踪，不因包构建通过而完成。Drone 暂保留端口、IPC、挂载/回退和旧资源装配。

PR-4 在同一入口注册 `knowledge_search`、`knowledge_read`、`knowledge_deposit` 与 `knowledge_answer_context`：本地 Vault 检索优先，命中不足时只报告 `pi-web-access` 能力并提示保留真实来源；读取回执含出链/反链且同路径同哈希重读返回 `already-read`；搜索默认 6 条、片段最多 300 字；沉淀复用现有 `depositKnowledge` 合同并覆盖 paper/software/method/idea 四类；`knowledge_status` 返回稳定的一行 revision 摘要。验证夹具位于 `scripts/smoke-pi-package.mjs`，不写入真实用户 Vault。

## 外置 pi-core — 原生 Pi 核心插件

插件仓库 `packages/pi-core/` 拥有工具、项目记忆、native runtime 和 milestone 校验；host loader 通过公开 client 合同接入。宿主旧源码和重复测试已删除，插件仓库保留原历史、同名测试及严格干净消费者 tsc。`scripts/build-pi-core.mjs` 现在只验证源码锁、fetch receipt、产物哈希与公开声明；`scripts/smoke-pi-core.mjs`、`scripts/check-pi-compat.mjs` 消费 `vendor/plugins/pi-core/`，不再构建宿主副本。`scripts/check-core-artifact.test.mjs` 验证无旧源码的锁定产物边界；backend 的真实 tarball 回归位于 `test/packed-core-host-sdk.test.ts`。公开 0.1.9 仅用于 npm-ci bootstrap，本轮源码锁候选为 0.2.0。

Discovery 领域实现位于插件 `pi-discovery/src/service.ts` 与 `src/domain/`，宿主 `backend/src/discovery/service.ts` 仅注入授权、惰性 container runner、原子 JsonStore、runs 文件边界和项目绑定 Inquiry。无插件不登记 discovery 存储；旧共享 journal 保持字节并报告 unassigned，不自动冒认项目。候选目前只有 Desktop host 入口，原生工具、真实容器和完整 B5 GUI 仍未完成。

## `@gyoungwe/pi-analysis` — 原生 Pi 分析插件（V1.1-A 已完成）

`../drone-plugins` 的 `main=dc6d52007bcf2fe35579b83e5a2bac2250768619` 是 `@gyoungwe/pi-analysis@0.1.2` 的源码权威位置。该版本提供 `host` entry 和版本化 registry/loader，Drone backend 以精确 `0.1.2` 依赖消费 `@gyoungwe/pi-analysis/host`，三个本地 analysis adapter facade 已删除；公开 tarball、全新 prefix 安装、完整 Pi 1.1.0 loader 发现和宿主 host loader 验收见 [pi-analysis 0.1.2 发布证据](releases/v3.1-pi-analysis-0.1.2.json)。

## `@gyoungwe/pi-evidence` — 原生 Pi 证据插件（V1.1-E 已完成公开宿主门禁）

源码权威位置是绑定的 `../drone-plugins/packages/pi-evidence/`（历史验收源码基线 `main=dc6d52007bcf2fe35579b83e5a2bac2250768619`）。公开 `0.1.1` tarball 的 shasum/integrity、干净 prefix 安装、只读工具注册和 Pi 1.1.0 loader 发现均通过；宿主验收由 `scripts/check-public-plugin-host.mjs` 执行。宿主 composition root 仍负责字节采集、持久化、分支工作区和 replay runner；真实文件写入和科研结论门禁不由该包承担。

## `@gyoungwe/pi-connectors` — 原生 Pi 连接器插件（V1.1-C 公开宿主门禁已完成）

源码权威位置是绑定的 `../drone-plugins/packages/pi-connectors/`（历史验收源码基线 `main=dc6d52007bcf2fe35579b83e5a2bac2250768619`）。公开 `0.1.1` tarball 的 shasum/integrity、六类只读 connector descriptor、2 个元数据工具、干净安装和 Pi 资源加载均通过。实际网络、凭据、写入、回读与删除仍由宿主组合根通过 `ConnectorExecutionPort` 实现；Protocols.io 继续保持只读，真实外部服务 I/O 不在本次门禁中宣称通过。

## 外部 pi-research — 原生 Pi 与宿主研究核心

`../drone-plugins/packages/pi-research/` 是研究证据、归档、回执、provenance 和 Zotero 领域算法的源码权威位置。宿主只消费 `@gyoungwe/pi-research/host`，`plugins.lock.json` 固定 commit、版本和 tarball hash；`scripts/build-pi-research.mjs` 验证 fetched 产物。原生入口提供来源检索/阅读/候选笔记/引用答案与完整 research_loop。宿主 workspace/Vault/授权与连接器桥留在 `packages/extensions`、`packages/backend` 及剩余 `packages/research` 合同中。

本轮边界、未完成的账户/安装包验收见 [研究迁移状态](research-migration-status.md)；获授权的 Zotero 本机单条创建/回读/删除/回读见[闭环证据](releases/zotero-local-roundtrip-2026-10-24.json)；独立科研扩展与 Exa HTTP MCP 的真实回执见 [外部验收](releases/scientific-external-acceptance-2026-10-24.md)。

## `@gyoungwe/research-suite` — 外部原生 Pi 聚合包（PR-7）

源码权威位置是绑定的 `../drone-plugins/packages/research-suite/`（本轮 PDF 运行时修复 `b5addb1`，发布证据见 [剩余验收](releases/remaining-closure-2026-10-26.md)）；宿主仓库不再保留该包、workspace lock 条目或聚合包专属检查脚本。当前公开版本为 `@gyoungwe/research-suite@0.1.11`，捆绑 `plugin-api/pi-core/pi-knowledge/pi-research`；旧 `0.1.1` 已标记“与 pi-core 冲突，无法启动”。插件仓库负责 manifest、`bundleDependencies`、tarball、安装 smoke 和 Pi CLI 回归；宿主只通过已发布包的兼容矩阵和公开插件宿主检查验证加载结果。`/drone-doctor` 和 `/drone-example` 由 `pi-core@0.1.9` 提供，本次真实矩阵见 [剩余验收](releases/remaining-closure-2026-10-26.md)，历史矩阵证据见 [v1.1.0 npm 发布证据](releases/v1.1.0-npm-packages.json) 与 [PR5 真实回执](releases/v1.1-pr5-paper2agent-acceptance-2026-10-23.json)。

## packages/backend — pi SDK 适配层

纯 Node，不依赖 Electron。唯一 import pi SDK 的包，运行时值导入收敛在 `session-engine/**`；`pi-backend.ts` 保留兼容门面。

```
src/
├── index.ts            barrel
├── pi-backend.ts       门面：会话生命周期 + 各域薄委托（desktop main 只 import 这里）
├── json-store.ts       统一 JSON 持久化原语
├── slash-commands.ts   斜杠命令清单（纯函数）
├── log.ts              结构化日志
├── session/            registry / naming / messages / trace+traces / event-slim+stream-guard / rates / ui-context
├── permissions/        index(barrel) / bash-chain / pattern / config / settings / tmp-zone / gate / extension / audit
├── project/            trust / trust-loader / workspace-store / files
├── settings/           settings / model-prefs / login
├── packages/           admin / catalog
├── discovery/          B5d–B5f 内核容器运行、探索预算、独立批评、多路径与评测的 backend 组合根
├── session-engine/     Pi SDK 运行时边界与原生 provider（含 Google Antigravity）
├── services/           approvals / compute-data-design / compute-experience / compute-preflight / institutional / packages / permissions / project-trust / session-lifecycle / session-permissions / subagents / zotero（域服务，组合根暴露）
├── research-root.ts    研究 workbench 打包资源根解析（开发树与 extraResources 共用）
└── tools/              show-image / todo / todo-reminder / webfetch / subagent / context-evaporation / channel-watch / bio
```

| 文件 | 关键导出 | 职责 |
|---|---|---|
| `src/create-backend.ts` | `BackendServices`、`createBackend` | 组合根：注入每 host `DroneRuntime`，组装 session、knowledge、zotero、institutional、subagents、mcp、settings、models、login、packages、permissions、approvals、B5 discovery 与 B7 data-design 服务；compute preflight/experience bridge 通过显式 host 端口接入，desktop IPC 优先消费这些端口 |
| `src/discovery/` | `DiscoveryService`、`ContainerKernelRunner` | B5d–B5f 的项目作用域宿主适配：Docker/Podman 无网络、只写 `runs/` 的内核会话，Inquiry 记录，独立批评、多路径稳健性、基线和评测持久化；无容器运行时 fail-closed |
| `src/session-engine/antigravity/{oauth,transport,request,response,provider,catalog}.ts` | `createAntigravityProvider`、PKCE OAuth、Cloud Code Assist SSE | Google Antigravity 原生 provider：浏览器 OAuth + loopback/manual 回调、项目发现/开通、动态模型目录和 Gemini 请求/响应适配；凭证只经 Pi runtime 管理 |
| `src/services/compute-{data-design,preflight,experience}.ts` | B7 registry/gate、`createComputeExperienceRecorder` | 数据集版本、公共数据回执、RO-Crate、设计/混杂检查在提交前阻断并生成 proposal questions；终态 compute 事件可写入知识 experience store，保留 observed/verified 边界 |
| `src/services/execution-route.ts` | `routeRnaseqIntent`、`preflightRnaseqExecution`、`RnaseqExecutionService` | 将受支持的 bulk RNA-seq 自然语言意图绑定到固定 `nf-core/rnaseq` spec；在调用注入的 ComputeService 前完成纯 preflight，并提供离线 fixture 回执 |
| `src/pi-backend.ts` | `PiBackend` | **兼容门面**：create/open/close/delete/prompt（followUp 排队，preflight 回执见 `use-composer-send`）/abort/fork/recall/compact/stats/listModels（附 `thinkingLevels`/`imageInput`）/事件与权限·信任分发。新 host 通过 `BackendServices` 端口接入；兼容期保留旧委托 |
| `src/json-store.ts` | `JsonStore`、`JsonStoreCorruptedError` | 统一 JSON 持久化：tmp+rename 原子写；read 损坏回退默认、update 损坏抛 CorruptedError 拒写；async 版 per-path 队列串行化，writeChecked 将能力授权/CAS/回读纳入同队列；sync 变体热路径用；缓存/normalize 不进本层 |
| `src/slash-commands.ts` | `BUILTIN_SLASH_COMMANDS` | 内置静态表（compact/name/export/settings）+ 模板/skill/扩展命令映射（纯函数） |
| `src/log.ts` | `createLogger`、`initLogging` | 结构化日志：按天落盘 `main-<本地日期>.log`（`PI_LOG_LEVEL`/`PI_LOG_DIR`） |
| `src/session/messages.ts` | `toSessionMessages`、`resolveRecallEntryId`、`resolveForkEntryId`、`block*` | pi 消息 → SessionMessage 解析（纯函数，可独立单测）：toolResult 回填、show_image/subagent 提取、edit `details.patch` → `SessionToolCall.diff`、entryId 配对（user·assistant 分表防同 ms 碰撞）；fork/recall 目标解析 |
| `src/session/traces.ts` + `trace.ts` | `SessionTraces`、`TraceRecorder` | trace 生命周期 / 批量落盘（500ms/128 条 flush；单事件 >512KB 截断标记、按字节轮转——加固背景见 PITFALLS 0.4.6） |
| `src/session/event-slim.ts` | `slimMessageUpdate`、`slimBulkyEvent` | 事件瘦身（emitEvent 单点）：剥流式 delta 携带的全量快照、剥 image base64/截断超长 text；details 与终态消息不动（事故背景见 PITFALLS） |
| `src/session/stream-guard.ts` | `StreamGuard` | 流式熔断（emitEvent 单点）：连续空白 >8KB 或单消息 >2MB → abort + 丢弃后续增量；双路径清理防 Map 泄漏 |
| `src/session/rates.ts` | `EventRateTracker` | 每会话事件速率统计（60s 滑窗），心跳/崩溃快照数据源；prune 防泄漏 |
| `src/session/naming.ts` | `autoNameSession` | 首条用户消息 message_start 即取首行做标题（skill 命令先还原 `/skill:name` 投影，有测试） |
| `src/session/ui-context.ts` | `makeUiContext` | `ExtensionUIContext` 桥接：confirm → PermissionGate，其余 no-op；**theme 必须是真实 `Theme` 类实例**（假对象会让 pi-mcp-adapter 等扩展 `theme.fg()` 抛错、MCP 服务器全连不上）；SDK 接口变化时在此补新成员 |
| `src/permissions/gate.ts` | `PermissionGate` | 权限确认队列：allow/deny/allowAlways/allowDir + kind/suggestDir 元数据；respond 前供 PiBackend 持久化 |
| `src/permissions/index.ts`（+ bash-chain/pattern/config/tmp-zone） | `evaluateBashCommand` 等 | 逐工具权限规则引擎：allow/ask/deny × 通配模式；bash 命令链取最严段；自保护（permissions/workspaces/auth/trust 四文件）；tmp-zone = 临时区判定 + rm 豁免（纯函数）。已知天花板：xargs/find -exec/python -c 不覆盖 |
| `src/permissions/settings.ts`（+ config.ts 的 `parseConfig`/`serializeConfig`/`validateConfig`） | `readPermissionSettings`、`writePermissionSettings`、`resetPermissionSettings`、`probePermission`、`readPermissionAuditTail` | 设置 → 权限 面板后端：快照（路径/原文/默认合并视图/mtime）、整表校验（动作枚举 / 纯数字键 / 自保护四模式存在、非 allow 且未被其后 allow 覆盖）、mtime 冲突检查 + tmp+rename 原子写（留 `.bak`，`enabled` 保留文件原值）、规则试算（同一求值链，只跑规则不模拟边界）。写后 `createPermissionConfigLoader` 下一次 tool_call 重读 = 保存即生效 |
| `src/permissions/extension.ts` | `makePermissionGateExtension` | 权限门控内置扩展（tool_call 钩子 + 确认通道 + 会话权限模式分支）。求值链：① deny 直接 block → ② 临时区 → ③ 多根边界（projectRoot ∪ workspaces roots）读写分离（读默认放行/写默认确认）→ ④ 项目记忆 allowed[] → ⑤ ask；`getMode` 每次调用实时读，fullAccess 档下 ①⑤ 降级为审计 + 放行（spec permission-mode） |
| `src/permissions/audit.ts` | `PermissionAuditLog`、`permissionAuditPath` | fullAccess 高危审计：JSONL 追加写 `~/.pi/agent/permission-audit.jsonl`（含 sessionId/boundary），超 1MB 截头保尾；写失败不阻塞工具调用 |
| `src/project/trust.ts` | `TrustGate`、`resolveProjectTrust` | 信任决策链：无资源→信任 → trust.json → defaultProjectTrust → 两选项弹窗（信任/不信任均落盘）；同 cwd 在途询问去重 |
| `src/project/trust-loader.ts` | `ProjectResourceLoader` | 两阶段资源加载：先用户级（projectTrusted:false）→ 信任决策 → 按结果重载 |
| `src/project/workspace-store.ts` | `loadWorkspaces`、`addWorkspaceRoot`、`addAllowedPattern` 等 | `~/.pi/agent/workspaces.json`：per-project `roots[]`（「允许此目录」写入，多根边界）+ `allowed[]`（allowAlways 模式键，LRU 200） |
| `src/project/files.ts` | — | @ 补全的文件列表（walk 排除 node_modules/.git/dist 等，5000 上限 30s TTL） |
| `src/tools/webfetch/` | `makeWebFetchTool` | 内置 webfetch 三模块：`ip-guard.ts`（SSRF 防护，独立成文件便于审计）/ `html-to-text.ts` / `tool.ts`（抓取循环+截断+github blob 重写） |
| `src/tools/show-image.ts` | `makeShowImageTool` | 内置 show_image：`paths` 数组 1-9 张/次；图片只走 `details`（模型不可见、jsonl 自动持久化），`content` 只回一句文本；路径规整 ~ 展开 + unicode 空格归一 |
| `src/tools/todo.ts` + `todo-reminder.ts` | `makeTodoTool`、`makeTodoReminderExtension` | todo 工具（全量替换协议，`details.todos` 供 UI）+ 恢复扩展（context 钩子注入 `customType:"todo-reminder"`——用 context 而非 before_agent_start：overflow willRetry 同 run 重试也覆盖） |
| `src/tools/subagent/` | `makeSubagentTool`、`runSubagent`、`applySubagentMutex`、`discoverAgents`、`SubagentPanelService`（panel.ts） | 内置进程内 subagent：single `{agent,task}` + parallel `{tasks[]}` cap 8/并发 4；子代理 = 共享 modelRuntime 的隔离 `AgentSession`（资源最小化 + 权限桥父 gate，完成等 `agent_settled`）；会话文件落 `sessions-subagents/`（打开即只读）；**参数 schema 必须拍平单 object**（DeepSeek 对顶层无 `type:"object"` 直接 400，严禁顶层 Union/Intersect）；互斥 = 同名覆盖 + `subagent_*` 家族停用（发 `subagent_mutex` 事件）；runner 转发子会话原生事件（检视页实时收流）；agent 定义：内置 scout → user `~/.pi/agent/agents/` → project `.pi/agents/`（仅 trusted）；`panel.ts` = 面板派发登记表（同 runner：排队 / 归因 / followUp 结果入会话 / 中止），见 [subagents-panel.md](subagents-panel.md) |
| `src/tools/context-evaporation/` | `makeEvapExtension`、`readContextManagerMode`、`writeContextManagerMode` | 内置上下文蒸发扩展（**默认开启**，二态蒸发/off）：context 钩子把到龄工具输出按四级水位线蒸发为 stub（零 LLM、决策单调持久化保 KV cache）；核心三文件（types/estimate/evaporate）零 SDK/零仓库 import（replay `--core` 同构验证）；二态配置单 key 单一写者（写侧顺带清遗留键）；调参走 `scripts/replay-evaporation.mts`；批次观测 = log + trace_custom 行 |
| `src/session-engine/harness/{context,branch}.ts` | `makeHarnessContextExtension`、`checkpointFromBranch` | 回答模式（shared `harness.ts` 的 `resolveAnswerMode` / `QUICK_ANSWER_CONTRACT` / `ACADEMIC_ANSWER_CONTRACT`：auto 按问题判断，`/answer-mode quick|academic|auto` 手动切换并随会话分支持久化；固定问题集与离线评分 `scripts/academic-eval/`）；学术回答末尾「可能被忽略的点」规则 `OVERLOOKED_POINTS_RULE`；`/发现`（别名 `/discover`）命令在 extensions `obsidian-workbench.ts` 注册，提示词 `extensions/src/internal/discovery-prompt.ts`（发散 → 新颖性/依据/可检验性自我质疑 + 独立批评子智能体 → 最多 3 条 → ask_user 选择后以 `idea` 类型沉淀）；`@drone/discovery` 内核/多路径冻结；OpenScience 式上下文合同与 bounded checkpoint：before_agent_start 注入模型族/科学/回复规则和每轮姿态，context 在会话开始、compact、分支切换和状态变化后投影真实 SDK 的 custom_message/custom entry；`drone-harness-checkpoint-v1` 只进模型上下文，不是证据或授权来源；合同/检查点观测写入 trace_custom |
| `src/session-engine/harness/{recall,guards,delivery}.ts` | `makeHarnessRecallTool`、`makeHarnessGuardExtension`、`makeHarnessDeliveryExtension` | 受控历史导航、重复失败重定向和交付物/预算观察。recall 只返回有界来源片段并过滤私有状态；guard 三次同签名失败给一次换方法提示，第二次阻断当前回合；delivery 复用 task acceptance，只观察并记录，不接管既有授权续跑 |
| `src/tools/bio/` | `makeBioEnvironmentTool`、`makeBioDatabaseTool`、`makeBioExtension`、`probeLocal`、`remoteProbeScript` | 生信执行：`databases.ts` = `bio_db` 只读公共库检索（NCBI E-utilities/GEO、UniProtKB、Ensembl 含 release、ENA/SRA run 含 FASTQ URL+MD5；固定官方端点、NCBI 串行限速、输出附检索 URL）；`environment.ts` 探测工具版本 / conda 环境 / 容器 / CPU·内存·磁盘（本地 Node 直探免审批；远程同清单转 POSIX sh 经 SSH，需审批）；`tool.ts` = `bio_environment` 工具；`extension.ts` = `/run-on local\|<host>\|auto`（customType `drone-run-on-v1` 随分支持久化）+ 每轮注入执行位置规则 + 拦截 read 整读 >4 MiB 的 FASTQ/BAM/VCF/FASTA/GFF/h5ad（回预览命令） |
| `src/tools/channel-watch/` | `makeChannelWatchExtension` | 内置跨会话频道协作扩展（默认开）：订阅 `.local/agent-work/channel/<topic>/`，**消息 = 意图：写文件 ≠ 通知，channel_post 工具才唤醒**（根治一次任务写 N 文件 = N 唤醒）；防环三层（自写窗口 + hash 去重 + 乒乓上限暂停）；`closed:true` 终态退订；分模块 config/init/guard/watcher/subscriptions/post/tools/extension；配套 skill channel-pickup/design-handoff |
| `src/settings/settings.ts` | `SettingsService` | provider/模型/凭证读写（key 走环境变量引用，绝不落明文）。listProviders 默认本地 refresh（`allowNetwork:false`），显式 forceNetwork 才联网；custom provider 增改走 `buildCustomEntry`（未设字段不落盘）；模型列表留空 = 覆写 baseUrl 共享官方列表；`setProviderBaseUrl` = 内置 provider 端点覆写专用；移除凭证走 `runtime.logout()`（直接删文件残留内存态）；`apiKeyLogin` 标记 = 内置 provider 有交互式 api_key 登录（UI 显示「登录」入口） |
| `src/settings/model-prefs.ts` | `ModelPrefsService` | `model-prefs.json`：隐藏模型 + 停用 provider + per-agent 子代理模型；`listModels()` 唯一出口过滤 |
| `src/settings/login.ts` | `LoginService` | provider 交互登录桥接：AuthInteraction → IPC 事件（prompt 挂起等 renderer 应答；浏览器先到则拒挂起 prompt）。支持 OAuth + api_key 交互登录（如 Google Vertex）；`filterAuthSelectOptions` 对 google-vertex 剔除必败的 api-key 选项（Vertex 不接受 API key，见 PITFALLS） |
| `src/services/packages.ts` | `PackageService` | 社区包搜索/安装/卸载/已配置清单 + 装卸后对非流式会话热重载（对齐 CLI /reload）；npm ENOENT 转带哨兵的可读错误；通过 `BackendServices.packages` 暴露 |
| `src/services/approvals.ts` | `ApprovalService` | per-session `PermissionGate` 注册、待决请求快照、请求/裁决广播和 allowRun 队列裁决；通过 `BackendServices.approvals` 暴露，`PiBackend` 保留兼容委托 |
| `src/services/permissions.ts` | `PermissionSettingsService` | `permissions.json` 快照、原子保存、恢复默认、规则试算与审计尾部；通过 `BackendServices.permissions` 暴露，`PiBackend` 保留兼容委托 |
| `src/services/session-permissions.ts` | `SessionPermissionService` | 活跃会话的内存权限模式（default/fullAccess）；关闭会话或重启即归零；通过 `BackendServices.sessionPermissions` 暴露 |
| `src/services/session-lifecycle.ts` | `SessionLifecycleService` | 会话发现与关闭协调（registry/SDK dispose 顺序和清理 hook）；创建/打开仍由 `SessionService` 装配项目资源与扩展；通过 `BackendServices.lifecycle` 暴露 |
| `src/services/session-host.ts` + `session-composition.ts` | `SessionHost`、`initializeSessionComposition` | 会话组合根的显式端口类型与装配顺序；把 runtime、权限、MCP、知识、模型、消息、资源和扩展依赖绑定到同一个宿主边界 |
| `src/services/session-api.ts` + `session-api-settings.ts` + `session-api-diagnostics.ts` | `SessionServiceApi`、`SessionSettingsApi` | 兼容 API 的薄委托层：会话/模型/设置/权限/诊断调用转发到专责服务，避免把业务实现重新集中到门面 |
| `src/services/session-{construction,control,events,messages,models,resources,settings-boundary,extensions}.ts` | 会话专责服务 | 分别承载 create/open、prompt/abort/fork、事件管线、消息映射、模型偏好、资源/MCP、权限设置边界和扩展构造；单文件保持在 400 行以内 |
| `src/services/project-trust.ts` | `ProjectTrustService` | 组合项目 `trust.json` 存储与交互式 `TrustGate` 生命周期；通过 `BackendServices.projectTrust` 暴露，`PiBackend` 的资源加载与旧 `respondTrust` 继续委托 |
| `src/services/institutional.ts` | `InstitutionalService` | 机构访问配置、登录窗口、URL 安全打开、会话清理与访问测试；通过 `BackendServices.institutional` 暴露 |
| `src/services/subagents.ts` | `SubagentService` | 子代理面板发现、派发、中止与运行记录；通过 `BackendServices.subagents` 暴露 |
| `src/services/compute-adapter.ts` | `ComputeHostAdapter`、`ComputeServiceAdapter`、`createComputeServiceAdapter` | B2 远程计算 host-facing adapter；默认投影 B1 的持久化主机、作业、日志和健康状态，runner/终端缺失时明确 unavailable，并在远端副作用前执行授权 |
| `src/mcp/service.ts` | `McpService` | MCP 配置、状态读取和重载边界；通过 `BackendServices.mcp` 暴露 |
| `src/packages/admin.ts` | `PackageAdmin`（兼容别名） | 旧包管理入口的兼容 re-export；新代码使用 `services/packages.ts` |
| `src/packages/catalog.ts` | `fetchPackageCatalog` | pi.dev 目录抓取：无 JSON API，解析 SSR HTML 的 `<article data-package-card>` |

**可观测性**：每会话事件 trace + 关键操作日志（create/open/close/prompt/abort/compact）；main 进程还监听 renderer 崩溃/unresponsive/console。排查 UI 状态问题：`npx tsx scripts/replay-trace.mts --last` 确定性复现。

**何时改这里**：权限逻辑、项目信任、自动命名、uiContext 桥接、provider 设置、会话管理。

## packages/desktop — Electron 应用

### main/

| 文件 | 职责 |
|---|---|
| `src/main/index.ts` | app 生命周期 + 装配：initLogging / `pi-bg://` 协议 / renderer 崩溃钩子 / `createBackend()` 组合根 / `new UiPluginManager()` / registerIpc / updater / 建窗。**首三行必须 import `./pi-package-dir` + `./dev-agent-dir` + `./fix-path`**；render-process-gone 自动 reload（30s 内 ≥3 次停手弹窗，崩溃时输出 incident snapshot）；before-quit 逐项 dispose |
| `src/main/console-dedup.ts` | renderer console 错误签名去重（首条全量/重复计数/阈值与周期汇总），纯函数可单测 |
| `src/main/fix-path.ts` | GUI 启动 PATH 修复：Finder/Dock 启动 PATH 无 Homebrew，spawn npm 会 ENOENT；同步追加常见 bin 目录 + 异步 `$SHELL -ilc` 合并（须在 spawn 任何子进程前 import） |
| `src/main/pi-package-dir.ts` | 打包态 `PI_PACKAGE_DIR = resources/pi-package`（SDK `getPackageDir()` 最优先读它，不缓存）：pi 官方 docs/examples 经 extraResources 装入 |
| `src/main/dev-agent-dir.ts` | dev/预览态数据隔离：userData 重定向 `*-dev` 后缀 + `PI_CODING_AGENT_DIR = ~/.pi/agent-dev` + 五配置一次性种子拷贝（正式目录零写入） |
| `src/main/daily.ts` | 日常空间工作台目录（`~/.drone/daily`，全部日常会话的固定 cwd）+ 懒创建；信任链无资源自动信任不弹窗；dev/正式共享工作区（会话列表按 agent dir 天然隔离） |
| `src/main/ipc/index.ts` | `registerIpc` 组合入口 + backend 事件/updater 状态转发 + UI 插件热重载 watcher 启动。**新增 handler 改对应域文件，不在 index.ts 堆** |
| `src/main/ipc/{sessions,settings,permissions,packages,knowledge,compute,discovery,decisions,app,ui-plugins,institutional,subagents}.ts` | 各域 handler（全部薄委托 backend；compute 通过 `ComputeContract` 做参数/结果边界校验并转发健康/作业/终端事件；discovery 通过 `DiscoveryContract` 暴露 B5d–B5f 只读投影并对关闭会话执行主帧校验；decisions 通过 `DecisionsContract` 提供项目决策列表/撤销/人工确认；knowledge 域经 `KnowledgeContract` 做参数/结果边界校验；ui-plugins 域 handler async await 落盘后才返回；permissions 域 = 设置 → 权限 面板 load/save/reset/probe/auditTail + `openLocation` 用 shell 定位文件） |
| `src/main/tabs.ts` / `ui-state.ts` | tabs.json / ui-state.json 读写（JsonStore 原子写；ui-state 补丁式合并 + normalize 补缺省） |
| `src/main/background.ts` | 背景图选图（dialog → 拷贝 `userData/backgrounds/` 并清理旧图） |
| `src/main/window.ts` | BrowserWindow：sandbox + preload；启动底色跟随主题防白闪（已解析主题经 `?theme=` query 传 renderer）；窗口框架按平台分流（mac hiddenInset / Win frameless+titleBarOverlay / Linux 原生）；导出 `resolveTheme`/`applyChromeTheme` |
| `src/main/ui-plugins/config.ts` | `ui-plugins.json` 读写（normalize 白名单；assignments 指向失效插件保留） |
| `src/main/ui-plugins/build.ts` | 插件 esbuild 构建器：`loadEsbuild` 懒加载 + `ESBUILD_BINARY_PATH` 指向 asar.unpacked 真实二进制（打包态坑，升级 esbuild 前重评）；react 系四个 specifier 重写到 `window.DroneUI` shim（**与 renderer host-api.ts、resources/drone-ui.d.ts 逐名一致**）；图片/音频资产 dataurl 内联（CSP img-src / media-src 均放行 data:） |
| `src/main/ui-plugins/manager.ts` | UiPluginManager：scanAll（manifest 校验 + 单插件 try 不阻断启动）/ ensureBuilt / fs.watch 300ms 防抖热重载 / seedBuiltinPlugins（resources builtin/ → 用户目录，版本戳幂等）/ seedDocs（SPEC.md + symlink `~/.drone/ui-plugins`）/ filterContributions（校验 region/anchor） |
| `src/main/ui-plugins/installed-package-graph.ts` | 从 managed npm prefix 的明确安装根沿 Pi 资源引用解析声明依赖（含 npm 提升）；不递归普通库依赖。manager 诊断重复来源、版本或 UI 名冲突，发现不授予信任 |
| `src/main/git.ts` | git 分支查询/切换三通道 |
| `src/main/update-policy.ts` / `updater.ts` | 更新决策纯函数（不 import electron 可单测）/ electron-updater 封装：发现新版只提示，点击才下载，下载完点「重启」安装；mac adhoc = manual 模式跳 release 页；定时静默检查只查不下载；autoUpdater 用 createRequire 取（CJS 导出） |

### preload/

`src/preload/index.ts` — contextBridge 暴露 `window.pi`（`PiApi` 实现，含同步 `platform`）。必须保持 CJS（见硬约束）。

### renderer/（React 19 + Tailwind 4 + Zustand）

| 文件/目录 | 职责 |
|---|---|
| `main.tsx` / `App.tsx` | 入口 / 视图切换（chat/projects）+ 事件桥：onEvent → `EventConflator` rAF 合流 → transcript store（桥在 `hooks/use-session-event-bridge.ts`）。订阅纪律：App 只订阅原始值（子树无 memo，订阅 transcript 对象会随每条流式 delta 全级联） |
| `bootstrap-theme.ts` | 首帧前写 `data-theme`（读 `?theme=` query，防开屏闪色） |
| `monaco-contribs.ts` | monaco worker 接管 + 懒加载服务补注册（出现新 UNKNOWN service 报错时按同法在此补模块） |
| `splash-dom.ts` / `splash.ts` / `styles/splash.css` | 开屏动画三件：DOM/粒子参数（`DOT_COUNT`）→ 时长与单次标记（sessionStorage）→ 全部样式与收场编排（改视觉只动这三个文件） |
| `api.ts` | `getPi()`：window.pi 类型化访问 |
| `lib/knowledge-artifacts.ts` / `lib/knowledge-error.ts` | 宿主通用产物面板的知识回执投影与错误通知；完整知识阅读、流程卡和产品页面在外部 UI 包 |
| `lib/thinking.ts` | `THINKING_LEVELS` 档位表 + `clampThinkingLevel` 就近向上收敛（语义对齐 SDK） |
| `lib/daily.ts` | 日常空间目录 renderer 缓存：`initDailyDir`（App 启动调一次，幂等）+ `isDailyCwd` 同步判定 + `setDailyDirForTest`；各处共享，不散落路径字符串 |
| `stores/sessions.ts` | 会话列表/当前会话/cwd/模型/权限模式（`permissionModes` map，缺 key = default；draft 态纯 renderer，转正 ensureSession 应用到后端）。draft 会话（`draft:` 前缀，空 tab 重启消失；发首条消息 `ensureSession` 用 draft cwd 原地转正）；信任前置 ensureProjectTrust（trustVersion 触发重拉）；打开/fork/撤回/restoreTabs 统一 `loadSessionBundle` 四件套（history→queue→todos→permissionMode 对齐后端）；拖拽排序 `reorderSessions` 落 tabs.json |
| `stores/knowledge.ts` | 宿主知识上下文、流程回执、审核队列与刷新 revision；由 `components/knowledge/KnowledgeUiRoot.tsx` 事件桥持续更新，插件通过公开 store bindings 读取，停用插件不会停止事件接收 |
| `stores/transcript.ts` | re-export shared reducer + per-session 字段（agentActive/unseenCompletion/todos）；reducer 细节见 shared `src/transcript/` |
| `stores/event-conflator.ts` | 流式事件合流：纯追加型 delta 按会话/类型拼接 + rAF 每帧最多一次 flush，其余事件边界透传保序（可注入调度器，有测试） |
| `stores/drafts.ts` | 草稿（文本/图片/slash 胶囊/@ 引用 attachments/选中引用 quotes）按会话持久 + `COMPOSER_FOCUS_EVENT`（撤回回填后聚焦输入框） |
| `stores/permissions.ts` | 设置 → 权限 面板状态：磁盘快照 + 数组化草稿（`components/settings/permissions-model.ts`）+ 保存 / 冲突（mtime）/ 后端校验问题 / 审计尾部；`selectPermissionDirty` 结构比较脏检查 |
| `stores/settings.ts` / `catalog.ts` / `provider-login.ts` | 设置域（providers + 上下文管理/channel-watch 开关，乐观更新回滚；permissionGateOff = 手改 permissions.json 卸载门控的逃生舱态只读感知）/ 社区包目录（300ms 防抖 + seq 防陈旧）/ OAuth 登录状态机（**取消时机 = LoginDialog 卸载 cleanup**；先订阅事件再 invoke） |
| `stores/projects.ts` / `theme.ts` / `ui.ts` / `compute.ts` / `ui-preferences.ts` / `update.ts` / `ui-plugins.ts` / `toasts.ts` | 项目页（手动添加的按时间倒排）/ 主题与背景（init 在 render 前 await 防闪烁）/ 右侧任务、过程（含变更）、产物与按需出现的子智能体、计算页签与主机、作业、日志、终端、引导状态 / 会话轨道 + 中央动画开关（持久化 ui-state）/ 更新态 / UI 插件面板 / 全局 Toast（顶栏右侧，非阻塞自动消失） |
| `hooks/` | `use-context-usage`（上下文用量，事件驱动刷新）/ `use-language` / `use-session-state`（useSessionReadOnly/useSessionBusy 收敛）/ `use-session-event-bridge`（App 事件桥装配层专用） |
| `plugins/` | UI 插件运行时：`slots.ts`（槽位名+props 契约单一来源）/ `registry.ts`（zustand：overrides + contributions 堆叠 + headless activate/cleanups + 崩溃计数/loadNonces）/ `Slot.tsx`（总开关门控 + PluginBoundary 包裹）/ `RegionHost.tsx`（区域挂载点，容器语义）/ `PluginBoundary.tsx`（class 错误边界，崩溃回退）/ `host-api.ts`（`window.DroneUI` 挂载，main.tsx render 前 import）/ `knowledge-api.ts`（显式 `KnowledgeUiPort` 方法适配，保留宿主授权和持久化边界）/ `loader.ts`（initUiPlugins/reloadAll/computeAssignedSlots） |
| `i18n/` | 宿主 zh/en 字典 + `useT()`（宿主文案同步双字典；迁出知识 UI 的双语文案在插件 `ui/knowledge/{copy,zotero-copy}.ts`） |
| `styles/globals.css` | Tailwind 入口 + 主题 token（`bg-canvas/bg-surface/ink 灰阶/shadow 三档` 等；组件禁写死色值，一律语义 token）+ markdown/滚动条/动画样式段 |

### components/（按域分目录）

| 目录 | 内容 |
|---|---|
| `chat/` | **MessageList**（底部跟随 + 脱离回底；行模型 `useMemo`，轮末行定位规则在 shared chat-rows）/ **SelectionToolbar**（对话区选中文字浮出菜单：添加到对话/新会话继续）/ **MessageItem**（纯分发壳）+ `message-actions.tsx`（复制/Fork/撤回按钮）/ **UserMessage** / **SystemMessage**（compaction 分割线 + mutex 通知）/ **AssistantMessage** / **Markdown**（贡献者可用 `onLink` 接管全部链接并跳过宿主知识导航；markstream-react 流式丝滑渲染，fade 关闭避免合成层闪烁；代码块只读编辑器关闭自动 decoration，样式覆写在 globals.css `.markdown-body`，见 PITFALLS）/ **ToolCallCard** / **SubagentRunCard**（独立行，有 sessionFile 可点开子会话）/ **TodoPanel**（呼吸灯 + 展开 morph 同一容器）/ **MetaGroup**（memo 折叠组 + 圆点行/分类统计行）+ `use-sweep-highlight`（统一扫光）+ `use-shown-working`（working→worked 滞后缓冲）/ **PreviewTicker** + `activity-ticker`（工作中预览行调度）/ **StreamingMarquee**（溢出 tail-follow，位移用 shared marquee-motion）/ **ImagePreview**（全屏多图，portal 到 body）/ **ErrorNote**（统一报错卡）+ **RetryNote**（自动重试瞬态行）/ **CenterOrb** + `center-orb-draw`（中央状态动画，绘制闭式函数）/ **TurnDiffChip**（轮末计时行 + 文件变更 chip；计时器运行中 1s 心跳跳动/定格）/ **RunInspector**（轮次模型/公开阶段/工具/子代理/usage/read paths/artifacts/publication gate）/ `meta-summary-label`（i18n 胶水） |
| `diff/` | **DiffSidebar**（右侧变更侧栏：按轮分组 unified diff + 内嵌 BranchRow git 分支行；开关在 SessionTabBar）+ DiffFileCard |
| `panel/ProcessPane.tsx` + `ProcessLaneView.tsx` | 六泳道过程页与历史轮次选择；只投影公开 transcript 回执，节点内保留运行明细，门卡动作只打开任务面板 |
| `panel/ContextPanel.tsx` | 右栏：总览 / 过程（内含「过程 · 变更」切换，`stores/ui.ts` `processView`）/ 产物；通用待办、授权与决策由 `panel/SessionOverviewSections.tsx` 展示。任务页由已安装 pi-core 的 `panel.tab` 贡献提供 |
| `knowledge/KnowledgeView.tsx` / `KnowledgeSurface.tsx` / `KnowledgeFallback.tsx` / `KnowledgeUiRoot.tsx` | 宿主知识页边界：`knowledge.page` 挂载整页，`knowledge.surface` 挂载设置、笔记、流程回执、Zotero 和机构访问面板；缺插件、停用或渲染失败时展示绑定状态、打开文件夹与插件管理入口（流程卡回退为空）；`KnowledgeUiRoot` 只订阅事件并更新 store，审核弹层由插件 `app.overlay` 贡献呈现。完整产品组件见下行外部目录 |
| `../drone-plugins/packages/desktop-ui-pack/ui/` | 知识 UI 权威源码：`entry.tsx` 提供整页、嵌入面板和审核弹层；`knowledge/KnowledgeView.tsx` 组合「总览 / 网络图 / 审阅 / 设置」与其他插件 `knowledge.tab`，`KnowledgeHome.tsx` / `knowledge-home-model.ts` / `KnowledgeSearch.tsx` 负责概览、分类和搜索，`KnowledgePanel.tsx` 负责维护设置；`api.ts` 只消费公开 DroneUI，文案在 `knowledge/{copy,zotero-copy}.ts`，样式在 `styles/`，组件回归同目录维护 |
| 知识双向链接与知识网络 | worker `noteLinks`（出链 + 反链；只写笔记名的 `[[x]]` 按文件名唯一匹配）与 `graph`（旧 `nodes/edges` 字段保持兼容，并附语义关系/镜像/健康元数据；按索引 revision 缓存 `view/limit/mergeMirrors` 快照）→ ui-service `knowledgeNoteLinks` / `knowledgeGraph` → IPC `knowledge:noteLinks` / `knowledge:graph` → 公开 `window.DroneUI.knowledge`；`../drone-plugins/packages/pi-knowledge/src/core/semantic-model.ts` 负责稳定清洗、镜像合并、关系分类、社区与布局；`../drone-plugins/packages/pi-knowledge/src/core/graph-cache.ts` 负责 revision 边界缓存；插件 UI `../drone-plugins/packages/desktop-ui-pack/ui/knowledge/` 下的 `KnowledgeLinks.tsx`、`KnowledgeNetwork.tsx` + `KnowledgeGraph.tsx`（网络图页签，支持语义/全部文件、聚焦/星云/浏览、节点信息卡；拖拽更新按 animation frame 合并）+ 纯布局回退 `graph-layout.ts`；入库自动关联 `../drone-plugins/packages/pi-knowledge/src/core/related-notes.ts`（`research_deposit_knowledge` 写入前检索相关笔记，正文末尾追加「相关笔记」双链） |
| 每日发现（新旧对照） | 领域：`../drone-plugins/packages/pi-knowledge/src/core/daily-discovery.ts`（扫描上次运行后更新的笔记、想法笔记正文）+ `../drone-plugins/packages/pi-knowledge/src/core/daily-discovery-prompt.ts`（提示词与解析，只由 backend 引用，避免进入扩展类型图）；ui-service `dailyDiscoveryContext` / `saveDiscoveryIdea`；宿主 `backend/src/services/daily-discovery.ts`（`DailyDiscoveryService`：默认开、每小时检查满 24 小时才跑、JsonStore `agent-daily-discovery`、模型 = 最近会话模型或首个已配置 provider）；IPC `knowledge:dailyDiscovery*`；插件 UI `../drone-plugins/packages/desktop-ui-pack/ui/knowledge/DailyIdeas.tsx`（知识库主页「新想法」：开关、现在运行、存为想法 / 忽略） |
| `composer/` | **Composer**（装配层 ~330 行，键盘事件分发）+ 三 hook：`use-composer-send`（ensureSession 懒创建/followUp 排队/停止先 clearQueue/发送失败草稿回填）、`use-slash-menu`（命令拉取+胶囊回填+导航）、`use-at-completion`（@ token 探测/续钻/胶囊弹回 + 消息开头的子智能体候选）+ 展示件 QueueBar/ImageTray/AttachmentChip/**SubagentChip**（@ 子智能体胶囊：Enter 直接派发）/**QuoteChip**（选中引用胶囊）/SendErrorBar + **ModelPicker** / **ThinkingPicker**（按模型 thinkingLevels 过滤+clamp）/ **PermissionPicker**（会话权限模式 chip：默认/完全访问）/ **SlashMenu** / **AtMenu**（子智能体组 + 文件组）/ **ContextRing** + 会话累计用量 `SessionUsageFooter`（移入会话输入区）+ 纯函数 `slash-filter`/`at-files`/`at-subagents`（S9：候选条件 / 过滤 / 合并 / 任务拼装）/`send-error`/`quote`（各有测试） |
| `session/` | **SessionTabBar** + SessionTab/TabPill（状态收拢到头像图标；dnd-kit 拖拽排序，DragOverlay ghost + 轴锁定；拖拽期间退出 drag-region）/ **SessionRail**（左侧会话轨道：细线变形胶囊 + dock 波浪；开关在设置-外观）/ **ApprovalDock**（权限审批：async respond 成功才移除面板，失败保留重试）/ **TrustDialog**（项目信任两选项）/ **UpdateButton**（顶栏更新按钮）/ `session-status`（顶栏与轨道共用的状态/标题纯逻辑） |
| `workbench/SkillsConnectionsView.tsx` | 技能与连接全屏页：按真实 skills/MCP/WebDAV/Zotero/机构访问/UI 插件状态展示能力，开关直接调用现有 IPC；知识库、Zotero 与机构访问配置抽屉通过宿主薄包装挂载 `knowledge.surface`，完整面板在外部 UI 包；状态页不把开关当在线证明 |
| `settings/` | **SettingsDialog**（知识库和 Zotero 设置经 `knowledge.surface` 渲染插件面板；PANELS 注册表；分类 = 静态 + 「高级」分组〔知识库维护 / UI 插件 / 工作流总览 / SSH 主机〔ComputePane 主机登记，同一份登记表供 `ssh` / `ssh_hosts` 工具使用〕〕+ 插件 settings.panel 贡献动态拼接）/ **GeneralPanel**（语言/上下文管理二态/channel-watch 开关）/ **PermissionsPanel**（编辑全局 permissions.json：工作区边界 / 工具规则 + bash 模式表 **PatternTable**（↑↓✕、自保护行锁定表尾）+ 试算 / 高级（审计尾部、文件位置、恢复默认、放弃/保存）；纯编辑模型 `permissions-model.ts`，`PermissionsEditor` 按 props 渲染可单测）/ **AppearancePanel**（主题三段/背景图/轨道/中央动画；UI 插件管理移到 高级 › UI 插件）/ **SkillsPanel**（Tools & Skills：完整 Skill catalog + 默认折叠的 lazy capability/tool schema footprint/最近调用；工作流总览 **WorkflowOverviewPanel** 在 高级 › 工作流总览） / **McpPanel**（MCP 服务器状态/启停 + 「推荐接入」一键添加预设：shared `MCP_PRESETS`〔Playwright 浏览器控制〕→ IPC `mcp:addPreset` → backend `McpService.addPreset` 写用户级 mcp.json）/ **ExtensionsPanel** + `extensions/`（目录浏览/安装/卸载，subagent 包安装两段式确认）/ **UiPluginsSection**（高级 › UI 插件：总开关/插件卡/槽位指派） / **AboutPanel** / `providers/`（ProvidersPanel + ProviderRow 操作全图标化 / LoginDialog（交互登录对话框：OAuth + api_key 交互流）/ CustomProviderForm + ModelRowsEditor（逐模型行编辑器）/ BuiltinProviderEditForm（内置端点覆写）/ SubagentPanel（子代理模型偏好）+ `model-rows` 纯函数） |
| `projects/` | ProjectPage / SearchBar（日常选中时占位词取「日常」）/ ProjectSidebar（内置「日常」空间钉顶条目：canvas 底 + 细边框 + 咖啡 glyph，无删除钮）/ SessionPanel（新会话 = createDraftSession）/ SessionRow（hover 出诊断复制/删除）/ `date-groups` / ProjectBranchPicker（仅 draft 态渲染——真实会话项目绑死不可改；日常 draft 隐藏分支选择器，chip 显示「日常」）/ `diagnostics`（buildDiagnosticsText 纯文本） |
| `ui/` | Button（ghost/primary × sm/md × danger）/ Dropdown / Switch（统一受控开关，支持 indeterminate）/ **Tooltip**（自定义悬浮提示，新增提示一律用它不用原生 title；右缘元素传 `align="end"` 防幻影横向滚动条） |
| `ui/ActionSurface.tsx` + `ui/dialog-stack.ts` | 统一右侧交互面（Ask / Trust / 示例任务 / Wiki 审核）：顶部色条区分 accent/warn/danger，`height="fit"` 卡片或整高抽屉；焦点陷阱 + 关闭后恢复焦点；全局单栈只显示最上层（下层 `inert`），Esc 只交给栈顶 `onEscape`（未提供则吞掉，防止误关下层） |
| `chat/FirstRunGuide.tsx` + `first-run-status.ts` | 首次引导：两段式；探测知识库绑定 / Zotero / 计算主机的真实配置，全部就绪自动不显示，已配置项标「已配置」；打开设置不算完成 |
| `icons/` | 内联 SVG 集中管理；`icons.test.ts` 校验所有 path `d` 语法（防残缺数据被 Chromium 丢弃） |

## 「想改 X 改哪里」速查

| 想改什么 | 改哪 |
|---|---|
| 开屏动画（粒子光团 → 散场） | `renderer/src/styles/splash.css`（全部视觉与编排）+ `splash-dom.ts`（DOM/粒子参数）+ `splash.ts`（时长/单次标记）；首帧主题链 = bootstrap-theme.ts + window.ts + main/index.ts（`?theme=` 传参） |
| 消息气泡 / 代码块 / 高亮 | `components/chat/`（Markdown 样式覆写在 globals.css `.markdown-body`） |
| 首页大字 logo（手稿构造字标） | `chat/WordmarkConstruct.tsx`（空心描边 + 制图构造线静态 SVG，canvas 度量字形墨盒后离线固化；改设计重新烘焙）+ globals.css `--lg-ol/c1/c2/lb`（深浅各一套）；设计稿 `.local/design/pi-logo/wordmark.html`（H2 手稿构造） |
| 报错卡 / 错误分类 | `chat/ErrorNote.tsx` + globals.css（`.error-note*`/`.retry-note`/`.send-error`/`.toast` 段）+ `shared/src/errors.ts`（classifyLlmError 模式表 + 信封构造）+ i18n `error.*`；severity 色改 `--color-err/warn/info`（深浅各一份） |
| 工作中预览行 / 状态动画 | `chat/PreviewTicker.tsx` + `activity-ticker.ts`（minDwellMs 350）+ `MetaGroup.tsx`（状态行 orb + liveItems）+ `use-sweep-highlight.ts`（统一扫光）+ `use-shown-working.ts`（1500ms 滞后缓冲）+ `CenterOrb.tsx`/`center-orb-draw.ts`（中央版，开关 ui-preferences）+ shared `transcript/meta-summary.ts`（圆点行/统计行） |
| 输入框 / 发送 / 停止 / 排队 | `composer/Composer.tsx`（装配层）+ `use-composer-send.ts`（发送/停止/取回排队）；草稿持久在 `stores/drafts.ts`；排队事件 `queue_update` + getFollowUpMessages |
| 模型快速切换 | `composer/ModelPicker.tsx` + `stores/sessions.ts`（models/currentModel/setCurrentModel） |
| 思考深度切换 | `composer/ThinkingPicker.tsx` + `stores/sessions.ts` + `lib/thinking.ts`（clamp 共用；后端 SDK 内再 clamp 兜底） |
| 文件与图片附件（选图/粘贴/拖拽/预览/门控） | `composer/Composer.tsx`（images state + Ctrl+V + 拖拽项目内引用/项目外导入 + imageInput 门控 fail-open）+ `composer/AttachmentChip.tsx`（@ 文件胶囊）+ `chat/MessageItem.tsx`（历史缩略图）+ `chat/ImagePreview.tsx`（全屏预览三处共用）；项目外拖拽导入走 shared `AppContract.importDroppedFile` → preload → `main/ipc/app.ts` 会话附件目录；事件流提取在 shared reducer，历史回放在 backend `toSessionMessages` |
| 结果查看器（侧栏资源预览） | main `desktop/src/main/file-preview.ts`（`previewLocalFile`：kind + 128 KiB 文本前缀 / gzip 解压 / 图片·PDF base64）；IPC `file:preview`；文件类型注册表（扩展名 → mime / text / language / previewKind，P1）`shared/src/file-types.ts`；格式映射 + 表格/序列解析 `shared/src/resource-preview-format.ts`；树（Newick）与多序列比对（Clustal/Stockholm/PHYLIP/比对 FASTA）解析 `shared/src/bio-preview-format.ts`；UI `diff/ResourceSidebar.tsx` → `preview/PreviewHost.tsx`（按 previewKind 分发，`preview/preview-registry.ts` 注册预览器 + 纯函数路由，P2）→ `ResourceTextPreview.tsx`（表格、序列、HTML 隔离 iframe、JSON、代码）+ `ResourceBioViewers.tsx`（`TreeReader` SVG 系统发育图、`AlignmentReader` 分窗着色 + 保守度）；交互 HTML = main `html-preview-protocol.ts`（`drone-html://<token>/` 只服务用户显式打开的 HTML 所在目录，响应 CSP 禁网；iframe `sandbox="allow-scripts"` 无同源）+ IPC `file:htmlPreviewUrl`；图标注 = `diff/FigureAnnotator.tsx`（图片 / HTML 图上点击落点写说明，「发送给 Agent」整理成文字插入输入框）+ main `figure-annotations.ts`（JsonStore `desktop-figure-annotations`，按绝对路径存 userData）+ IPC `figure:annotationsGet/Save`；入口 = 聊天 Markdown 链接 / 任务产物 chip / 卡片路径 → `stores/ui.ts` `openResourcePreview` |
| show_image 发图 | 工具本体 `backend/src/tools/show-image.ts`；实时 = shared reducer（pendingImages 缓冲，turn_end 固化排 assistant 之后）；历史 = `toSessionMessages` 的 `role:"image"`；渲染 = MessageItem image 分支（缩略图按数量分档） |
| subagent 独立行 | 工具 `backend/src/tools/subagent/`；提取 shared `src/subagent.ts`（extractSubagentRuns，结构检测不依赖工具名）；互斥通知 `subagent_mutex` → reducer system 消息（dedup by extensionPath）；渲染 `chat/SubagentRunCard.tsx` |
| 子智能体面板（右栏「子智能体」页签：可用 / 派发 / 本会话运行） | backend `tools/subagent/panel.ts`（`SubagentPanelService`）+ `pi-backend.ts`（`listSessionSubagents/dispatchSubagents/abortSubagentRun/listSubagentRuns`）；IPC `subagents:*`（`main/ipc/subagents.ts`）；事件 `subagent_run`（reducer 原地更新派发行 + `stores/subagents.ts`）；UI `panel/SubagentsPane.tsx` + `subagents-form.ts`、`chat/SubagentAvatar.tsx`（djb2 定色 + data-state 表情）、`chat/SubagentResultCard.tsx`、审批坞来源胶囊；输入框 `@` 选择器 `composer/at-subagents.ts` + `AtMenu.tsx` + `SubagentChip.tsx`（消息开头 `@name 任务` + Enter = 面板单任务派发；草稿 `drafts.subagent`）；文档 [subagents-panel.md](subagents-panel.md)；冒烟 `scripts/check-subagents-ui.mjs` |
| 斜杠命令 | 面板 `composer/SlashMenu.tsx` + `slash-filter.ts` + `use-slash-menu.ts`；命令表 backend `slash-commands.ts`（draft 态走 listSlashCommandsForCwd）；**模板/skill/扩展命令 SDK 原生展开无需代码**；`/settings` 定位走 settings store `openWith()` |
| Zotero 文献库 | 架构 `docs/zotero-literature.md`；实现 `.pi/extensions/zotero-literature.mjs` + `../drone-plugins/packages/pi-research/src/core/zotero-*.ts` + `skills/zotero-literature`；UI `../drone-plugins/packages/desktop-ui-pack/ui/knowledge/` 的知识库总览「接入 Zotero」与 `ZoteroPanel.tsx`；宿主设置/技能页仅保留 `knowledge.surface` 挂载入口；MCP 默认关闭 |
| 上下文压缩 UI | compaction_start/end → shared reducer 生成 system 消息 + compacting 位（**压缩期间 Composer 禁发**，SDK 拒绝压缩中的 prompt）；渲染 `chat/SystemMessage.tsx`（分割线，done 可展开摘要）；手动 `/compact [focus]`（focus 拼入摘要 prompt）；**压缩后 UI 历史完整保留**（SDK 只裁 LLM 上下文，jsonl 完整，reducer 只追加分界线） |
| 上下文蒸发 | backend `tools/context-evaporation/`（见 backend 表）；开关 = 设置 GeneralPanel 二态（默认蒸发，写 settings.json 单 key，2s 生效免重开）；调参 `scripts/replay-evaporation.mts`；观测 = log `context-evaporation` 行 + trace_custom |
| 上下文用量圆环 | `composer/ContextRing.tsx` + `hooks/use-context-usage.ts`（事件驱动刷新，与插件 host API 共用）→ IPC getContextUsage → SDK `session.getContextUsage()`（percent null 或无消息不渲染；<60% 灰 / 60-85% 琥珀 / >85% 红） |
| 会话用量与输出速率 | `chat/UsageSettlement.tsx` 的 `SessionUsageSummary` 在输入框上下文环悬浮提示里显示会话累计 token（`SessionUsageFooter` 保留完整明细卡）；`chat/TurnFooter.tsx` 在每轮完成后显示输出 tok/s；累计卡位于 Composer 输入区上方，明细仍可展开 |
| 审核卡片 | pi-core 同包 UI 消费安全 `UIMessage.taskView`，经 `chat.message` 贡献渲染任务验收动作；任务页经 `panel.tab` 贡献，动作仅走通用 `sessions.prompt` → `/task-action`。宿主 `MessageItem` 仅提供普通消息默认呈现 |
| 每轮计时行 + 文件变更 chip + diff 侧栏 | 计时 shared `transcript/turn-timings.ts`（deriveTurnTimings；分量 = reducer 盖戳的 `UIToolCall.endedAt` + `runEndedAt` 定格 + 历史回放透传 toolResult timestamp）；变更 shared `transcript/turn-files.ts`（deriveTurnChanges）+ `chat-rows.ts`（行定位：每轮必有计时行，缺省不传 timings 保持旧行为）；渲染 `chat/TurnDiffChip.tsx`（timer 恒在首位）+ `diff/DiffSidebar.tsx`（含 BranchRow）；开关 = SessionTabBar 的 DiffIcon 按钮 + `stores/ui.ts` diffSidebarOpen |
| 顶栏 tab / 拖拽排序 | `session/SessionTabBar.tsx`（dnd-kit，DragOverlay ghost 拾起时实测宽度沿用原胶囊 + 轴锁定 + drag-region 退出）+ `stores/sessions.ts` reorderSessions（draft 无 sessionFile 只参与内存序） |
| 左侧会话轨道 | `session/SessionRail.tsx` + `stores/ui-preferences.ts`（开关持久化）+ `session-status.ts`（状态逻辑与顶栏共用）；逐帧截图 `scripts/shoot-rail.mjs` |
| 权限审批面板 | `backend/src/permissions/gate.ts`（队列）+ `session/ApprovalDock.tsx`（快捷键 Enter/A/D/Esc；await 成功才移除） |
| 会话权限模式（默认/完全访问） | 后端：`pi-backend.ts`（`permissionModes` map 内存态 + `get/setSessionPermissionMode`）+ `permissions/extension.ts`（fullAccess 审计分支）+ `permissions/audit.ts`；IPC：`PermissionGetMode/SetMode`；前端：`composer/PermissionPicker.tsx`（chip）+ `stores/sessions.ts`（`permissionModes` map，draft 态转正在 ensureSession 应用）+ `use-composer-send.ts`。模式不落盘、不跨会话继承、重启归零（spec permission-mode D1） |
| 逐工具权限规则 | `backend/src/permissions/`（求值链在 extension.ts：deny → 临时区 → 多根边界读写分离 → 项目记忆 → ask）+ `project/workspace-store.ts`；enabled=false 只能手改 permissions.json（UI 无入口的逃生舱，设置页只出横幅）；设置页工作区根管理 UI 未实现，手改 workspaces.json |
| 权限设置页（设置 → 权限，编辑全局 permissions.json） | backend `permissions/settings.ts` + `config.ts`（`parseConfig` 显式布尔 / `serializeConfig` / `validateConfig`）；IPC `permissionSettings:*`（`main/ipc/permissions.ts`）；renderer `settings/PermissionsPanel.tsx` + `PatternTable.tsx` + `permissions-model.ts` + `stores/permissions.ts`；文档 [permissions-settings.md](permissions-settings.md)；冒烟 `scripts/check-permissions-ui.mjs` |
| 项目信任 | backend `project/trust.ts` + `trust-loader.ts`；触发点 `stores/sessions.ts`（createDraftSession/setDraftCwd）与 `stores/projects.ts`（addProject）；弹窗 `session/TrustDialog.tsx` |
| 日常空间（非项目闲聊维度） | main `daily.ts`（目录）+ IPC `app:getDailyDir` → renderer `lib/daily.ts`（缓存/判定）；侧栏钉顶条目 `projects/ProjectSidebar.tsx`（选中后 selectedCwd=dailyDir，右栏/搜索/新会话全复用）；隔离 = `stores/projects.ts` deriveProjects 过滤 + deleteProject 守卫（有 projects.test.ts）；空态 chip `ProjectBranchPicker.tsx`（下拉钉顶「日常」项，draft 日常 ↔ 项目双向切换）；胶囊/轨道咖啡头像 `SessionTabBar.tsx`/`SessionRail.tsx`（余态白底黑字，状态色优先）；设计稿 `.local/design/ux/daily-space/` |
| 会话分叉 / 撤回 | backend `forkSession`/`recallMessage`（目标解析在 session/messages.ts；**agent 运行或压缩期间均拒绝**）；renderer `stores/sessions.ts`（fork 新 tab 打开并返回新 sessionId；recall 草稿回填 + COMPOSER_FOCUS_EVENT）+ `chat/message-actions.tsx`（ForkButton 挂轮次末段正文/RecallButton 挂用户气泡，运行/压缩期间禁用） |
| 对话区选中引用 / 引用胶囊 | 弹出菜单 `chat/SelectionToolbar.tsx`（selectionchange 缓存 + mouseup 显示；菜单 onMouseDown preventDefault 保选区；readOnly 不弹，busy 禁 fork）→ 草稿 `quotes: string[]`；胶囊 `composer/QuoteChip.tsx`；发送拼接 `composer/quote.ts`（buildQuoteBlock 置最前 blockquote）；「新会话继续」= forkSession 末条 assistant（entryId 优先/sourceText 兑底）→ 写新会话 draft |
| todo 面板 + compaction 恢复 | 工具 `tools/todo.ts` + 恢复注入 `tools/todo-reminder.ts` + 读取 `getTodos`；UI `chat/TodoPanel.tsx` + `stores/ui.ts` todoExpanded；reducer 提取 `tool_execution_end`；打开会话恢复 = loadSessionBundle 后 loadTodos |
| 会话自动命名 | `backend/src/session/naming.ts` |
| webfetch 工具 | `backend/src/tools/webfetch/`（SSRF 在 ip-guard.ts；截断/超时/重定向参数在 tool.ts） |
| 社区包目录（浏览/安装/卸载） | backend `packages/catalog.ts` + `admin.ts`；UI `settings/extensions/` + `stores/catalog.ts`（防抖/防陈旧/装卸态） |
| provider 设置 / 交互登录（OAuth + api_key） | backend `settings/settings.ts` + `login.ts` + shared `settings.ts`（类型）+ IPC `settings:login*`；UI `settings/providers/`（表单/登录对话框）+ `stores/provider-login.ts` + `stores/settings.ts` |
| 子代理模型/Thinking 偏好 | backend `settings/model-prefs.ts`；UI `settings/providers/SubagentPanel.tsx`（protected knowledge roles 同页，显式不可用时 fail-closed） |
| 自动更新 | `main/updater.ts` + `update-policy.ts` + shared `update.ts`；UI `session/UpdateButton.tsx`（顶栏）+ `settings/AboutPanel.tsx`（手动检查） |
| 主题 / 背景图 / Markdown 代码块主题 | `stores/theme.ts` + `styles/globals.css`（双套 token）；main `background.ts` + `pi-bg://` 协议（CSP img-src 含 pi-bg:）；UI `settings/AppearancePanel.tsx`；代码块主题走 `Markdown.tsx` 的 isDark + 显式双主题 |
| Toast | `stores/toasts.ts` + globals.css `.toast` 样式段 |
| 通用插件消息呈现 / 会话动作 | `plugins/session-api.ts` 复用现有 prompt IPC 并提供稳定的安全消息 hook；`MessageItem.tsx` 的 `chat.message` 槽位支持直接默认回退，合同见 `plugin-api/src/ui.ts` 与 UI SPEC。 |
| UI 插件（槽位/区域/面板/无头/热重载） | 运行时 `renderer/src/plugins/`（registry：headless activate/cleanup 生命周期）；构建/扫描 `main/ui-plugins/`（build/manager/config，已安装包完整树内容寻址并在代次变化后要求重新确认）；IPC `main/ipc/ui-plugins.ts`；类型 shared `ui-plugins.ts`；规范与内置插件 `desktop/resources/ui-plugins/`（SPEC.md / drone-ui.d.ts / skills / examples / builtin/，含 voice-alerts 语音提醒） |
| 语音提醒（任务完成/审批等待播提示音） | 内置无头插件 `resources/ui-plugins/builtin/voice-alerts/`（全局安静检测状态机 + `new Audio(dataUrl)`，激活/清理走 registry headless 生命周期；开关 = UI 插件面板的插件启用）；音频 = 插件 `src/assets/*.mp3` dataurl 内联，替换文件即热重载；主窗口 `backgroundThrottling: false`（锁屏/后台不节流提醒计时） |
| 新增 IPC 通道 | 见硬约束「四处同步」 |
| 新增设置面板分类 | 面板文件 + `settings/SettingsDialog.tsx` 的 `PANELS`（插件 settings.panel 贡献不用登记，registry 动态拼接） |
| 文案 | `i18n/zh.ts` + `en.ts` |
| 示例任务（任务页签空态卡 / `/` 菜单「示例：…」/ 表单对话框） | 数据 shared `example-tasks.ts/json`；UI `components/tasks/ExampleTaskCards.tsx` + `ExampleTaskDialog.tsx` + `stores/example-tasks.ts`；菜单项 `composer/slash-filter.ts`（`exampleTask` 字段）；发送复用 `use-composer-send.ts` 的 `ensureActiveSession` + `prompt`；路径选择 IPC `file:pickPath`；文档 [example-tasks.md](example-tasks.md) |

## 本地文档（`.local/`，不入库，会定期清理——引用可能失效）

- `.local/docs/release.md` — 打包/发版流程（CI、签名、网络备忘）
- `.local/agent-work/spec/`、`plan/` — 临时设计规范/实施计划（按目录 ls 找，不逐文件索引；清理后引用即失效）
- `.local/agent-work/channel/<主题>/` — 跨会话沟通频道（channel-watch 扩展监听，配套 skill channel-pickup/design-handoff）
- `.local/design/` — 设计稿：`ux/error-system/`（报错卡定稿，项目设计语言基准）、`ux/lan_observer/`、`ux/turn_diff/`、`components/center-status-anim/`、`icons/` 等
- `.local/docs/research/` — 外部技术资料研究笔记
- `.local/docs/INDEX-full-2026-08.md` — 本次精简前的完整版索引归档（含实现细节）

`@gyoungwe/pi-knowledge/host` 承载语义 provider 配置验证、bounded request/response 与向量安全校验；宿主只负责凭据、同意和调度。

原生 Pi 插件架构新增执行计划见 [P0–P7](pluginization/native-plugin-implementation-plan.md)，依赖与原生兼容覆盖清单见 [inventory](pluginization/native-plugin-inventory.md)。正式安装包的空可选 UI profile 回执见 [zero-optional-plugin evidence](pluginization/native-plugin-zero-optional-evidence.md)。`scripts/check-native-plugin-boundary.mjs` 是新增最终边界门禁，当前未清零。运行时生命周期在 `packages/backend/src/plugins/`，UI 绑定/context 在 `packages/desktop/src/renderer/src/plugins/runtime.ts`，应用级 owner 协调在 `packages/backend/src/plugins/coordinator.ts`，主进程窗口门面在 `packages/desktop/src/main/ui-plugins/runtime-bridge.ts`。

`backend/src/plugins/session-caller.ts` 从真实 SessionRegistry entry 提供规范工作区、会话代次及撤销信号；`desktop/src/renderer/src/plugins/caller.ts` 同步活动会话并携带主进程签发的 selection lease，防止旧界面请求在切换会话后被解释为新调用。无会话时显式使用 application scope；应用级后台可以被多个窗口共享。该通用机制尚不代表知识 UI 与原生工具已共用领域实例。

原生插件 P1 机制：`backend/src/plugins/{runtime,process-runtime}.ts` 管理独立实例/进程；`plugin-runtime-executable.ts` 校验随包 Node；`plugin-sandbox-ui.ts` 约束官方 Pi 基础对话请求；`session-engine/engine.ts` 同时启动扩展 shutdown 与 SDK abort，等待两者后销毁会话；`backend/test/session-shutdown-sdk.test.mjs` 回归真实 SDK 工具与关闭 hook 的双向等待；`shared/src/host-api/plugin-runtime.ts`、preload 和 `main/ipc/plugin-runtime.ts` 传递主进程绑定的通用调用。新知识 UI 同包及基础状态/写者迁移设计与证据在插件仓库 `docs/knowledge-ui-co-package-2026-10-26.md`、`docs/native-knowledge-runtime-plan.md`。

P2 原生/桌面共同 owner 最小接入：`backend/src/plugins/coordinator.ts` 管理 native bootstrap、真实 session 绑定及 UI lease；`runtime-capabilities.ts` 执行逐调用 schema/effect/生命周期授权，`process-runtime[-worker].ts` 共用隔离进程协议传递原生只读工具和派生资源调用。`backend/test/native-runtime-owner-sdk.test.mjs` 用真实 SDK 两会话证明同进程 owner 与两种关闭顺序；它不是完整知识领域或正式安装包验收。`plugin-api/src/{native,resource}.ts` 是 1.3 候选的 type-only 可选合同；完整 hooks、publication proof 跨进程投影和其余知识 UI 方法仍未完成。

`backend/src/plugins/file-capabilities.ts` 读取已批准根的稳定文件快照与配置，区分文件删除、根撤销和 JSON 损坏；独立 `application-state-write` 授权允许通过 JsonStore 执行受限 JSON CAS 写入，具体合同与并发边界见[状态能力](pluginization/native-plugin-state-capabilities.md)；`resource-capabilities.ts` 复用实际隔离进程、排空在途请求并管理资源，`resource-reservations.ts` 在完整 owner 关闭后释放跨进程写者租约。`desktop/src/main/ui-plugins/runtime-host.ts` 在每次资源激活时明确选择只读数据目录及只读或独立授权的 JSON 状态目录，构造每插件私有缓存与能力 provider；其单元测试不代替正式 GUI 授权验收。UI 合同 v2 仅接受已验证的 installed desktopRuntime，旧 v1 合同保留；候选知识页目前只有总览/搜索/刷新，其余领域迁移未完成。

知识候选 tarball 的独立实际 SDK 验收见 [packed knowledge runtime acceptance](pluginization/packed-knowledge-runtime-acceptance.md)：`backend/test/packed-knowledge-runtime-sdk.test.mjs` 使用真实 coordinator、只读会话条目和合成 Vault，验证 native/UI 同 owner、逐操作拒绝和双进程退出；默认门禁不设置 tarball 时明确跳过。[正式阅读 GUI 回执](pluginization/native-plugin-knowledge-reading-gui-evidence.md)保留任务守卫、恢复及退出的实际失败，不能与 SDK 通过互相替代。[原生事件适配](pluginization/native-plugin-event-adapter.md)说明逐 handler 的真实 SDK 串联与尚未支持的 publication proof 边界。

P2 后继的受控 Markdown CAS 写端口（workspace-write）与状态删除已通过真实临时目录、撤销、冲突、符号链接和同启用实例并发回归；正式安装包尚未消费该新写端口。

任务 UI 迁移兼容边界：`renderer/plugins/legacy-task-artifacts.ts` 仅保留已公开 1.x `helpers.taskArtifactLinks` 的原行为，无活跃宿主或知识 UI 消费；API 2 删除。`shared/task-workbench.ts` 保留安全投影类型与输入解码；`hostStatus` 仅标记可显示来源，不授予任务动作或发布权限。科研示例/首次引导仍在宿主，留后续插件贡献迁移。
