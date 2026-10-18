# A5 领域包收敛：收益与剩余工作

更新时间：2026-10-18

A5 的目标是把知识、任务、研究三类核心能力从无类型的 `.pi/lib/*.mjs` 运行时，收敛为有类型的 workspace 领域包，再让 Pi 扩展只做参数映射和注册。它不会新增一个独立产品页面，主要提升的是稳定性、可测试性、Pi/Desktop 一致性和后续维护成本。

## 为什么值得做

架构 v2 的实测基线有 75 个 `.pi/lib`/`.pi/extensions` 无类型文件、约 20k 行运行时代码、55 个后端测试直接 import `.pi/lib`，以及 10 个 `Symbol.for("drone.*")` 全局桥。当前 v1.1 已经通过公开插件边界缓解了这些问题，但 A5 仍保留兼容适配层。

完成 A5 后，收益主要是：

- 编译器能检查领域边界，知识、授权、证据和来源回执的错误更早暴露。
- Pi CLI、Desktop 和插件使用同一份领域实现，减少“桌面通过、原生 Pi 失败”的分叉。
- worker、队列、文件路径和宿主生命周期由组合根显式注入，测试可以隔离多个实例。
- 扩展只负责注册和参数转换，升级 Pi 或调整 Desktop IPC 时不需要复制领域逻辑。
- 最终可以移除不再需要的 `.pi/lib` 运行时资源和 legacy extension outputs，减少打包路径、相对导入和资源漂移问题。

## 四个子目标分别带来什么

| 子目标 | 要收敛的边界 | 使用者能间接感受到的提升 | 当前状态 |
| --- | --- | --- | --- |
| **A5-1 knowledge** | Vault 文件安全、布局、检索、topic memory、Wiki/review、worker 和 specialist host | 知识沉淀更稳定；路径、软链接、哈希、来源新鲜度和 worker 失败更容易得到明确错误；跨会话复用更一致 | **已完成**：生产扩展与 worker 只使用 `@drone/knowledge` / package-owned 产物，`.pi/lib/knowledge` 已删除 |
| **A5-2 tasks** | 一次授权、task workbench、进度、失败反馈、验收器、PDF worker 和 runtime bridge | 授权语义、进度卡、失败原因和继续执行行为一致；Pi 与 Desktop 不再各自维护一套 task runtime | **已完成**：`@drone/tasks` 与 `pi-core` 独占 task runtime，`.pi/lib/tasks` 已删除 |
| **A5-3 research** | 来源归档、开放获取、Zotero、机构访问、literature operations、provenance 和 receipt journal | 文献来源、版本、引用和写入回执更可追溯；更容易把同一研究流程接到 Pi、Desktop 和未来连接器 | **已完成**：research host ports 使用领域包类型合同，旧 CLI/宿主兼容入口已删除 |
| **A5-4 extensions** | `.pi/extensions` 的入口、参数映射、Pi 注册和构建产物 | 安装、升级和跨平台打包更少依赖相对路径；扩展失败时更容易隔离，核心宿主有稳定回退 | **已完成**：TypeScript 源入口、自包含构建、manifest 资源路径和 Desktop extraResources 已统一，`.pi/lib` 不再打包 |

## 当前完成度怎么理解

- **A5-0 已完成**：扩展构建管线、生成 manifest 和产物漂移检查已经存在。
- **A5-1～A5-3 已完成**：核心逻辑、worker、host ports 和运行时均归属 TypeScript 领域包，旧 CLI/打包兼容入口已删除。
- **A5-4 已完成**：扩展源码、生成 manifest、Desktop 资源路径和 CLI/Pi 产物均通过同一套 package-owned 运行时。
- **现有 v1.1 发布门槛不依赖 A5 完成**：公开插件、Pi 1.1.0/latest、桌面构建产物、视觉对照和连接器门禁已经关闭。A5 是发布后的架构收敛工作。

## 建议顺序

1. **A5-1 knowledge**：先迁移生产 import 和 worker/host 生命周期，保留一个可回滚的兼容开关；用 knowledge 回归、跨实例 memory、语义 benchmark 和桌面构建验收。
2. **A5-2 tasks**：再迁移 task SDK 测试和授权/验收器的宿主边界；重点验证一次授权、失败反馈、取消和 Pi CLI。
3. **A5-3 research**：迁移 source archive、Zotero/institutional 适配和 receipt journal；重点验证来源 hash、写入回执和只读/写入权限不漂移。
4. **A5-4 cleanup**：已删除不再被生产路径使用的 `.pi/lib` 兼容入口，移除 `extraResources` 中的 `.pi/lib`，并重跑 CLI、Desktop、公开插件和无证书打包 smoke。

每一步都应保持领域包与宿主修复分开提交，并通过 `npm run lint`、`npm run typecheck`、`npm test`、`npm run build`、`npm run check:arch`、相关包 smoke 和桌面产物检查。迁移期间不能改用户数据格式，也不能把兼容入口的删除和行为变化放在同一个不可回滚提交里。

## 是否现在做

A5-1～A5-4 已完成。它们是发布后的架构收敛项，但不改变已发布插件的 API 和安装边界；后续只需在领域包和 `drone-plugins` 中维护新能力。
