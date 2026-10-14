# v0.32.0 统一交付计划

**基线：** `v0.32.0` / `022d0eac1d585ed295e09deb22b18de2ed13ef16`  
**目标：** 将 UI、RunAttempt 因果链和 ClawsGO Science 三个会话的计划收敛为一条可验证的交付链，并在完成门禁后合并到 `main`。

## 1. 交付顺序

1. **基线与范围冻结**
   - 所有行为改动以 v0.32.0 为父提交。
   - 保留根工作区已有用户文件，禁止提交凭据、会话正文、Vault 正文、`results/` 和本机私有状态。
   - 每个 workstream 先完成源码、测试、文档索引，再做统一集成。

2. **UI P0/P1**
   - 设置 dialog 在窄窗口可收缩、滚动可靠，长文案和长路径不撑出横向滚动。
   - ContextPanel tabs 补齐 `aria-controls`、`tabpanel`、方向键/Home/End 和焦点回收。
   - Button、IconButton、Switch、Dropdown、Tooltip 使用统一的 100–200ms 反馈和 reduced-motion 规则。
   - 任务、变更、文件保持清晰的摘要/跳转层级；列表超过 100 项时明确限制渲染数量并保留完整汇总。
   - 验收：桌面 typecheck、相关面板/设置测试、完整 desktop 测试矩阵、lint/build/check:arch。

3. **C1 RunAttempt / causation lineage**
   - C1-1：shared `CausalEnvelope`、安全 ID 校验、hash 排除和旧 schema 兼容。
   - C1-2：analysis prepareCompute 创建 attempt 根，绑定 provenance、compute binding 和恢复语义。
   - C1-3：ExecutionReceipt、ComputeTaskBinding、JobSpec、SubmissionRecord、DirectRunner 和 ComputeService 传播 lineage；unknown 只 reconcile，幂等提交不重复副作用。
   - C1-4：intent journal start-before-effect fsync，end/output 建立直接因果；checkpoint hash 排除 lineage，replay 创建新 attempt。
   - C1-5：backend 脱敏只读 projection 按 attempt/event 聚合 binding、receipt、intent、checkpoint、replay，旧记录没有显式 lineage 时保持 partial。
   - C1-6：补齐 crash/restart、unknown reconcile、retry/branch、hash/capsule 回归，执行完整 DoD。
   - 验收：shared/compute/backend lineage 测试、全仓 typecheck、lint、test、build、check:arch。

4. **ClawsGO Science follow-up**
   - 保留 ClawsGO CD-Search 的可复核边界：不把外部观察写成仓库事实，不把科学推断写成实验证据。
   - 以 v0.32.0 evidence capsule、哈希、审计字段和 P2/P3/P5 gate 为入口，复拆真实任务路径、失败边界和可迁移接口。
   - 输出 follow-up 计划、证据矩阵和下一批可执行任务；计划文档与索引同步，避免写入真实凭据、Vault 正文和私有结果。
   - PR #192 的文档计划在统一分支中作为独立可审阅文件保留。

5. **统一验收与合并**
   - 先运行 `npm run lint`、`npm run typecheck`、`npm test`、`npm run build`、`npm run check:arch`。
   - 环境限制导致的端口、watcher、网络或生成物失败必须与源码失败分开记录；相关 workstream 的目标测试必须全部通过。
   - 检查 `docs/INDEX.md`、`docs/architecture-v2-tasks.md` 和各专项计划的完成状态。
   - 将统一提交推送到独立分支，等待 GitHub CI；CI 全绿后 squash 合并到 `main`，再验证主分支提交、PR 状态和发布基线。

## 2. 当前完成度

- **UI：** P0/P1 行为改动已落地；桌面 typecheck、5 个相关测试文件 18 个断言和完整 desktop 141 个测试文件/761 个断言通过。
- **C1：** C1-1 至 C1-5 已落地；causality projection、intent journal、analysis controller 目标测试通过；完整 DoD 和远程 CI 待完成。
- **ClawsGO：** follow-up 计划和索引改动已形成，需随统一变更进入同一审阅/合并链。
- **统一分支：** 本地集成提交已生成；还需通过 GitHub API 建立远程提交/PR，待 CI 后合并。

## 3. 完成判定

统一交付只有在以下条件全部满足时才算完成：

- 源码、测试和文档索引与本计划一致。
- UI 与 C1 的目标行为测试通过，架构规则没有新增违规。
- 完整门禁通过，或所有失败都有明确的环境证据且远程 CI 全绿。
- GitHub PR 已合并到 `main`，合并后的 commit 与 CI 记录可核对。
- 根工作区原有用户改动仍在，未被 stash、reset 或覆盖。

