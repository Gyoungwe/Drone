# Drone 状态链修复设计

## 背景

五轮 Drone UI 回归发现，当前实现把工作区文件、Vault 笔记和研究运行来源混用为路径字符串；任务验收、研究运行收束、Wiki 审核和短命令各自保存了一部分状态。因此会出现验收文件已存在但任务仍 `reconcile-before-retry`、运行已可回答但元数据仍 `running`、Wiki 候选已写入但审核列表为空、状态命令没有可见审计回合等问题。

当前工作区从领先提交 `068c541`（`origin/docs/architecture-v2`）继续。本设计保留现有领域包分层和 Pi/preload seam，不回退该提交，不把测试归档或用户 Vault 内容提交到仓库。

## 目标与非目标

目标是让宿主事实成为任务状态、研究运行和 Wiki 审核的单一来源：

1. 文件验收和 reconcile 使用带根类型的真实产物身份，能区分 workspace、Vault 和 research run。
2. 研究运行只有在结构化主张、来源回执和来源哈希都满足时才进入 `answerable`；finalize 同步更新运行元数据和八节点。
3. Wiki 候选保存、审核队列、人工收下和撤销使用同一个可查询状态链，候选正文不重复宿主元数据。
4. `/task-status` 和 `/task-action` 产生可见的宿主审计事件；阶段和总步数从宿主账本读取，动作不会隐式授予权限或清除能力检查点。
5. 为上述行为补充领域单测、运行时单测和已有架构回归，不改动已正确的开场路由卡语义。

不在本次范围内：重写任务状态机、修改 renderer 与 preload 的通信方向、自动收下 Wiki、写 Zotero、改变研究技能分类器的开场判定、实现尚未有宿主夹具的 48/192 步完整 UI 回归。

## 设计

### 1. 产物身份与验收

在 tasks 领域定义小的 `ArtifactIdentity` 接口，包含 `rootKind`（`workspace`、`vault`、`research-run`）、规范化相对路径、真实绝对路径、字节数、SHA-256 和观察时间。验收注册表仍按 kind 选择 verifier，但 verifier 返回统一身份；workspace 相对路径只在 workspace 根解析，Vault-relative 路径只交给 Vault adapter，不能使用 `resolve(cwd, path)` 跨根猜测。

`acceptFile`、`reconcile` 和 task status 使用同一 identity。结果不明时保留 operation id；reconcile 必须读取现有 receipt 并重新观察 identity，只有匹配验收契约才转为 completed，否则继续 blocked 并说明下一动作。

### 2. 研究 finalize

研究运行的 finalize 先读取 metadata、evidence gate、claim bindings 和 source receipts。每个可回答主张都必须至少有一个与本运行来源 manifest 对应的来源路径和稳定哈希。校验成功后以一次原子 metadata 写入同时更新 `status`、`provenance`、`evidence_gate` 和八节点投影；校验失败时保持 evidence gate，禁止 `answerable` 和总结工具通过。

节点区分“已执行”“待记录”和“跳过”，不因前置节点完成就伪装成已执行。覆盖率为“待记录”是事实记录，不作为失败理由。

### 3. Wiki review registry

`stageWikiProposal` 只负责生成并持久化 pending proposal。无论 review mode 如何，候选都会在与当前 vault/project binding 相同的 review registry 中产生记录。自动保存只能改变写入状态，不能改变 `humanReviewed=false`；审核面板读取同一 registry。

候选正文通过结构化内容函数生成：宿主负责 frontmatter、标题和 managed block，用户 markdown 只作为 block 正文。人工收下和撤销继续使用 proposal hash 与目标文件 hash 的并发检查，并分别记录 `candidate-saved`、`queued`、`accepted`、`revoked` 或 `stale`。

### 4. 任务命令和计数

任务运行时把 status/action 当作控制事件写入同一 task journal 和会话事件流。`/task-status` 是只读查询，不增加预算、不改变阶段、不建新任务；`/task-action` 必须有合法动作或返回“缺少动作”，不能以空动作清除 capability checkpoint，也不能授予权限。宿主返回的 `stageCalls`、`totalCalls`、`autoResumes` 是唯一计数来源。

开场 route card 保持不可变；后续 capability load 只追加 task checkpoint。继续、任务选择、binding changed、session restored 和 unknown operation 由现有状态机处理，不通过普通自然语言回路重建任务。

## 测试策略

- 在 tasks 中测试 workspace/Vault/run 三根解析、hash mismatch、unknown operation reconcile 和 status/action journal。
- 在 research 中测试空 sources 阻止 answerable、有效 source receipt 原子 finalize、metadata/provenance/八节点一致性。
- 在 knowledge 中测试 automatic save 仍入 review registry、不同 binding 不可见、managed block 不重复 frontmatter、hash-safe revoke。
- 在 backend/runtime 中测试控制事件只读行为、计数来源和 capability checkpoint 保留。
- 运行现有 `npm test`、`npm run typecheck`、`npm run check:arch`、相关 runtime build/check；变更后重新检查 `docs/INDEX.md`。

## 交付顺序

先修改领域接口和单测，再修改 runtime adapters 和生成产物，最后运行全套相关检查。每一批保持可回滚；不提交 `results/`、Vault 正文、会话正文或本机状态。领先提交的内容作为父提交保留在新分支中。
