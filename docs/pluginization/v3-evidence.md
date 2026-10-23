# 插件平台 v3 实现证据

分支：两个仓库的 `main`（v2 已合并；v3 实现与规范更新随本次提交合并）。以下命令均在干净工作树上重跑。

当前合并基线：Drone `main=4049057c456d1ee3fe252bf0d31c83280cad4ab9`；drone-plugins `main=b6bc98d7d0ac99461ae3249fb0a47b713166d007`。发布证据和锁文件均指向这两个合并后的 head；后续文档提交不改变代码基线。

## T1 清单检查器与 tools

- 插件仓库提交：`0972aba feat(platform): T1 strengthen manifest checks`。
- `scripts/check-manifests.mjs` 增加 manifest、权限、entrypoint/files、依赖、L1 tools 和宿主声明检查；六个现有插件补齐 `tools`。
- `scripts/check-manifests.test.mjs` 覆盖各规则反例；能力插件注册测试逐项比较运行时工具与清单。
- 证据命令：`npm run check`、`node scripts/check-manifests.test.mjs`、各插件 manifest smoke 均通过。

## T2 通用 UI 插件发现

- `UiPluginManager` 从 `<agentDir>/npm/node_modules` 遍历 scoped/非 scoped 包，读取 `plugin.manifest.json.entrypoints.ui`，并要求 `hosts` 包含 `drone-desktop`。
- 非 `@gyoungwe` 夹具可发现；损坏包和错误 UI manifest 进入诊断行，不阻断其他插件。
- 证据：`DRONE_PLUGINS_DIR=../drone-plugins npm exec vitest run packages/desktop/src/main/ui-plugins/installed-ui-pack.test.ts --config packages/desktop/vitest.config.ts`（4 tests；显式指定相邻插件仓库路径，避免旧默认路径歧义）。

## T3 页面区域

- 新增 `knowledge.tab`、`home.section`、`skills.section`，同步 shared 区域目录、renderer 挂载、插件类型声明和 UI SPEC。
- 知识库插件页签在核心页签之后追加；停用后回到默认内容；首页和技能页在无贡献时不渲染空壳。
- 证据：`npm run test --workspace @drone/desktop -- --run src/renderer/src/plugins/PluginRegions.test.tsx`（4 tests），`npm run typecheck --workspace @drone/desktop`。
- 真实安装包验收（2026-10-23，Drone `0.33.4`，unsigned macOS arm64）已通过：
  - 安装包：`packages/desktop/dist/mac-arm64/Drone.app`，`app.asar` SHA-256 `a19aacaef58dccdd8a70e8eb29034bf0d1ae0254b5f73af42105a710aa2ae5ec`。
  - 安装方式：本地 tarball `drone-t3-ui-fixture@0.0.1` 通过 `npm install --prefix /tmp/drone-t3-agent-tar2/npm --ignore-scripts --no-audit --no-fund /tmp/drone-t3-ui-fixture-0.0.1.tgz` 写入 `<agentDir>/npm/node_modules`；tarball SHA-256 `4071a41f0d3b7bf7b48aa9ead844f42c7a12374134db4957f63cfe47d3a1ff92`。
  - 启用后真实页面回读：知识库显示页签 `T3 Knowledge`；新会话首页显示 `T3 Home`；技能与连接页显示 `T3 Skills`，插件行显示 `T3 Region Probe Desktop UI` 且开关为 on。
  - 停用后真实回读：三页分别不再包含 `T3 Knowledge`、`T3 Home`、`T3 Skills`，知识库保留默认四个页签，首页/技能页没有空壳。
  - 完整回执见 [`v1.1-t3-ui-acceptance-2026-10-23.json`](../releases/v1.1-t3-ui-acceptance-2026-10-23.json)。

## T4 宿主独立性

- `scripts/check-host-independence.mjs` 已挂入 `npm run check:arch`，扫描生产源码中的可选插件 import，并验证空插件安装根。
- 现有 `@gyoungwe/pi-analysis` host adapter 不能在 v3 删除：`AnalysisTaskController` 在创建、就绪、执行回执审查和交付阶段需要具体 registry，`CapabilityDiscoveryService` 还需要它做版本解析；当前公开 `DroneHostPort` 没有 versioned analysis registry/loader。删除会直接破坏宿主的分析门禁闭环。
- C2 已把例外收窄到三个 facade：`packages/backend/src/services/analysis-adapters/registry.ts`、`assembly.ts`、`bulk-rnaseq.ts`。检查器新增了“例外文件之外的 `pi-analysis` import 必须失败”的反例测试。
- 后续登记：v3.1 `analysis host registry migration`。删除条件是 plugin-api 提供稳定 host registry/loader，宿主改为只消费该 HostPort，并通过 `check:arch`、空可选插件运行检查和 analysis plan→review→delivery 回归；在此之前不把 T4 标记为 v3 未完成。
- 证据命令：`node --test scripts/check-host-independence.test.mjs`、`npm run check:arch` 通过。

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

## 后续任务（不计入 v3 未完成）

- v3 T4 的 `pi-analysis` host registry migration 已登记为 v3.1 后续任务，不再计入 v3 未完成项。
- OmicOS 六个 PR 的实现与评估均已完成：PR1–PR5 有真实安装包/会话验收 PASS，PR6 的 pdf.js/MinerU/GROBID 评估已完成，是否接入可选解析后端仍是用户决策项；实现和真实验收证据见 [`docs/omicos-platform-plan.md`](../omicos-platform-plan.md) 与 [`pluginization/omicos-evidence.md`](omicos-evidence.md)。当前后续项统一收敛到 [`gap-closure-plan.md`](gap-closure-plan.md)。

## file: 依赖门禁修复

- 插件仓库提交 `6d60477` 将根私有 workspace 的 `@gyoungwe/plugin-api` 从 `file:vendor/...` 改为 `^1.1.0`；锁文件仍固定已校验的 vendor tarball，因此未发布 npm 包时 `npm ci` 仍可离线重建。
- `npm ci --ignore-scripts --no-audit --no-fund && npm run check`（`drone-plugins`）通过。
- `npm run check:plugin-api -- --migration --lifecycle`（Drone）通过：API projection、tarball 安装、插件 workspace 依赖/HEAD 检查、0.9.0 → 1.1.0 → 0.9.0 生命周期和卸载均 PASS。
