# 临时旧检查点的两阶段导入端口

公共类型 `e059e11f`，插件规范/清单门禁 `1642a07`；[机器回执](../releases/native-plugin-record-adoption-2026-10-28.json)。本片只关闭通用导入机制，不关闭 Core/Knowledge 的生产迁移器、权限 scrub、canonical provider、完整 managed owner 或 P4。

实际安装清单用 `drone.recordAdoptions` 声明精确 legacyType、迁移器支持的 fromVersions 与 removeBeforeVersion。声明从唯一 source scanner 解码并纳入 source 比较，禁止借此读取 plugin-record/plugin-notice namespace；删除版本到达即拒绝该声明。fromVersions 不是旧记录来源证明，结果 creator/packageVersion 始终 unknown。

Desktop 每个真实 source 的 capability factory 将声明传入内部 `getPluginSessionCapabilities(recordAdoptions?)`，handler 闭包绑定静态声明。没有扩大 RuntimeInternal 的 actual facts、caller context 或 broker ledger，没有新增 IPC。普通 seven session 能力不变，仅声明导入的来源多登记两个 write key；两项 model 能力仍独立按原声明门禁。

inspect 与 commit 每次分别走现有 write broker 批准，批准前说明具体旧 tag、目标 type、支持迁移器范围及未知旧来源/不授予权限的边界。inspect 只给实际当前 branch 最后候选；commit 在同 Backend-owned per-entry store 的串行事务内检查 id/hash 与无 own checkpoint，再保存 namespace 并真正读盘确认 durable，旧记录保留。hash 只是并发核对，不是 authority/provenance token；own checkpoint 本身是 once marker，不加第二份状态账本。

deferred 不给旧候选，不称 adopted；真实 append 错误进入原 needs-reopen，普通记录写和导入共享故障屏障。导入 JSON 不会设置 PermissionGate allowRun/always、选择模型或授予目录；生产迁移器仍必须严格验证当前实际 scope/字段，把旧 approved/roots/proof 作为不可信历史并重新获得当前 live 证明。

## 实际证据

协议 fixture 每次经过真实 npm pack、offline clean install、production scanner、受限 worker 与真实 Backend/SDK。provider/adoption **10/10** 包含：拒绝未批准读取/未声明来源；未知旧 creator/version；旧数据保留与新 namespace 回读；两个独立 write 批准；当前 branch/id/hash 变化与重复导入拒绝；lazy deferred 不建文件/不暴露候选；真实单调用取消后的晚批准不写；真实 SDK EISDIR 产生 phantom，导入不返回 adopted 且普通记录端口共同拒绝后续写。带 approved/roots/proof 的合成旧 JSON 没有设置执行许可，也没有额外模型调用。

连同 records/questions/models/native owner，5 文件 **38/38**；Desktop source/精确 session 与 model 门禁 **38/38**；插件 manifest checker **28/28**、10 包清单通过。backend/Desktop node TSC、API package check、arch 和定向 lint/diff 通过。

新 API 实际 tar 的 SHA256 为 `ed6121a22c9400a1a88b691b9852989db4b36659b1257d3895e836e753a72b2d`，在全新 prefix 仅 offline 安装该 tar、严格 NodeNext 编译新 provider/adoption DTO，并真实 import runtime 入口；未安装 SDK。路径及回执见机器记录。这是隔离类型候选，不替代主集成统一 API/Node execution 包或 npm 发布验证。

尚未标记通过：真实 Core/Knowledge 历史数据迁移与 scrub、导入后完整研究/任务工作流、正式安装包 GUI、合并后双仓库完整门禁。旧四项外部验收和 B8 不变。
