# 原生插件检查点日志归档（2026-10-28）

正文保留最近 30 条；本文件记录本轮移出的原始历史条目。

## native-plugin-implementation-plan.md

- 2026-10-27：P2 worker package-local seam：`KnowledgeHostLoader.configureWorker` 现在由 pi-knowledge 选择其包内 `lib/knowledge/runtime/worker.mjs`，host factory 尊重该 `file:` URL 并按相邻 manifest 校验字节哈希后再启动；legacy `configureBackendKnowledgeWorker` 拆出独立 host-root 适配，避免旧测试/兼容服务被新 URL 语义改变。插件 host-loader 4 项、backend worker/create-backend 34 项与 typecheck 通过；electron-builder/`.pi` bundled worker 复制暂保留，因为现有 bundled extensions 和 release fixtures 仍依赖旧资源树，待单独迁移。
- 2026-10-27：worker package-local ownership 收口：`packages/extensions/src/internal/knowledge-runtime.ts` 改为调用已安装 `@gyoungwe/pi-knowledge/host` 的 worker URL/metadata，`check-local-desktop-artifact` 和 knowledge FTS fixture 改校验 `vendor/plugins/pi-knowledge/lib/knowledge/runtime/worker.mjs` 及其 manifest。`.pi/extensions`、`fetch-plugins` 与 electron-builder 的旧复制仍作为显式 legacy/release fixture 保留，尚未宣称资源树完全删除；需要后续迁移 bundled/release 生成链后再清理。
- 2026-10-27：backend legacy worker 路径收窄：生产 knowledge UI 不再导出或执行 host-root `.pi` worker 配置/解析，package-local setup 是唯一 production worker seam；旧兼容配置与资源校验限定在 `packages/backend/test/knowledge-compat-fixture.ts`。backend typecheck、39 项 focused worker/knowledge 回归、Biome 通过；electron-builder/`.pi` 复制链与正式 GUI 继续保持未完成。
- 2026-10-27：P6 依赖收窄：`1044fedf` 删除 backend 对 `@gyoungwe/pi-core` 的生产运行时依赖并同步 `package-lock.json`；backend typecheck、memory-save/deliver-files/todo 11 项回归与 `check:arch` 通过。当前宿主仍追踪 `@gyoungwe/pi-knowledge`，compatibility/worker 迁移继续保持未完成。

## native-plugin-capability-slice-evidence.md

- 2026-10-27：P6 依赖收窄：`1044fedf` 确认 backend 生产源码已无 `@gyoungwe/pi-core` runtime import，删除 `packages/backend` 的生产依赖并同步锁文件；backend typecheck、memory-save/deliver-files/todo 11 项回归与 `check:arch` 通过。宿主运行时追踪项降为 `@gyoungwe/pi-knowledge`，knowledge compatibility/worker 迁移仍未完成。
- 2026-10-27：P2/P6 默认边界收窄：knowledge UI helper 与 `KnowledgeUiService` 的默认 compatibility 统一改为 backend 内置 `unavailableKnowledgeCompatibility`；无插件直接构造服务不会触发 legacy background reviewer，overview 等操作返回明确 unavailable。`knowledge-host-ui-reading` 的兼容回归显式注入 `defaultKnowledgeCompatibility`，避免测试适配伪装成宿主默认行为；backend typecheck、create-backend/knowledge-host-ui-reading/worker-lifecycle 35 项、Biome 通过。`pi-knowledge` runtime dependency、compat.ts/compat-adapter 与 worker 本体仍是未关闭迁移边界。
- 2026-10-27：P2/P6 兼容组合移出生产：删除 `packages/backend/src/knowledge/compat.ts` 与 `compat-adapter.ts`，将旧 package composition 限定到 `packages/backend/test/knowledge-compat-fixture.ts`；`configureBackendKnowledgeWorker` 现在必须由显式迁移/测试调用方注入 setup，生产 `createBackend`/UI 源码不再 static import `@gyoungwe/pi-knowledge/host`。backend 将 `@gyoungwe/pi-knowledge` 下移至 devDependency 并同步 lockfile；backend typecheck、create-backend/knowledge-host-ui-reading/worker-lifecycle 36 项、Biome、`check:arch` 通过，`check:host-domain-deps` 返回 `trackedRuntimeDependencies: []`，native boundary runtime import 从 4 降至 2（仅 discovery/inquiry）。worker 本体、完整 knowledge UI ownership 与正式 GUI 仍未完成。
- 2026-10-27：剩余 discovery/inquiry 边界复核：`@drone/inquiry` 由 backend 无条件组合并供 compute/task/local execution 与 Desktop decisions/inquiry IPC 共用，定位为宿主证据基础设施；`@drone/discovery` 的 B5d–B5f kernel/exploration/critic/evaluation 属科研业务，后续迁入 optional plugin，但需先提供 host-owned 容器执行、授权、KernelRunner 和 Inquiry 端口。两者当前不改为 devDependency；本轮没有用静态计数掩盖这两个 runtime 边界，`check:native-plugin-boundary` 继续保持 `INCOMPLETE`。
