# Inquiry SQLite provider 候选：保持原库，等待端口审查

2026-10-28；设计调查，尚未实现。目标为独立、可卸载的 `pi-inquiry`，提供 `inquiry.runtime` v1；Discovery 只通过已实现的 `requires` alias 与 `provider.read/write` 消费。不得把新 JSON 库或旧库只读展示称为迁移完成。

## 选择

| 方案 | 原数据与能力 | 隔离边界 | 结论 |
| --- | --- | --- | --- |
| worker 直接写已选择原目录的 SQLite | 保留原格式；打开连接时可能产生 WAL/SHM | 扩大 domain worker 的直接 FS 权限；SQLite 写绕过逐次宿主批准 | 不采用 |
| 新 JSON ledger，旧 SQLite 只读 | 数据位置/格式改变，既有原库写入功能失去 | 可用现有 JSON ports | 不符合已批准设计 |
| 现有 resource 子进程 + 私有 SQLite 工作副本 + 原文件二进制 CAS | canonical SQL/schema 与原 `ledger.sqlite` 位置保留；原库只在真正批准后原子替换 | resource 只能写私有 cache；原库字节由 generic host port 读/批准/CAS/回读 | 推荐，端口待批准 |

## 原库与事务

1. UI 明确选择现有项目 `ledger.sqlite` 所在目录并绑定 actual caller.scope 的 canonical workspace；不选首个根，不复制到新用户数据根。插件读取全部 `inquiry_meta` 验证唯一 projectId；空/混合/冲突记录不能取 `LIMIT 1` 冒认。已有唯一旧 projectId 保留；新库使用插件自己的绑定元数据。
2. 先取得现有 public Node `state-writers`/canonical-directory 租约。旧 backend SQLite writer 必须使用同一协议，在连接存在期间持有租约，真正关闭后才释放；native 与第二 Desktop 进程竞争同租约。接管前必须证明旧连接关闭、原库没有 WAL/SHM/journal 待恢复，不能只复制 main DB 而丢 WAL。
3. resource 每次接受当前已提交 DB bytes 与领域 JSON 操作，向自己私有目录创建请求专属工作副本。真实搬迁 `@drone/inquiry` 的领域/SQL实现，保留 schema、约束与既有 migration；每次完成后 checkpoint/关闭数据库，再验证工作副本 `quick_check` 与业务回读。工作副本和辅助文件清理完才返回候选 bytes/JSON 结果。读请求不提交迁移；写请求的 schema 升级也属于需要批准的真实写入。
4. domain owner 在活的实际 write caller 下调用 generic 二进制 CAS，保留原 `ledger.sqlite` 路径。CAS 失败、拒绝或取消则原文件不变；不保留能被下一读误认为已提交的工作副本。成功后从原位置回读 SHA 和业务记录再交完成回执。原始数据库需通过现有正式备份/回滚机制保留；不能覆盖失败后宣称回滚成功。
5. 私有 cache 关闭失败保留原目录 writer lease，返回 recovery；取消后只有 resource 自身清理权，不新发原库写 capability。原库提交只归活的 actual caller，跨会话/工作区/来源不得复用。

## 最小 generic 端口候选

增加 `state.readBinary` 与 `state.writeBinary`（均无 SQLite/Inquiry 名称）。JSON 合同使用 base64 bytes、原字节 SHA256 version、相对路径；固定有界 payload。写入需要已批准的 binary-state 根与本 activation 实际持有的目录 writer lease，显示真实目录/目标、旧/新 hash 与字节数。只做 no-symlink regular-file 检查、原子临时文件/CAS替换和写后回读，不解释 SQL，不接受 session/workspace 身份 JSON。

二进制授权不能偷偷扩大现有“状态 JSON”授权：清单需新增明确的 binary read/write 声明，scanner/sameSource 和 picker 文案同步；具体 token/schema 在实施前单独审查。为 SQLite 原文件替换，generic CAS 还需可说明的同根 `assertAbsent` 条件，确保提交时 WAL/SHM/journal 仍不存在；业务只在插件给出这些相对路径，宿主不写 SQLite 文件名规则。合作 writer 均由租约排他；不声称可以锁住绕过协议的外部恶意写者，外部变化必须由 CAS/回读显式失败。

## 必交证据

- 从真实旧 backend writer 生成临时原库与当前/旧 schema，关闭后保存原字节 hash；actual installed provider/resource 接管，并在原路径读/写/回读，退出后原 canonical SQLite 实现重新打开验证全表。
- 实际第二 Desktop/native Node 进程和旧 backend writer 的租约竞争；接管关闭/重启只允许一个 writer；WAL 未关闭、外部 CAS 修改、损坏/混合 project/schema、取消与 resource cleanup failure 均不能报告成功。
- 实际 Discovery consumer→generic provider→canonical Inquiry SQL→原库回读；actual SDK 与 installed UI 同 owner/creator隔离；停用/恢复/卸载；原库备份恢复与写后回读。
- 完整功能清单还包括 compute/task/local-execution/decision 事件、artifact lineage/provenance/rerun、既有 Inquiry UI/IPC 逐项迁移；这些入口仍在宿主，不能仅凭 Discovery 写入关闭 Inquiry 或 P5。
