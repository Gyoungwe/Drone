# 原生插件迁移后继状态历史快照

以下保留状态更新时的原始范围；2026-10-29 当前状态以执行计划顶部和阶段表为准。

## 后继并行工作

最新本地整合已包括共享 owner、串行 TaskSession、真实 SDK 最终出口/历史来源、managed command、原窗口问答及取消、通用执行事务与配置镜像检查。插件 `e713409` 使用不可变 API 1.3 候选 `6a011fc8`（SHA-256 `a83db1c2…3cb77e`）通过完整检查，五包从干净 archive 重建，四个迁移源码锁已同步并通过默认远程 fetch。同 tarball 的知识/模型/应用撤回、discovery 共享 UI/native 与旧 writer、任务事务真实 SDK 三文件 8/8；源码来源/聚合/UI 66/1 skipped、失败关闭与 alias、原窗口问答有独立定向证据，见[本批整合回执](../releases/native-plugin-source-owner-integration-2026-10-28.json)。本批宿主整轮冻结门禁尚未完成，顶部 `4abdae43/253c47e` 标准门禁基线保持不变；没有新安装包、npm 发布或 main 合并。

无 UI 包已接同一 source catalog，完整内容 hash 与安装位置/声明入口共同校验；安装 UI 编译到宿主内容寻址缓存，失效旧描述仅保留为 unavailable。UI-only 撤销保持 native owner；全包撤销必须实际取消 SDK 并排空，失败屏障也阻止同包另一个 alias 接管。实际 selected-path intake、首次 loader 失败/缺失声明、跨重启 required 期望和明确包级启停仍在接线。native boundary 当前仍 exit 1/INCOMPLETE：build15、manifest10、type5、runtime1、resource21、required locks4。

通用执行能力的受理/回执/取消、限定配置镜像 ID 和目录租约已实现并有机制回归；当前没有旧缓存镜像，不能沿用此前真实 Docker 成功。Discovery 完整执行/Inquiry、R0 records/provider 与原生 CLI 故障恢复、知识完整 publication、P3/P5 控制器/UI 和 P6/P7 仍未关闭。旧四项外部验收与暂缓范围不变。

后继源码 `c8f8e43f/23912fb` 已整合任务状态路由、managed command 与 canonical 模型评审。定向24+13、knowledge532、core29+210与真实受限双进程同tarball评审/取消/应用撤回通过，见[整合切片](../releases/native-plugin-managed-knowledge-integration-2026-10-28.json)；当前源码锁仍为253，新的双仓库根门禁尚未执行，顶部标准门禁基线不变。

- 当前 `4abdae43/253c47e` 只关闭本轮源码与真实 SDK 切片；新私有 API 1.3 同时包含 UI seam、command、模型/取消、caller.scope 与独立 Node lease 子路径，根/UI/runtime 合同不依赖 Node。完整 managed hooks/proof 与正式包仍未完成。
- P2 模型评审 owner/UI `1399b33` 已在隔离插件分支通过 531 项回归与真实 SQLite/SDK 切片；已合入后继源码但尚未纳入当前来源锁。后继 managed command consumer 已通过真实受限进程同包验证，旧公共 UI 1.x 路径保留真实行为；不能用无 worker 的 adapter 验证宣称 managed 端完整可用。
- P4 自然语言任务状态路由 `8a596bfa/58d5902` 与 managed command `368b63ed` 已整合后继源码，待统一来源锁与完整门禁。后者只支持已证明的最小 context，void command 不伪造文本返回；动态 native 包启停和 startup taskHost 删除仍需继续迁移。
- P5 正在接通真实共享 owner、显式历史状态目录绑定、同进程/跨进程写者竞争和清理失败保留租约；执行持久回执/Inquiry 与完整 B5 UI 继续实施。不把只读原生工具或容器清理切片当作完整 P5。
- P3 研究/Zotero 与 P5 分析/证据完整控制器、页面和旧宿主业务删除尚未完成。P6 继续删除四个必需领域锁及构建/资源闭包，并以真实零领域安装包验证普通聊天；默认知识 publication 对无领域会话的干预仍需处理。
- 顺序：整合已冻结业务与 managed command → 统一下一 API/候选包及双仓库门禁 → 同候选正式 GUI；同步完成剩余领域迁移和真实零领域独立构建，目标保持 active。

