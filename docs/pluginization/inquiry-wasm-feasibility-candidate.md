# Inquiry 内存 SQLite 可行性候选

2026-10-28。纯调查与临时授权目录内测试；未改变正式数据库、工作区依赖、发行锁或 binary ports。Node SQLite resource 方案暂停，见[防御范围](node-sqlite-worker-defense.md)。

## 结论

`sql.js@1.15.2` 可作为后继实现候选：官方说明其 SQLite 在内存虚拟文件中运行，可导入现有 SQLite 文件字节，并导出 SQLite typed-array 文件；需要宿主另行持久化。其 WASM/JS 为 MIT，SQLite 为 public domain，见[官方项目说明](https://github.com/sql-js/sql.js)。这允许普通 domain worker 继续禁用 `node:sqlite`，同时复用领域 SQL 与原 `ledger.sqlite` 格式，避免为 Inquiry 放宽 Node SQLite 权限。**这是可行性证据，不是 Inquiry 迁移或完整隔离/性能验收。**

## 本机小样

只使用 `/private/tmp/drone-inquiry-wasm-NHTY8C` 的合成数据。实际 staged Node **26.12.1** 执行；WASM 阶段同时设置 `--permission --no-experimental-sqlite` 和该临时目录的 read/write grant。没有目录外访问或绕过验证。

1. 从当前 `packages/inquiry/src/storage.ts` 构建临时 bundle，用真正 `SqliteInquiryStorage` 生成 schema v2 的 61,440 字节旧格式数据库，写一条合成 question，关闭并确认无 WAL/SHM。
2. 记录并重放该 canonical storage 真正发出的 **32 条 SQL 调用**，比较 **22 次 get/all 结果**；SQLite schema、事务、upsert 和 revision SQL 在内存 WASM 中匹配。
3. 将原 DB 字节导入 WASM，使用同一 canonical upsert/revision SQL 更新合成 question；`quick_check=ok`，导出仍为 `SQLite format 3` 文件，原文件 SHA 保持不变。
4. 真正 Node canonical `SqliteInquiryStorage` 再打开导出副本，验证相同 project/schema、更新记录及六个 collection 可读。未将候选副本替换正式或原始测试库；未声称 binary CAS 已实现。

WASM 引擎版本、字节数和检查结果见 `/tmp/discovery-inquiry-wasm-memory-final.log`；canonical seed/reopen 分别为 `/tmp/discovery-inquiry-wasm-seed.log` 与 `/tmp/discovery-inquiry-wasm-reopen-final.log`。loader 47,441 字节，WASM 685,235 字节，独立 asset 约 716 KiB；未加入仓库依赖。

| 临时 artifact | SHA256 |
| --- | --- |
| `sql-wasm.js` | `b46d4bddfdde8a787fc4764bd0a405cdfdf96fbd77e6a4e95446106826ecfa47` |
| `sql-wasm.wasm` | `0dfeecda2070b36da0cd4f6afa250af9453de528a983770f85b13d5d6b667572` |
| canonical 原库 | `42393dcd58b5c21b25c0c4054fc6d23ef5691d9fb9b7aa41c7e9c63372dcf191` |
| WASM 导出/Node 回读副本 | `b3858fcec11f121d581799fcba97bbfdbf04a555a66c1eaadf52719c7325f056` |

最初 `/tmp` alias 的 permission 命令因父路径 realpath 被拒绝；改用 canonical `/private/tmp` 后通过。一次早期重开失败留下的合成副本 WAL 使重用该副本时不能取得预期记录；最终使用新副本路径并正常关闭后通过。这些失败日志保留，说明原库接管不能忽略未关闭的 WAL。未对真实旧库进行恢复操作。

## 后继实现边界（尚待审查）

独立 `pi-inquiry` 提供 `inquiry.runtime` v1；Discovery 仅经 `requires` alias 消费。先把实际 canonical SQL/领域验证纯结构迁入插件，提取最小内部 `exec/prepare/get/all/run` connection 端口，再写 sql.js adapter；不要复制第二份 SQL。每次事务从已提交快照开始，完成后导出候选 bytes；活的实际 write caller 批准 generic binary CAS 后才更新原路径及内存已提交版本。拒绝、取消、CAS 失败则丢弃未提交内存候选；不能让后续读看见未提交变更。

原目录绑定、原 projectId/schema、旧 writer/native/第二进程同协议租约、关闭 WAL、首次备份/原位恢复、逐次写后回读，以及 compute/task/decision/local-execution/lineage/rerun/UI/IPC 全部功能仍须保留。此前[原 SQLite 方案](inquiry-sqlite-provider-design-candidate.md)中的 generic binary 授权/CAS/sidecar 缺失条件继续需要精确 schema 审查，尚未获准实施。

仍需验证：schema v1→v2 及所有领域/SQL 用例；较大数据库的双份内存与导出成本、最大接纳尺寸；WASM asset 随正式安装包读取与 Windows/Linux；损坏/中止/外部 CAS 修改/租约竞争与备份恢复；实际 provider/consumer、SDK 和 GUI。来自插件的 JSON 执行声明不得自动冒充宿主 verified execution receipt，跨 provider 的真实 provenance 必须在合同中保留可核对的来源，而不是借本调查标记通过。
