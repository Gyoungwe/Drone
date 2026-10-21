# P5 收口证据：知识插件化最终修复

日期：2026-10-21（Asia/Shanghai）  
Drone 分支：`codex/pluginize-v2-p2`  
`drone-plugins` 分支：`codex/pluginize-v2-p2`

本轮收口了 [acceptance-2.md](acceptance-2.md) 的 B1–B3：修正维护模型的类型、恢复两个 bundle 之间的知识 UI 事件桥、补跨 bundle 事件测试、更新插件锁定提交与 tarball 摘要，并重新生成 `.pi/extensions` 与 macOS arm64 目录包。正式 Vault 的 N=2 运行结果沿用第二轮报告；最终复核见 [acceptance-3.md](acceptance-3.md)。

## 变更证据

- `drone-plugins` 最终提交：`6a61767e021de70954ad554d00009145afd2f6b0`，包含 `0cea63a` 的维护实现和 `ui-state` 跨 bundle 事件桥。
- `plugins.lock.json` 锁定 `@gyoungwe/pi-knowledge` 提交 `6a61767e021de70954ad554d00009145afd2f6b0`，tarball SHA-256 为 `468ce8446e5172e7ab20248e7da46e16855f9bec02f7e4e64b230164316bc025`。
- `packages/backend/src/create-backend.ts` 使用 `ReturnType<typeof runtime.getModel>`，干净类型检查不再依赖错误的裸 `Model` 类型。
- `packages/pi-knowledge/src/core/ui-state.ts` 通过版本化 `drone:knowledge-ui/v1` 进程事件在扩展 bundle 与 backend bundle 间转发 UI 事实；`ui-state-events.test.ts` 验证另一份模块副本发出的 flow 事件可被接收。
- `scripts/fixtures/native-pi-tools.json` 将已迁移到 `pi-knowledge` 的工具标记为 `delegated`，`check-native-pi` 校验其宿主转发边界仍存在。
- 已重新生成 `.pi/extensions/*.mjs`、worker/build manifest，并从 `packages/desktop` 成功构建 `packages/desktop/dist/mac-arm64`。

## 按要求的干净顺序

在本地依次执行：

```text
npm ci
npm run fetch:plugins
npm run lint
npm run typecheck
npm test
npm run check:arch
npm run build
npm run check:extensions -- --strict
```

结果：全部通过。`lint` 仅保留两个已有的大文件尺寸 warning；全量测试为 231 个测试文件、1906 条测试，13 条跳过；架构检查为 0 个 baseline finding；严格扩展检查验证 12 个 source/output 映射且无 legacy artifact。

插件仓库 `npm run check` 通过；`npm test -w @gyoungwe/pi-knowledge` 通过 40 个测试文件、331 条测试。正式 Vault 验收只记录元数据，不把 Vault 正文、凭据或本地状态纳入提交。

npm 正式发布已完成：`@gyoungwe/plugin-api@1.1.0` 与 `@gyoungwe/pi-knowledge@0.2.0` 按依赖顺序发布；官方 registry 元数据、完整性、干净消费者安装/加载、Pi 兼容性和公开插件宿主验收见 [v1.1.0 npm 发布证据](../releases/v1.1.0-npm-packages.json)。
