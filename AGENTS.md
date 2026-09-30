# Drone 项目协作规则

改动代码前先读 [`docs/INDEX.md`](docs/INDEX.md)，改动完成后检查索引是否仍然准确。架构升级规划见 [`docs/architecture-v2.md`](docs/architecture-v2.md) 和 [`docs/architecture-v2-tasks.md`](docs/architecture-v2-tasks.md)。私有发版流程见本机的 `.local/docs/release.md`。

## 硬约束

- renderer 绝不直接 import Pi 包，只经 preload 的 `window.pi` 通信。
- `packages/backend/src/pi-backend.ts` 是当前 Pi SDK 运行时 import 的唯一集中位置（版本固定为 0.84.3）；架构 v2 迁移期间新增 import 必须遵守 `check:arch` 的 R1 白名单。
- 新增 IPC 要同步 `shared/src/ipc.ts`、`desktop/src/preload/index.ts`、对应 `main/ipc/` 文件和 backend；事件转发在 `main/ipc/index.ts`。
- preload 保持 CJS；新增 UI 文案同时更新 `i18n/zh.ts` 与 `i18n/en.ts`。
- Zustand selector 必须返回稳定引用；暴露给 UI 插件的 renderer API 要同步 host API、类型声明、构建 shim 和资源声明。
- JSON 持久化统一使用 backend `JsonStore`，保持原子写入和损坏处理语义。
- 不提交凭据、Vault 正文、会话正文、`results/` 或本机生成的私有状态。

## 分层规则（R1–R6）

- **R1**：Pi SDK 运行时 import 只能位于 backend 会话引擎或已登记的迁移白名单；其他层只能使用类型 import。
- **R2**：knowledge、tasks、research 领域包不得依赖 Electron、Pi SDK、backend 或 desktop。
- **R3**：renderer 与 lan-web 的跨包依赖只能指向 `@drone/shared`；它们不得依赖 backend、Electron 或 Pi SDK。
- **R4**：禁止新增 `Symbol.for("drone.*")` 全局桥；迁移期基线只能减少。
- **R5**：禁止通过相对路径穿越包边界访问 `.pi/` 运行时文件。
- **R6**：领域包依赖方向保持单向：tasks 可使用 knowledge 的公开类型，research 可使用 knowledge；反向依赖禁止。

`node scripts/check-architecture.mjs` 会比较当前结果和已登记基线：新增违规会失败，已修复违规会提示更新基线。

## 常用命令

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run check:arch
npm run build
```

涉及升级验收时，再运行 `npm run test:upgrade`；需要真实 SDK 冒烟时使用 `scripts/` 下相应脚本，并遵守其凭证隔离说明。

## 完成标准

提交前应运行与改动相关的检查；完整 PR 的完成标准是 `npm run lint && npm run typecheck && npm test && npm run build && npm run check:arch` 全部通过。纯结构改动与行为改动分开提交，文件职责或位置变化同步更新 `docs/INDEX.md`，新坑记录到 `docs/PITFALLS.md`。
