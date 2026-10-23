# P3 验收证据：宿主消费锁定的知识插件

> **历史记录（2026-10-21）**：本文保留 P3 分支验收时的原始状态。后续 C0–C3 已完成主线合并、公开包发布和证据统一；下方“未完成/偏离”只描述当时的边界，当前状态以 [`v3-evidence.md`](v3-evidence.md)、[`gap-closure-plan.md`](gap-closure-plan.md) 和 [`docs/INDEX.md`](../INDEX.md) 为准。

日期：2026-10-21（Asia/Shanghai）
Drone 分支：`codex/pluginize-v2-p2`
`drone-plugins` 分支：`codex/pluginize-v2-p2`
Drone 交付提交：`5eff5179a714bbe3884673823533200b514bcdbf`
插件锁定头：`cdff35e23dd4f4d58e9684e2c4a632c81ccf34b7`
插件包：`@gyoungwe/pi-knowledge@0.2.0`
锁定 tarball SHA-256：`4b8275c9a52b5709623fbcc3109a0d9f5a5f11cf095044f5356375e8acfb723c`

## 已完成

- Drone 新增 `plugins.lock.json` 和 `scripts/fetch-plugins.mjs`。默认流程浅克隆锁定提交、安装、构建、打包、校验 SHA-256 并复制到 `vendor/plugins/pi-knowledge`；`DRONE_PLUGINS_DIR` 用于本地插件联调并明确打印覆盖提示。
- backend、research、extensions 和相关测试统一从 `@gyoungwe/pi-knowledge/host` 取知识 API；Drone 删除 `packages/knowledge`、知识 worker 源入口和旧的 `build-knowledge-runtime.mjs`。
- electron-builder 将插件 `dist/index.mjs` 作为 `knowledge-plugin.mjs`，并将插件 worker 与 manifest 复制到 `research-workbench/extensions`。宿主 host adapter 保留为 Desktop 组合根的运行时适配，偏离原因记录在 [v2-plan.md](v2-plan.md)。
- `.gitignore` 排除 `vendor/plugins` 和生成的 worker；构建、类型检查、测试和架构检查都会先确保插件资源存在。
- README 中已记录 `fetch:plugins → build → dist` 顺序和 `DRONE_PLUGINS_DIR` 联调方式。

## 定向检查

| 命令 | 结果 |
|---|---|
| `DRONE_PLUGINS_DIR=../drone-plugins npm run check:knowledge-runtime` | PASS；worker manifest hash 与插件构建产物一致 |
| `DRONE_PLUGINS_DIR=../drone-plugins node scripts/check-knowledge-package.mjs --resources packages/desktop/dist/mac-arm64/Drone.app/Contents/Resources/research-workbench` | PASS；46 个 core tools、17 个必需知识工具、worker lifecycle `staged → verified → enabled` |
| `npm run check:extensions -- --strict` | PASS；12 个 source/output 映射，0 个 legacy artifact 漂移 |
| `npm run check:knowledge-runtime` | PASS；远程锁定插件构建、tarball SHA-256、worker manifest 和 integrity 一致 |
| `npm run check:arch` | PASS；0 个新增架构违规 |
| `DRONE_PLUGINS_DIR=../drone-plugins npm run build` | PASS；pi-core、pi-research、Electron main/preload/renderer 构建完成 |
| `npm run lint` | PASS；仅保留 2 个既有大文件大小 warning |
| `npm run typecheck` | PASS |
| `npm test` | PASS；全工作区测试通过 |
| `npm run check:desktop-artifact` | PASS；17 项检查、4 个静态视口 |
| `node scripts/check-release-artifacts.mjs --dir packages/desktop/dist --platform mac --arch both --allow-unsigned` | PASS；arm64/x64 的 DMG 和 ZIP 均解包、挂载并完成 `app.asar`、Electron framework、`--version` 启动探针 |
| 干净 checkout：`git clone` → `npm ci` → `npm run build` → `stage:pi-packages`/research skills → `electron-builder --mac --arm64 --dir` | PASS；从远程 `codex/pluginize-v2-p2` 重建 App，`check-knowledge-package` 通过，worker integrity 与锁定插件一致 |

本次 macOS 产物 SHA-256：

| 产物 | SHA-256 |
|---|---|
| `drone-mac-arm64.dmg` | `3570db7f7f32456bf8d9ca58c90c8337320b499759dcc167b41f051b36864f1a` |
| `drone-mac-arm64.zip` | `8600bd09ad5afd893b0e262a64e62d892a3eaf6161ce26e2d555cd662287050b` |
| `drone-mac-x64.dmg` | `1091d2598422c35d858d58d299f360a2e6fd0910c7d68fc48fcb6628b539bb19` |
| `drone-mac-x64.zip` | `5b05ef3f46b12d8e82fb36ae60f83adf0512995e66d6637c2125d4b98336f048` |

打包后的 knowledge worker integrity：`eae35e78905022d937a890c55a0c61e2f8e373e08b49e9c4654eb5cb725e5216`。

验收脚本明确报告 `status: PASS`；签名检查为 `NOT_RUN`，因为本地构建按仓库发布配置保持 unsigned。Electron 进程只用于有界 `--version` 探针，未宣称真机 GUI 会话验收。

## 当时未完成/偏离（已由后续主线验收取代）

- 锁定提交已推送到 `origin/codex/pluginize-v2-p2`，默认远程抓取流程已从 GitHub 克隆、构建、打包并校验上述 SHA-256。
- 计划中的文件名保持要求通过 `knowledge-plugin.mjs` + 宿主 `knowledge-extension.mjs` 双入口实现；host adapter 仍有宿主 runtime ports，待后续 HostPort 迁移后可合并入口。
- 真实知识库打开和 Claude 实机验收由正式验收者执行；本地证据覆盖打包资源、worker 完整性和静态 UI 合同。
