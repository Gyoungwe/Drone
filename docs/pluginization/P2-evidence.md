# P2 验收证据：知识源码与插件入口迁移

日期：2026-10-21（Asia/Shanghai）  
Drone 分支：`codex/pluginize-v2-p2`（文档提交待生成）  
`drone-plugins` 分支：`codex/pluginize-v2-p2`  
插件实现提交：`badebad`  
源码历史合并提交：`f8687cf`（core）、`cf4489b`（test）

## 已完成

- `packages/knowledge/src` 的 51 个源码文件迁入 `drone-plugins/packages/pi-knowledge/src/core/`；原 35 个测试文件迁入 `test/`，测试 import 改为插件内路径并保留 NodeNext `.js` 扩展名。
- 源码和测试历史经过 path-preserving rewrite 后合并；`git log --follow -- packages/pi-knowledge/src/core/reuse.ts` 能回溯 `3d71517`、`8a4e452`、`d7264a5`，测试文件能回溯 `89af78c`、`1c15f1e`。
- 新增 `src/extension/knowledge-extension.ts`、`src/extension/knowledge-worker.ts`、`src/host.ts`；`src/index.ts` 不再是占位入口。native Pi 入口注册 `knowledge_status`、`knowledge_search` 和 `/drone-init`，worker 由插件自己的资源路径启动。
- `scripts/build.mjs` 从源码生成 `dist/index.mjs`、`dist/host.mjs`、声明文件、worker 和相邻的 `.knowledge-worker-manifest.json`；manifest 写入 `outputSha256`、`inputsSha256`、`knowledgeSourceSha256`。
- `build-manifest.json` 标记 `artifactSource: "source"`，记录 55 个 source hashes 和全部输出 hashes；`build:check` 校验一致性。
- `@gyoungwe/plugin-api@1.1.0` 的 Drone tarball 放在插件仓库 `vendor/`，锁文件保存 SHA-512；插件包以 `^1.1.0` 声明公开依赖，clean-install smoke 将 vendor tarball 作为本地 registry fixture 注入。
- `@gyoungwe/pi-knowledge` 升到 `0.2.0`，manifest 增加 host entrypoint；`research-suite` 依赖同步到 `0.2.0`。

## 定向检查

| 命令 | 结果 |
|---|---|
| `npm test --workspace @gyoungwe/pi-knowledge` | PASS；35 files / 319 tests |
| `npm run --workspace @gyoungwe/pi-knowledge build` | PASS；源码构建四类产物和 worker manifest |
| `npm run --workspace @gyoungwe/pi-knowledge build:check` | PASS；source/output hashes 一致 |
| `npm run --workspace @gyoungwe/pi-knowledge smoke` | PASS；npm pack 121 files，两个工具、`/drone-init` 和 worker hash 校验通过 |
| `npm run check`（`drone-plugins`） | PASS；manifest、全 workspace build/typecheck、各插件测试/smoke、clean tarball install、pack check 全通过 |
| `git diff --check` | PASS；无空白错误 |

clean-install smoke 的最终摘要：六个插件安装成功，Pi loader 发现 `pi-analysis`、`pi-evidence`、`pi-connectors` 和 research suite；`pi-knowledge` 注册 2 个工具，未配置状态为 `unconfigured`。

## 未完成/偏离

- P2 没有推送分支；按维护规则，外部 push 需要单独授权。
- P1 清单中依赖 `@drone/tasks`、Obsidian workbench 和 Desktop runtime 的 `internal/knowledge-extension.ts` 没有伪装成可独立插件源码；这些宿主专属 orchestration 适配仍留在 Drone，P3 通过 HostPort 接线后再迁移。P2 交付的是 host-neutral native Pi extension/worker 边界和完整 knowledge core，未宣称 Desktop orchestration 已迁出。
- `@gyoungwe/plugin-api@1.1.0` 尚未发布到 registry；当前以已校验的 `vendor/gyoungwe-plugin-api-1.1.0.tgz` 完成离线构建和安装门禁。
