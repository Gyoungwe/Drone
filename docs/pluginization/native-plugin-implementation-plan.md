# 原生 Pi 插件架构执行计划

2026-10-26。用户已批准「通用宿主 + 可卸载功能插件」并要求设置目标、子代理并行实现。依据：[设计](../superpowers/specs/2026-10-26-native-pi-plugin-architecture-design.md)。本计划记录新增架构范围，不覆盖旧计划的真实验收结论。

| 阶段 | 交付与完成条件 | 当前状态 | 依赖 |
| --- | --- | --- | --- |
| P0 | 依赖/数据归属清单、原生 Pi 兼容矩阵、可重复的领域耦合扫描 | 清单和静态检查已实现；110 项初始耦合；锁定 1.1.0/latest 1.4.0 真实会话基础 UI 对照通过，全 API 兼容尚未完成 | 无 |
| P1 | 通用 runtime 生命周期、包来源绑定、权限、隔离进程、UI 调用和撤销 | 应用 owner/真实会话/selection lease 回归及正式 DMG application→A→application→B→A、停用/拒绝/恢复/退出切片通过；领域桥接继续由 P2 完成 | P0 |
| P2 | knowledge 领域服务、worker、schema 和 UI 同包；宿主删除对应装配和专用接口 | 同 owner 的阅读、图谱、分类、最小审核策略和 native hook 生命周期切片已通过候选包/真实 SDK；正式阅读 GUI 历史失败保留；后继正式包的工具、设置、停用恢复与退出复验通过；完整服务写操作和宿主删除仍未完成 | P1 |
| P3 | research、来源连接器、引用/Zotero 等领域 API/页面迁移 | **部分完成**：`pi-connectors` 已新增 arXiv 与 Semantic Scholar 只读声明；`pi-research` 已增加只读 Desktop runtime 的 status/listRuns host 合同和路径隔离回归；完整 Zotero host adapter、页面和写入迁移仍未完成 | P2 |
| P4 | tasks、编排、领域记忆及 UI 迁移 | **部分完成**：`@gyoungwe/pi-workbench@0.1.0` 提供 registration-scoped 工具、host-owned state.read/write、版本 CAS、取消/停用和官方 loader smoke；桌面 UI 与旧宿主装配仍未完成 | P2 |
| P5 | analysis/evidence 迁移；跨插件依赖通过显式合同管理 | **部分完成**：宿主已接入 manifest 声明的 `analysis_prepare_evidence` 与 `evidence_validate_manifest` 只读合同，缺失时返回 `unavailable`，成功回执带稳定内容哈希；持久化证据和真实会话仍未完成 | P3/P4 |
| P6 | 科研发行为可卸载预设；构建/锁文件去除领域必需依赖；删除旧路径 | **部分完成**：UI 已安装包内容寻址，入口或嵌套依赖就地替换会撤销旧绑定并要求 reload；跨包 hoisted 依赖闭包、持久化安装代次和旧路径删除仍未完成 | P2–P5 |
| P7 | 双仓库最终门禁、同 tarball 原生 Pi 真实会话、正式安装包零插件及升级/停用/回滚 | 待开始 | P6 |

## 工作分配

- 主代理：集成分支、共享合同/IPC、来源绑定与授权、端到端与最终门禁、计划与证据。
- 运行时子代理：registry 生命周期、独立进程、权限和撤销回归。
- UI 子代理：UI client/context、加载和挂载、安装包来源发现。
- 盘点/迁移子代理：静态边界检查、知识 UI 同包迁移和插件仓库验证。

共享宿主工作树按文件分工；插件仓库单独分支。P3/P4 只在 P2 合同与数据归属稳定后并行，避免同时建立互相不兼容的领域入口。

## 检查与状态语义

- `npm run check:native-plugin-boundary` 当前应失败并输出 `INCOMPLETE`；这是新增目标缺口，不是允许绕过的最终门禁。清零只能说明静态边界，不能替代真实运行。
- `node --test scripts/check-native-plugin-boundary.test.mjs` 验证扫描行为。
- P1 单元/IPC/子进程测试只记「测试通过」；不得写成正式安装包 PASS。
- 每个阶段运行相关检查，最终宿主 lint/typecheck/test/build/check:arch 和插件仓库 check 必须全过。
- 候选包尚未发布；旧 npm 版本不可变。新增接口和破坏性迁移按设计版本化。

## 安装代次与后续验收

P1 的 runtime 已改为应用级 owner 与逐调用可信上下文：无会话是 application scope；选择已有会话后由 backend 的真实 entry 提供 workspace/session、信任与寿命。主进程签发的 selection lease 防止 A→B→A 切换后旧请求复活。[新版正式安装包切片](native-plugin-app-owner-packaged-evidence.md)已通过，尚未接入知识原生工具的领域 owner。包管理 IPC 的替换和删除先撤销绑定并等待运行中操作及进程销毁，再改包文件。扫描缓存现在只记录 npm 包身份及规范路径，不能识别在同一路径直接覆盖包内容的外部修改；该情形尚未完成验收。

P6 必须建立覆盖**完整包及其运行依赖**的内容寻址、不可变安装代次，不能只散列 runtime 入口。具体回归包括：保持包名/安装路径/入口路径不变，分别替换入口、被导入模块及依赖文件；旧绑定必须失效，授权等待不得随后启动被替换内容；新绑定只执行已确认代次。还需验证旧进程真实退出之前不可切换或回滚安装代次，销毁失败时禁止继续替换，并完成正式安装包的升级/回滚证据。

## 不在本目标内

旧 Zotero 云端/身份冲突、用户自有认证 MCP、Protocols.io 写入、其他平台真实设备四项保持未完成。MinerU/GROBID、B8/B8-2 保持暂缓；不增加相应基础实现。

## 执行记录

- 2026-10-26：新目标登记成功，三个子代理并行工作。P0 初始扫描 110 项领域耦合；P1 生命周期和 UI context 已有行为回归，尚无新正式安装包验收。
- 2026-10-26：宿主 `370038de` 与插件 `a275f7d` 建立第一轮检查基线；实际 DMG 的窗口作用域后台/UI 切片通过，见[安装包证据](native-plugin-p1-packaged-evidence.md)。不是 P2 或零领域插件完成。三个子代理继续实例化、应用 owner/真实会话上下文及聚合包声明依赖的 UI 发现。
- 2026-10-26：应用 owner、真实 session identity 与 selection lease 已接入生产 IPC，独立复核修复授权窗口关闭、切换会话旧输入和等待停用时迟到加载三个竞态。宿主完整 lint/typecheck/test/build/check:arch 通过（`/tmp/drone-app-owner-*.log`）；聚合包声明依赖 UI 发现已提交 `891309b9`。API 1.3.0 仍为候选；application-state 仅声明专用状态/租约目录，不自动授予任意文件权限，新知识 state broker 尚未接入。
- 2026-10-26：宿主 `561a370c` 正式 DMG 使用本地离线模型运行两个真实会话，确认后台实例复用、正确逐会话作用域及停用/恢复/退出，见[新证据](native-plugin-app-owner-packaged-evidence.md)。插件 `32cd3a3` 的实例/lease/关闭失败基础门禁通过；`793c890` 与 `c8b75c5` 分别提交 topic/delivery 实例化及 topic 元数据修复；完整 native owner 接入仍在实施，后续统一重建检查。

- 2026-10-26：插件 `3808e84` 完成原生 owner 注入与每会话票据、取消和发布证明隔离，全仓 check 通过（knowledge 64 文件/426 测试）；同 tarball 默认 CLI 真实 SDK 配置态两次运行及租约释放/重启通过。宿主 `0f1740d7` 修复关闭 hook 与取消互等、捕获 SDK 错误通道，完整五门禁及[新安装包活跃请求退出](native-plugin-shutdown-packaged-evidence.md)通过。下一切片为 native/UI 共用 owner 的知识总览/搜索与必要能力 broker。

- 2026-10-26：P2 增加只读桌面入口、独立索引资源和逐调用能力路由；第一轮双仓库完整检查通过。真实协调器验收另发现 workspaceId 被误当路径，独立 UI 复核发现索引更新会清空搜索结果，均进入修复。正式候选以修复后重新固定的 tarball 与门禁为准；P2 不因此标记完成。

- 2026-10-26：阅读候选 `12f1caf` 与设置候选 `905cd2d` 分别通过插件全检查及真实 SDK；显式 state-write grant、原子版本写、回读、损坏拒绝和撤销已验证。正式 DMG `4550f1a9` 的阅读/范围/停用通过，但实际模型工具被旧任务守卫阻断、恢复目录提交不可用、退出后空窗仍存活，见[原始回执](native-plugin-knowledge-reading-gui-evidence.md)。守卫修复 `a031fc96` 已通过真实跨会话测试；关闭竞态修复与新 DMG 验收继续进行。

- 2026-10-26：`ad3cd189` 正式 DMG 与设置候选完成[限定范围 GUI 复验](native-plugin-knowledge-state-gui-evidence.md)：真实两个工具均非错误，写入拒绝/保存回读、停用零子进程、重新启用保留设置及一次正常退出通过。完整 P2 服务/hooks/审核与旧代码删除仍在实施，资源关闭新合同不混入该安装包证据。
- 2026-10-26：P2 native hook 切片 `25eacb4` 为 `appendEntry`、`sendUserMessage`、`events` 和 `sessionManager` 绑定会话 owner/票据并在 dispose 撤销，6/6 生命周期测试通过。P3 连接器切片 `1f7778a`、P4 workbench 切片 `7163aee`、P6 安装代次切片 `6fc5cf11` 已提交；插件仓库在 API 1.3 候选环境下完成知识包、各独立包、干净安装、UI smoke 与 PDF Canvas 检查，`research-suite` manifest 工具一致性测试修复并由 `5e81503` 刷新生成物。完整 SDK locked/latest 干净安装和正式 GUI 候选替换仍未完成；API 1.3 尚未发布。
- 2026-10-26：P3 host runtime `699b02f`、P4 host-owned workbench `638d699`/官方 loader smoke `bd358df`、P5 analysis/evidence 合同 `0ad8ae5` 已提交；对应 typecheck、注册测试、clean install/loader smoke 和 8 包 manifest 检查通过。P3/P4/P5 仍只完成 host contract 切片，未标记完整领域迁移或真实桌面工作流 PASS。
- 2026-10-26：宿主补充零可选 UI 插件启动/发现回归：在空的 Pi 托管 `node_modules` 下创建 `UiPluginManager` 并执行 `init()`，确认扫描列表、未知插件信息、runtime source 和启用状态均保持空/禁用且不抛错。测试为 `packages/desktop/src/main/ui-plugins/installed-ui-pack.test.ts` 的 `keeps the host usable when the managed package root is empty`；该切片只覆盖宿主 UI 发现，不代表 P7 正式安装包零插件验收。

- 2026-10-26：宿主新增 `analysis-evidence-host` 通用组合：仅消费已声明的 analysis/evidence 工具，要求 evidence plan 声明 `execution=host-required`，再由 validator 校验宿主 manifest；`analysisEvidence.prepareEvidence` 返回稳定只读回执。当前锁定的公开 `pi-analysis@0.1.2` 尚未声明该工具，因此默认明确返回 `unavailable`。
