# 半迁移胶水退役计划

状态：计划，未开工。基线 `origin/main` @ `927d3d0f`。执行按 [drone-slimming](../.agents/skills/drone-slimming/SKILL.md) 与 AGENTS 反膨胀红线；每批独立 PR，纯瘦身用 `node scripts/check-bloat.mjs --require-net-decrease` 验证业务净减。

## 1. 四类胶水与根因

| 类别 | 基线分布 | 根因 |
|---|---|---|
| 双轨 IPC | 新轨 `shared/src/host-api/*.ts` 已按域拆分（21 个域文件）；旧轨 `shared/src/ipc.ts`（728 行）仍汇总通道常量、`PiApi` 与跨域类型 | 新旧契约未切流，改一次接口两头同步 |
| Barrel 重导出与遮蔽 | `shared/src/index.ts`、`shared/src/knowledge.ts`（641 行）重导出 `@gyoungwe/plugin-api/knowledge`，由 `barrel-shadowing.test.ts` 锁遮蔽；`shared/src` 下 9 个 `research-*.ts` | 历史兼容导出未下线，契约所有权分裂 |
| 阶段性兼容与冻结子包 | `plugin-api/src/legacy-knowledge.ts` 与 5 个 `p5-*.ts`；`desktop/src/main/optional-plugin-hosts.ts`、`legacy-migration.ts`；冻结包 `packages/{research,discovery,inquiry,extensions}` | 外部 drone-plugins 已接管，旧包与过渡缝未按「切流即退役」退场 |
| 1 对 1 透传门面/端口 | `backend/src/pi-backend.ts`（已是 8 行 `@deprecated` 重导出）、`backend/src/session-service-port.ts`、`backend/src/research-host.ts` 与 `extensions/src/internal/research-host.ts`、`discovery/src/inquiry-port.ts`、`research/src/write-connectors.ts` | 预防性 Port/Adapter 只有一个实现 |

## 2. 执行顺序

顺序固定为「静态扫描砍死代码 → AST 批量改写引用 → 按域整块切流退役 → 护栏防反弹」。每步脚本化、小步提交；一次性改写脚本放 PR 描述或临时目录，不入库。

### 步骤 1：Knip 扫死代码（低风险，先做）

- 根目录接入 Knip（原生支持 npm workspaces），入口设为 `packages/desktop` 的 main/preload/renderer 与 `packages/backend`，跑全仓模块图。
- 重点收割 `shared/src/research-*.ts`、旧类型别名、失效 helper、冗余依赖。
- **约束：** 新增 devDependency 需在 PR 里说明并获批准；`knip --fix` 只用于报告确认后的批量删除，不直接对全仓执行。动态入口（插件清单、`registerCommand`、字符串 import、`bin`/`exports`、CLI 子命令、preload/IPC 注册）和 AGENTS 清理禁区内的命中标 `RISKY`，人工核对后再删。

### 步骤 2：ts-morph 解包 Barrel，消灭遮蔽

- 一次性 ts-morph 脚本（约 50 行）：遍历从 `@drone/shared` 导入、真实声明在 `@gyoungwe/plugin-api` 的符号，按类型符号表追溯声明并改写 import 路径。
- R3 只允许 renderer / lan-web 依赖 `@drone/shared`：只保留 renderer 实际消费的纯 DTO 类型，删掉其余透传导出。
- 完成后删 `shared/src/knowledge.ts` 中的镜像部分与 `barrel-shadowing.test.ts`；宿主独有的知识/研究运行契约按 owner 留在 shared 或迁回插件。

### 步骤 3：ast-grep 把 `ipc.ts` 收口进 `host-api/`

- 用 ast-grep 对旧通道常量和旧 `PiApi` 调用模式做结构化替换，按域把类型与通道迁入 `shared/src/host-api/<domain>.ts`。
- 每清完一个域：从 `ipc.ts` 删对应块，跑 `npm run typecheck -w packages/shared`、`npm run typecheck -w packages/desktop` 与 `npm run test:preload`。
- IPC 改动仍按硬约束同步 shared、preload、`main/ipc/`、backend 与事件转发；`ipc.ts` 清空后删除文件并更新 INDEX。

### 步骤 4：内联单实现 Port/Facade，退役冻结子包

- 用 ts-morph 统计 `*Port`、`*Adapter`、`*Host` 接口的实现数与纯透传方法：只有 1 个实现且不跨外部插件边界的，内联调用方并删接口文件。`pi-backend.ts` 在消费者改用 `SessionService` 后直接删除。
- 对照 drone-plugins 接管清单，按依赖拓扑从叶子包往回整包移除 `packages/inquiry`、`packages/discovery`、`packages/research`、`packages/extensions`；同一 PR 删 `optional-plugin-hosts.ts`、`legacy-knowledge.ts` 与 5 个 `p5-*.ts`。
- **按领域分 PR，切流即删。** 每个 PR 先证明替代入口、授权与写后回读，再删旧实现；不留双 writer 或 fallback。
- **公开合同：** `@gyoungwe/plugin-api`（当前 1.3.0）已发布。删除公开导出属破坏性变更，必须先核对 drone-plugins 与 `**/plugin.manifest.json` 消费者，并纳入下一破坏性版本；本计划不发布 npm、不打 tag。

### 步骤 5：护栏防反弹

在现有 `.githooks/pre-commit`（`check-bloat`/`check-staged`/`check-structure`）、`check:arch` 与 `test:arch` 中加断言：

- `shared/src` 禁止新增 `export * from` 指向 `@gyoungwe/plugin-api` 或其他包的 barrel；
- 禁止新增 `legacy-*`、`p5-*` 文件名，存量只减不增（基线登记，同 R4 棘轮）；
- `ipc.ts` 行数棘轮只降不升，直到删除；
- Knip 以 `--no-exit-code` 报告形式进 CI，或仅对新增文件严格检查。

## 3. 验收

- 每批：就近 typecheck/test，纯瘦身批次 `check-bloat --require-net-decrease` 通过；回执写业务 `+X/-Y/净 -Z`，测试、文档、生成物分列。
- 每个 PR：`npm run lint && npm run typecheck && npm test && npm run build && npm run check:arch`。
- 退役冻结包：干净检出构建 + 实际安装包冒烟，才可标 PASS。

## 4. 胶水清完后再评估的升级

只在上述清理完成、体积明显下降后单独立项，每项都需要具体触发条件：

| 项 | 方向 | 触发条件 |
|---|---|---|
| 工程化 | npm workspaces + `patch-package` → pnpm + Turborepo | 装包、补丁或多包构建缓存成为可测瓶颈 |
| 本地存储 | `JsonStore` → `node:sqlite` + Drizzle ORM | 会话或文献检索实测出现 I/O 或查询瓶颈；迁移保持原子写入与损坏处理语义 |
| 前端瘦身 | `marked` / `markstream-react` / `stream-markdown` 收口为 1 套；再视内存决定 Monaco → CodeMirror 6 | Markdown 收口可直接做；编辑器替换需先有内存占用数据 |
