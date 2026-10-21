# Drone 项目协作规则

改动代码前先读 [`docs/INDEX.md`](docs/INDEX.md)，改动完成后检查索引是否仍然准确。架构升级规划见 [`docs/architecture-v2.md`](docs/architecture-v2.md) 和 [`docs/architecture-v2-tasks.md`](docs/architecture-v2-tasks.md)。私有发版流程见本机的 `.local/docs/release.md`。

## 硬约束

- renderer 绝不直接 import Pi 包，只经 preload 的 `window.pi` 通信。
- Pi SDK 运行时值 import 统一收敛在 `packages/backend/src/session-engine/**`（当前基线固定为 `@earendil-works/pi-ai` 与 `@earendil-works/pi-coding-agent` `1.1.0`）；`pi-backend.ts` 仍是兼容门面，迁移期间新增 import 必须遵守 `check:arch` 的 R1 白名单。
- 新增 IPC 要同步 `shared/src/ipc.ts`、`desktop/src/preload/index.ts`、对应 `main/ipc/` 文件和 backend；事件转发在 `main/ipc/index.ts`。
- preload 保持 CJS；新增 UI 文案同时更新 `i18n/zh.ts` 与 `i18n/en.ts`。
- Zustand selector 必须返回稳定引用；暴露给 UI 插件的 renderer API 要同步 host API、类型声明、构建 shim 和资源声明。
- JSON 持久化统一使用 backend `JsonStore`，保持原子写入和损坏处理语义。
- 不提交凭据、Vault 正文、会话正文、`results/` 或本机生成的私有状态。

## 分层规则（R1–R7）

- **R1**：Pi SDK 运行时 import 只能位于 backend 会话引擎或已登记的迁移白名单；其他层只能使用类型 import。
- **R2**：knowledge、tasks、research 领域包不得依赖 Electron、Pi SDK、backend 或 desktop。
- **R3**：renderer 的跨包依赖只能指向 `@drone/shared`；不得依赖 backend、Electron 或 Pi SDK。
- **R4**：禁止新增 `Symbol.for("drone.*")` 全局桥；迁移期基线只能减少。
- **R5**：禁止通过相对路径穿越包边界访问 `.pi/` 运行时文件。
- **R6**：领域包依赖方向保持单向：tasks 可使用 knowledge 的公开类型，research 可使用 knowledge；反向依赖禁止。
- **R7**：`@drone/compute` 只依赖 `@drone/shared` 与 Node 标准库；不得 import Electron、Pi SDK、backend、desktop 或其他领域包，宿主适配由组合根提供。

`node scripts/check-architecture.mjs` 会比较当前结果和已登记基线：新增违规会失败，已修复违规会提示更新基线。

## 编码尺度：不要过度防御

这个仓库已经有大量"以防万一"的代码（`packages/*/src` 里约 790 处空或近空的 `catch`，以及为"旧运行时 / 另一个模块副本 / 旧 worker"保留的兼容分支），它们掩盖真实错误、增加阅读和迁移成本。新代码按下面的尺度写，验收会逐条检查。

**只在信任边界校验。** 边界指：用户输入、模型输出、Vault / 网页 / 文件内容、IPC 入参、子进程与网络返回。边界以内的函数互相调用时，不重复校验参数，不对类型已经保证的值再判空、再 `typeof`。不确定数据形状时，去查调用方和类型定义，不要写成"两种形状都兼容"。

**错误默认往上抛。** 只有能说清"吞掉之后用户看到什么、为什么这是对的"时才 `catch`：
- 不新增空 `catch`；需要降级时，写明降级结果，用 logger 记录，并且只包住可能失败的那一行。
- 每种失败只在最靠近源头的一层处理一次，不在调用链每一层都 try/catch 或 fallback。
- 不要用默认值掩盖 bug：拿不到本该存在的数据就抛错，不要静默返回 `[]`、`null` 或 `"—"`。
- 改到已有的空 `catch` 时顺手收窄或删除，不要照着继续写。

**不写没有被要求的兼容层。** 兼容旧版本、旧数据格式、另一个模块副本的分支，只有在计划或用户明确要求、并且能写出具体版本号时才写；同时在注释里写明删除条件（例如"pi-knowledge 0.3 之后删除"）。迁移完成就删掉旧路径，不保留"以防万一"的回退。

**不加没被要求的东西。** 包括配置项、开关、重试、超时、缓存、特性标志、抽象层、"未来可能用到"的参数。确实需要一个值时，先写死一个合理的默认值。

**测试测行为，不测防御。** 不为了覆盖防御分支去构造实际不可能出现的输入。

**交付前自检。** 删掉本次新增、删除后测试仍全过且行为不变的代码（多余的 guard、未使用的参数、重复的校验）。如果 diff 里新增的 `try/catch`、`?? 默认值`、`typeof` / `Array.isArray` 检查超过 5 处，在提交说明里逐条写理由。

**这些不属于过度防御，必须保留：** 外部写入 / 删除 / 发布前的授权与写后回读；路径必须留在 Vault 或工作区内的检查；发布门禁与证据回执；持久化 JSON 的原子写入；绝不在失败时报告成功。宁可大声失败，也不要安静地出错。

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

## 计划与验收红线

- 计划中标为“暂缓”或“按用户要求暂不实施”的条目不得修改，也不得为其新增基础代码；当前 B8 云端协作属于此类条目。
- 执行日志超过 30 行时，先将旧记录归档到 `docs/archive/`，正文只保留最近 30 行并附归档链接。
- 只有真实启动的会话或真实安装包提供的证据才能标记为 PASS；仅 loader 单独加载、fixture 或开发版截图不得作为最终 PASS。
