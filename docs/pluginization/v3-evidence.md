# 插件平台 v3 实现证据

分支：`codex/plugin-platform-v3`（Drone 与 `drone-plugins`）。v2 已分别合并并推送到两边 `main`。

## T1 清单检查器与 tools

- 插件仓库提交：`0972aba feat(platform): T1 strengthen manifest checks`。
- `scripts/check-manifests.mjs` 增加 manifest、权限、entrypoint/files、依赖、L1 tools 和宿主声明检查；六个现有插件补齐 `tools`。
- `scripts/check-manifests.test.mjs` 覆盖各规则反例；能力插件注册测试逐项比较运行时工具与清单。
- 证据命令：`npm run check`、`node scripts/check-manifests.test.mjs`、各插件 manifest smoke 均通过。

## T2 通用 UI 插件发现

- `UiPluginManager` 从 `<agentDir>/npm/node_modules` 遍历 scoped/非 scoped 包，读取 `plugin.manifest.json.entrypoints.ui`，并要求 `hosts` 包含 `drone-desktop`。
- 非 `@gyoungwe` 夹具可发现；损坏包和错误 UI manifest 进入诊断行，不阻断其他插件。
- 证据：`npm run test --workspace @drone/desktop -- --run src/main/ui-plugins/installed-ui-pack.test.ts`。

## T3 页面区域

- 新增 `knowledge.tab`、`home.section`、`skills.section`，同步 shared 区域目录、renderer 挂载、插件类型声明和 UI SPEC。
- 知识库插件页签在核心页签之后追加；停用后回到默认内容；首页和技能页在无贡献时不渲染空壳。
- 证据：`npm run typecheck --workspace @drone/desktop`、renderer plugin registry 对齐测试。

## T4 宿主独立性

- `scripts/check-host-independence.mjs` 已挂入 `npm run check:arch`，扫描生产源码中的可选插件 import，并验证空插件安装根。
- 证据：`npm run check:arch` 通过。

## T5 安装前声明

- 插件行在安装前展示 capabilities、tools、permissions；缺失 manifest 时显示通用 Pi 包的未声明权限；安装动作先经过双语确认。
- 注册表元数据保留版本、能力、工具和权限，已安装 manifest 的声明优先。

## T6 工具重名诊断

- 会话资源汇总按加载顺序记录首个工具注册；重复工具保留首个，并在 Skills & Connections 诊断中显示两份来源。

## T7 文档与登记

- 更新 `docs/INDEX.md`、两个仓库 `AGENTS.md`、双仓库所有权说明和本证据文件；`drone-plugins/docs/PLUGIN-SPEC.md` 为清单合同入口。

## 回归

- 已通过：`npm run lint`（仅仓库已有大文件 warning）、三 workspace typecheck、`npm run check:arch`。
- 最终回归：`npm test` 通过（backend 231 files / 1893 tests，desktop 157 files / 811 tests，其他 workspace 亦通过）；`npm run typecheck`、`npm run build`、`npm run check:extensions -- --strict`、`npm run check:arch` 和 `npm run lint` 通过（lint 仅保留仓库已有两个大文件 warning）；插件仓库 `npm run check` 通过。

## file: 依赖门禁修复

- 插件仓库提交 `6d60477` 将根私有 workspace 的 `@gyoungwe/plugin-api` 从 `file:vendor/...` 改为 `^1.1.0`；锁文件仍固定已校验的 vendor tarball，因此未发布 npm 包时 `npm ci` 仍可离线重建。
- `npm ci --ignore-scripts --no-audit --no-fund && npm run check`（`drone-plugins`）通过。
- `npm run check:plugin-api -- --migration --lifecycle`（Drone）通过：API projection、tarball 安装、插件 workspace 依赖/HEAD 检查、0.9.0 → 1.1.0 → 0.9.0 生命周期和卸载均 PASS。
