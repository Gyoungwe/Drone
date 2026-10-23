# 插件化 v2 验收（第 3 轮）

> **历史验收记录（最终复核）**：本轮 PASS 是 v2 分支上的最终复核；随后已通过 C0–C3 合入 Drone `main`、更新公开包/插件 head 和统一证据。当前状态以 `v3-evidence.md`、`gap-closure-plan.md` 和 `v1.1.0-npm-packages.json` 为准。

验收方：Claude　日期：2026-10-21
被验收提交（均已推送到远端分支 `codex/pluginize-v2-p2`，远端头与本地一致）：
- Drone：`8e4faa82035dabd1861945e730cfd1c434135916`
- drone-plugins：`6a61767e021de70954ad554d00009145afd2f6b0`

本轮未推送、未合并，也没有再访问或改动正式 Vault。

## 总结论：PASS

第 2 轮的 B1–B3 已全部修复。在云端从远端分支重新克隆后，**不设 `DRONE_PLUGINS_DIR`**（插件完全按 `plugins.lock.json` 拉取并校验），按计划顺序执行的全部检查通过。正式 Vault 的 N=2 真实运行结果沿用 [acceptance-2.md](acceptance-2.md) 的 R1（PASS）。

| 项 | 结果 |
|---|---|
| B1 `create-backend.ts` 类型错误 | PASS |
| B2 知识 UI 事件跨 bundle 转发 + 跨副本测试 | PASS |
| B3 锁文件、扩展打包产物、证据文件、提交 | PASS |
| 第 2 轮 A1–A7 | 维持 PASS（代码未回退，相关测试全部通过） |
| R1 正式 Vault N=2 真实运行 | 沿用第 2 轮 PASS |

## 复核方法与命令

全部在云端干净目录执行，从 GitHub 克隆远端分支：

```text
git clone --branch codex/pluginize-v2-p2 https://github.com/Gyoungwe/drone-plugins
npm ci --ignore-scripts
npm run check
npm test -w @gyoungwe/pi-knowledge

git clone --branch codex/pluginize-v2-p2 https://github.com/Gyoungwe/Drone
# 不设 DRONE_PLUGINS_DIR
npm ci
npm run fetch:plugins
npm run lint
npm run typecheck
npm test
npm run check:arch
npm run build
npm run check:extensions -- --strict
```

### 插件仓库

| 命令 | 结果 |
|---|---|
| `npm ci --ignore-scripts` | rc=0 |
| `npm run check` | rc=0；构建后工作树无改动，说明提交的产物可以复现 |
| `npm test -w @gyoungwe/pi-knowledge` | rc=0，40 个文件 / 331 条 |

### 宿主仓库

| 命令 | 结果 |
|---|---|
| `npm ci` | rc=0 |
| `npm run fetch:plugins` | rc=0；按锁定提交 `6a61767` 克隆、构建、打包，tarball sha256 `468ce844…bc025` 与 `plugins.lock.json` 完全一致 |
| `npm run lint` | rc=0 |
| `npm run typecheck`（在 build 之前） | rc=0 |
| `npm test` | rc=0。backend 231 个文件 / 1893 条通过（13 条跳过）；desktop 157 个文件 / 809 条；其余工作区和 `node --test` 脚本测试全部通过，0 失败 |
| `npm run check:arch` | rc=0 |
| `npm run build` | rc=0 |
| `npm run check:extensions -- --strict` | rc=0，"verified 12 extension source/output mappings (0 preserved legacy artifacts)" |

## 逐项核对

**B1 PASS。** `create-backend.ts:588` 改为 `let model: ReturnType<typeof runtime.getModel> | undefined;`，干净 checkout 下 typecheck 通过。

**B2 PASS。** `pi-knowledge/src/core/ui-state.ts` 恢复了 `drone:knowledge-ui/v1` 进程事件转发，注释如实写明原因（扩展和 backend 各自打包一份，runtimeSlot 不跨这个边界）。新增 `test/ui-state-events.test.ts`，验证另一份副本发出的 flow 事件能被订阅收到，并能用 `flowFor` 读出。第 2 轮失败的两个真实 SDK 测试现在通过：
- `test/knowledge-publication-delivery.test.mjs`（15 条）✓
- `test/knowledge-specialists-sdk.test.mjs`（1 条）✓

本机 P5 构建的 App 中，`knowledge-extension.mjs` 和 `app.asar` 都包含该事件桥。

**B3 PASS。**
- `plugins.lock.json` 锁定 `6a61767…`，tarball sha256 `468ce844…`，与插件仓库远端头一致，并由干净构建复现。
- `.pi/extensions/*.mjs` 已重新生成并提交，严格扩展检查通过。
- `docs/pluginization/P5-fixes-evidence.md` 已提交；两个仓库的本地工作树干净，并已推送到远端分支。
- 一致性：锁定插件构建出的 worker 与本机 P5 App 中打包的 worker 哈希一致（`0ba27405…`）。

## 遗留问题（不阻塞合并）

1. **UI 事件序号可能回退。** `deliverKnowledgeUi` 中 `state.seq = Number(value.sequence) || state.seq + 1` 会直接采用对方副本的序号；两份副本各自计数时，序号可能变小或重复。原实现用的是 `Math.max`。目前 renderer 和 backend 都没有按 `sequence` 排序或去重，所以没有实际影响，建议改回 `Math.max(state.seq, Number(value.sequence) || 0)`。
2. **pi-core 构建清单随平台变化。** 在 Linux 上执行 `npm run build` 会改写 `packages/pi-core/build-manifest.json`（inputs/outputs 哈希不同）；但在已提交状态下执行 `npm run check:pi-core` 显示 "artifacts are up to date"。这与本次插件化无关，属于跨平台复现性问题，建议以后单独处理。
3. **第 2 轮的三条建议仍未处理：**
   - 运行明细只显示 kind 和状态，不显示笔记标题；
   - 孤立 / 未被引用类候选的真实形态（目前是新建 `Wiki/<标题>.md` 链接页）还没有集成测试覆盖；
   - `source-changed` 需要的 `sourceText` 仍然没有任何代码提供，提示词会退回使用笔记正文。
4. **计划第 8 节在本轮验收时的历史状态：** `@gyoungwe/plugin-api@1.1.0` 尚未发布到 npm（当时使用锁定哈希的 vendor tarball）；该状态已由后续正式发布和 C0–C3 证据取代。方案 (b)（知识页做成 UI 插件）与 research 包的迁移不在本计划范围内。

## 合并建议

验收通过，两个仓库的 `codex/pluginize-v2-p2` 可以合并到 main：先合并 drone-plugins，再合并 Drone，Drone 的锁文件指向插件提交 `6a61767`。合并后如果插件仓库对该提交做了 rebase 或 squash，需要同步更新 Drone 的 `plugins.lock.json`。按要求，本轮没有执行合并或推送。
