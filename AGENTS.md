# Drone 协作规则

改代码前读 [项目索引](docs/INDEX.md)。插件改动用 [drone-plugin-dev](.agents/skills/drone-plugin-dev/SKILL.md)，双仓用 [drone-maintenance](.agents/skills/drone-maintenance/SKILL.md)，删旧轨/合包/拆大文件用 [drone-slimming](.agents/skills/drone-slimming/SKILL.md)。详细约束见 [维护红线](.agents/skills/drone-maintenance/references/red-lines.md)。

## 反膨胀红线（必须遵守）

1. **唯一契约所有者。** 领域 schema、验证和 UI 状态归对应插件。`plugin-api` / `shared` 不新增业务镜像；宿主保留通用传输和必要的宿主机制。renderer 只依赖 `@drone/shared`，不直接导入领域插件；已公开旧导出按迁移计划兼容到下一破坏性版本。
2. **切流即退役。** 先验证替代入口、权限和回读；切流 PR 同步移除被替代的实现、IPC、store 或导出，不留未批准的 fallback。纯瘦身、迁出与重构用 `node scripts/check-bloat.mjs --require-net-decrease` 验证业务净行数小于零，测试、文档和生成物不计入。
3. **体积预算。** 新业务文件 ≤350 行。保留 400 行结构棘轮；超过 500 行或列入防膨胀名单的文件只减不增。旧领域包冻结，不新增文件；源码 `src/` 不新增 `.mjs` 或手写 `.d.mts`。不新建不足千行业务代码的微包，先看现有 owner 能否承接。
4. **不堆过程物。** 新 `docs/` 文件 ≤12 KiB；盘点、截图和门禁日志留在 PR，不新增过程记录。正式发版归档需明确授权。不要新增 Git 追踪的构建产物，也不跨仓复制 `SKILL.md`；已有交付产物按棘轮和独立提交规则处理，切流前不直接移除。
5. **研究路径控制 token。** 常驻 `SKILL.md` 新增索引 ≤3 KiB，旧长文只减不增；细节按需读。只读局部查询走快路径，深研必须设预算及明确停止条件；省 token 不得跳过审批、证据核对或写后回读。
6. **不留半迁移胶水。** 按[胶水退役计划](docs/glue-retirement-plan.md)推进。新接口只进 `shared/src/host-api/<domain>.ts`，旧 `shared/src/ipc.ts` 只删不增。`shared/src` 不新增指向其他包的 `export *` 重导出或遮蔽层，也不新增 `legacy-*` 文件；已有遮蔽（#429/#430）兼容到下一破坏性版本。`p5-*` 是进行中的 P5 模块，不算胶水。只有一个实现且不跨插件边界的 Port/Adapter/Facade 不新建，改为直接调用。冻结包（research/discovery/inquiry/extensions）先切流，包外引用清零后才整块退役。Knip 等扫描结果只作线索，动态入口须先核对消费者。删除 `plugin-api` 公开导出须纳入破坏性版本。

## 架构与安全

- **R1–R3：** Pi SDK 运行时值限 backend `session-engine/**` 及登记迁移白名单；其他地方仅用类型。领域包不依赖 Electron/Pi SDK/backend/desktop；renderer 经 CJS preload 的 `window.pi` 通信。当前 Pi SDK 基线 `1.1.0`。
- **R4–R7：** 不新增 `Symbol.for("drone.*")` 或跨包相对路径读取 `.pi/`；tasks → knowledge、research → knowledge 单向；`@drone/compute` 仅依赖 `@drone/shared` 和 Node，IO 由组合根注入。
- IPC 同步 shared、preload、main、backend 和事件转发；中英文案同时改；Zustand selector 返回稳定引用；插件 renderer API 同步类型、shim 和资源声明。
- 授权、Vault/工作区路径隔离、写后回读、JsonStore 原子持久化与损坏处理不可省。不提交凭据、Vault 正文、会话正文、`results/` 或本地私有状态。不碰 B8 等暂缓项，不发布 npm、不打 tag。

## 实施与验收

- 先复用已有实现并写能失败的行为测试，再小步改动。依赖公开接口，按单一职责分层，纯逻辑不读全局；用组合而非继承。只在信任边界校验，错误默认上抛，不加空 `catch`、猜测性回退、无需求开关或重试。
- 不新增模块级 `let`、自写继承、`any`、双重断言、非空断言、跳过或拉长测试；函数 ≤60 行。结构与行为改动分开，非平凡 diff 提交前用 code-simplifier 复核。生成物不与源码混提。
- **代码分析工具（根 devDependencies，`npm ci` 后可直接调用，不另装、不升级）：** 删代码、改引用或收口契约前，按需自行调用并在回执写出命令与命中数。`npm run knip -- --workspace <包路径>` 找未用文件/导出/依赖，配置在 `knip.ts`；`npx ast-grep run -l ts -p '<模式>' <路径>` 做结构化查找，确认命中后才加 `-r` 改写；ts-morph 用于按类型符号追溯声明、改写 import，一次性脚本放 `.local/codemods/*.mjs`（已忽略、能解析依赖）用 `node` 运行，不入库。三者结果只是线索：动态入口、清理禁区和公开合同须人工核对；ts-morph 的 `getImplementations()` 不计对象字面量实现，须配合 `findReferences()`。
- 完整 PR：`npm run lint && npm run typecheck && npm test && npm run build && npm run check:arch`。已有棘轮基线只降不升；仅原样搬动才经解释使用 `--allow-moves`。更新索引和必要的 `PITFALLS.md` 条目。
- 只有真实会话或实际安装包运行证据能标 PASS。涉及升级加 `npm run test:upgrade`；真实 SDK 冒烟遵守凭证隔离。执行日志超过 30 行时归档旧记录并保留链接。
