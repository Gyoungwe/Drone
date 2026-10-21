# 插件平台 v3 实现证据

分支：两个仓库的 `main`（v2 已合并；v3 实现与规范更新随本次提交合并）。以下命令均在干净工作树上重跑。

最终远程头：Drone `main`=`9338c3bf`；drone-plugins `main`=`bc2bc771`。

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
- 证据：`npm run test --workspace @drone/desktop -- --run src/renderer/src/plugins/PluginRegions.test.tsx`（4 tests），`npm run typecheck --workspace @drone/desktop`。
- Claude 负责的真实安装包三页面验收尚未在本地执行；代码级挂载、卸载和默认恢复证据已通过。

## T4 宿主独立性

- `scripts/check-host-independence.mjs` 已挂入 `npm run check:arch`，扫描生产源码中的可选插件 import，并验证空插件安装根。
- 证据：`node --test scripts/check-host-independence.test.mjs`、`npm run check:arch` 通过。现有 `@gyoungwe/pi-analysis` host adapter 仍是已登记迁移例外；其完整迁移不属于 v3 任务范围。

## T5 安装前声明

- 插件行在安装前展示 capabilities、tools、permissions；缺失 manifest 时显示通用 Pi 包的未声明权限；安装动作先经过双语确认。
- 注册表元数据保留版本、能力、工具和权限，已安装 manifest 的声明优先。
- 证据：`npx vitest run packages/desktop/src/main/package-versions.test.ts packages/shared/src/host-api/packages.test.ts packages/shared/src/plugin-sources.test.ts`（16 tests）；覆盖 `@gyoungwe/pi-analysis` manifest 和无 manifest 的 L0 tarball。

## T6 工具重名诊断

- 会话资源汇总按加载顺序记录首个工具注册；重复工具保留首个，并在 Skills & Connections 诊断中显示两份来源。
- 证据：`npx vitest run packages/backend/test/research-skill-provenance.test.ts`（含双包同名工具场景）。

## T7 文档与登记

- 更新 `docs/INDEX.md`、双仓库所有权说明和本证据文件；`drone-plugins/docs/PLUGIN-SPEC.md` 已登记三类页面区域、通用 UI 发现、声明展示和宿主独立性要求。

## 回归

- 已通过：`npm run lint`（仅仓库已有大文件 warning）、三 workspace typecheck、`npm run check:arch`。
- 最终回归：`npm test` 通过（backend 231 files / 1894 tests，desktop 158 files / 818 tests，其他 workspace 亦通过）；`npm run typecheck`、`npm run build`、`npm run check:extensions -- --strict`、`npm run check:arch` 和 `npm run lint` 通过（lint 仅保留仓库已有两个大文件 warning）；插件仓库 `npm run check` 通过。

## file: 依赖门禁修复

- 插件仓库提交 `6d60477` 将根私有 workspace 的 `@gyoungwe/plugin-api` 从 `file:vendor/...` 改为 `^1.1.0`；锁文件仍固定已校验的 vendor tarball，因此未发布 npm 包时 `npm ci` 仍可离线重建。
- `npm ci --ignore-scripts --no-audit --no-fund && npm run check`（`drone-plugins`）通过。
- `npm run check:plugin-api -- --migration --lifecycle`（Drone）通过：API projection、tarball 安装、插件 workspace 依赖/HEAD 检查、0.9.0 → 1.1.0 → 0.9.0 生命周期和卸载均 PASS。
