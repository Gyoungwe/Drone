# Binary state 最小合同草案（待确认，未实现端口）

2026-10-28。供保留原 SQLite 文件格式的 Inquiry/WASM provider 使用；宿主没有 Inquiry/SQL 具名 handler。当前 process JSON wire 没有全局字节预算，本草案不新增全协议限制，不改变完整历史 projection。下列上限只属于 binary 端口。

## 权限与实际根

清单新增 `permissions.filesystem` tokens：`binary-state-read`、`binary-state-write`。后者只蕴含 binary read，不授予 JSON state、files、Node SQLite 或任意原始文件夹访问。scanner 派生 `requestsBinaryStateRead` / `requestsBinaryStateWrite` 并纳入 sameSource；来源、清单或内容变化照常撤销。

`PluginRuntimeResource.kind` / root grant 增加独立的 `binary-state`。实际 picker 新增 `binary-state` / `binary-state-write` 选择，只返回已批准的 canonical 目录/opaque handle。与现有 JSON state 分开登记存储 ID、访问模式和 grant；同路径也不互相转换 handle 权限。`roots.describe(null)` 仅返回本 activation 已批准的根及 read/read-write，不暴露全局登记表。

读写沿实际 caller.scope、根 scope、lifetime、source 与 path identity 检查；请求不接收 session/workspace/application 身份。`state.readJson/writeJson` 拒绝 binary handle；binary handler 拒绝 JSON/files handle。只读 binary 根不能 reserve 或写入。

复用 `state.reserve({root,path})`：增加允许已明确批准 binary write 的根，固定 `state-writers` + canonical directory；不新增 namespace 输入。`writeBinary` 必须验证本 activation 真正持有**目标文件的 exact canonical parent directory**租约；不以 ancestor lease 代替，避免与旧 writer 的目录键失配。需要确认实际 lease token 仍属于本 owner，不能仅相信插件 JSON 或曾调用 reserve 的标志。

## 精确 JSON 形状

所有对象 `additionalProperties:false`；操作名固定为 `state.readBinary`（read）和 `state.writeBinary`（write）。无 SQL、格式、迁移器或 caller 字段。

```ts
interface BinaryReadInput {
  root: string; // 非空 opaque handle
  path: string; // 1..4096 字符；root-relative regular file
}
type BinaryReadResult =
  | { kind: "missing"; version: null }
  | { kind: "value"; base64: string; version: string }; // 原 bytes 的 lowercase SHA256
interface BinaryWriteInput {
  root: string;
  path: string;
  base64: string;
  expectedVersion: string | null; // SHA256；null 只准创建不存在目标
  assertAbsent: string[]; // 必填，0..8 个唯一同根相对文件路径；不能包含目标自身
}
type BinaryWriteResult = { kind: "value"; base64: string; version: string };
```

`root` 最大 128 字符；version 只准 `^[a-f0-9]{64}$` 或声明的 null。所有 path 禁绝绝对路径、反斜线、NUL、空/dot/dotdot component、symlink 穿越；不存在的 parent 不自动建立。`assertAbsent` 不解释扩展名：Inquiry 自己提交 ledger 的 `-wal` / `-shm` / `-journal` 相对路径，宿主只检验同根缺失条件。

固定 `MAX_BINARY_BYTES = 4_194_304`，base64 schema `maxLength=5_592_408`，合法标准 alphabet/padding；解码前先限长，解码后核对 bytes 上限及重新编码相等，拒绝非 canonical 编码。读原文件先检查 regular-file identity/尺寸，最多读取 4 MiB + 1 字节，不无界 readFile；前后身份、尺寸/时间与 SHA 一并核对。超限明确报错，不截断、不改原库；较大 DB 支持保留未完成，不增加用户配置。

## 授权、提交与取消

- 写入逐次显示真实已选择目录、相对目标、actual caller 的 scope/creator、expected SHA、新 bytes 的 SHA/尺寸及 assertAbsent 条件。明确这是 opaque binary 内容，未展示逻辑 SQL 差异；provider 的领域操作仍走自己的 write 审批。纯 formatter 只读内部 actual facts，不发新 cap，不相信输入身份。
- 批准后重新核对实际 root/registry/scope/目录身份、exact writer lease、当前原 bytes SHA 和所有缺失条件。原子临时文件采用同目录唯一名和 0600；`expectedVersion:null` 用不覆盖创建，替换已有目标前最后复核 SHA/身份/缺失条件。提交后必须从原位置真实回读新 bytes/SHA，才返回 value。
- 取消在 atomic commit 前：停止写入并清理本次临时文件，原文件不变。取消或 readback 失败发生在 commit 后：不得声称“未写入”；完成本次已接受文件操作的 owned cleanup/目标回读，无新 state write 或替换 caller，返回明确 `EBINARYWRITEOUTCOMEUNKNOWN`，让新合法 caller 比对旧/候选 SHA 再 reconcile，禁止盲目重试。此 commit-point 语义需要本草案一并确认。
- cleanup 失败保留 writer lease 并让 owner drain 失败；不能先释放租约再报告失败。JSON metadata 仍走真正 JsonStore；SQLite raw bytes 不包成 JSON 文件，不改原格式。

## Inquiry 接管与恢复（领域职责，尚未实施）

只在用户显式选择原 `ledger.sqlite` 目录后绑定 canonical workspace，保留唯一原 projectId/schema；不取首个 root/meta row。旧 backend/native/第二 Desktop 的实际连接期必须持同 public Node lease；旧连接真正关闭后才交接。WAL/SHM/journal 存在则先拒绝接管，不把 main DB 当完整库。Node SQLite 不在普通 domain worker 重新开放；WASM 只处理内存 bytes。

首次写原库前，使用同一批准根建立 `ledger.sqlite.pre-plugin-<原SHA>.bak`（不存在才创建），回读 SHA 后才继续。已有同名备份须逐字节/SHA 匹配；不覆盖它。恢复需单独明确批准，以当前主库 SHA 为 CAS 前提，将已验证备份写回**原路径**并再次用 canonical SQL 回读；不得只恢复新目录副本而称原库恢复。领域持久 pending intent 记录旧/候选 SHA，取消后只能由新合法 caller reconcile，不能借旧调用扩权写 metadata。

## 必交门禁

实际 scanner/picker 拒绝隐式 JSON→binary 扩权；scope/source撤销、晚批准、unknown handle、path/inode/symlink、未持 exact lease、原 bytes CAS/sidecar变化与实际 writer 竞争；原子失败/取消前后 commit point/cleanup failure；接近 4 MiB 的 canonical SQLite 合成 DB 经真实 worker 读/写/回读，4 MiB+拒绝且原库不变；真实旧库 producer→WASM SQL→原路径回读、schema v1/v2/备份恢复与 Node 对照；最后实际 provider/consumer、SDK、UI和正式安装包复验。此文不把规划中的检查标为已通过。
