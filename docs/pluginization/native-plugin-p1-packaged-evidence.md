# P1 通用后台与 UI：macOS 安装包切片验收

2026-10-26。源码基线 `370038de`，插件候选基线 `a275f7d`。本次使用实际 DMG 安装出的应用操作，证明通用插件后台的加载、拒绝、停用和恢复；**不是完整知识迁移或零领域插件宿主验收**。后续作用域和发现实现变更必须重新构建验收，不能沿用本次结果。

## 安装包与测试范围

| 产物 | SHA-256 |
| --- | --- |
| `packages/desktop/dist/native-plugin-p1/drone-mac-arm64.dmg` | `7bcbdef6076133c27def73346d6719461a1bd849d5421c44db9f0dcc2d18befb` |
| 从 DMG 复制的 `Drone.app/Contents/Resources/app.asar` | `2d6514105cf3d2370b1a6f93acde19cf267a28ab9b48d851fc3eb3dd8bd298bc` |
| 私有测试包 `example-drone-runtime-receipt-0.0.0-acceptance.1.tgz` | `c4ac7e869a5a3adb838a65c7c69e62afacf7be3814acd55710b1676fa8a7f48c` |

应用版本 0.33.4，macOS arm64，独立 Node runtime 26.12.1。构建命令为 `CSC_IDENTITY_AUTO_DISCOVERY=false npm exec --workspace packages/desktop -- electron-builder --mac dmg --arm64 --publish never --config.directories.output=dist/native-plugin-p1`；这是未签名、未公证的本地验收包，不是已发布客户端。

DMG 只读挂载后复制应用，再卸载挂载点。启动实际应用二进制，使用独立 `--user-data-dir`、agent 目录和知识配置目录，不复制模型凭据，不绑定正式 Vault。本轮没有创建模型会话。测试包通过 npm tarball 安装到该独立 agent prefix，不修改宿主源码；它是本地编写的普通 Pi 包，加可选 `desktopRuntime` 和 `panel.tab`，声明无网络、用户文件写入或外部写入。**它不代表真实第三方科研插件验收**。

## 实际交互与回读

| 步骤 | 结果 | 观察 |
| --- | --- | --- |
| 安装包启动、发现测试包 | PASS | 技能与连接页列出 Runtime receipt acceptance；无模型配置仍可管理插件 |
| UI 总开关与插件启用 | PASS | 系统原生对话框显示独立进程限制，允许后才出现 Runtime receipt 标签 |
| UI 调用后台 | PASS | 点击 Read process receipt，返回 PID `38864`、代次 `d4358377-973b-46d6-8584-0ea39a8ee223`；系统进程查询确认其父 PID 为应用 `37269`，使用打包 Node 和仅本包 `--allow-fs-read` |
| 停用 | PASS | 开关关闭；上下文标签栏移除贡献并回到总览；系统查询确认 PID `38864` 已不存在 |
| 拒绝恢复启动 | PASS | 再启用时再次请求批准，拒绝后插件管理明确显示 `加载失败` 与 `Plugin runtime activation denied`；没有以成功结果掩盖拒绝 |
| 再次允许恢复 | PASS | 停用再启用并批准后错误消失、标签恢复；点击后返回新 PID `39604`、新代次 `02de9140-e532-4ba9-b9d0-44a2cfbf34b7` |
| 正常退出 | PASS | 通过应用退出快捷键结束；2026-10-26T06:34:31Z 回读确认应用及两个后台 PID 均已不存在 |

两次回执的 scope 都是 `workspaceId: desktop-window:1`。这只证明 P1 窗口绑定，不是真实工作区/会话身份；P2 正在替换为应用 owner 与可信逐调用上下文。共享 React renderer 仍是受信任代码，opaque token 不提供恶意 UI 隔离。测试包不读写业务数据，未验证 SQLite 所有权、UI/模型同一领域实例、升级/数据回滚、完整官方 ExtensionAPI 或零领域插件运行。

## 检查基线

本次安装包前，宿主 lint、typecheck、完整 test、build、check:arch 已通过。完整测试后最后的 loader 回归又运行 desktop 全量：159 文件、828 测试通过。backend 完整测试基线为 240 通过文件、1946 通过测试，现有环境跳过项仍保留。插件仓库 `npm run check` 通过，知识包 56 文件、398 测试通过。

`check:plugin-api --migration --lifecycle` 的本地 pack 门禁通过，候选 API 为 1.3.0；这是合成 0.9.0 → 1.3.0 → 0.9.0 → 卸载回归，不是公开 npm 升级。该 gate 记录时插件 HEAD 还是 `d2f76a0` 加本轮未提交修改；后续提交后的最终门禁须重跑。

新增 `check:native-plugin-boundary` 仍为 **INCOMPLETE：110 项耦合**。现有 `check:arch` 通过不能替代此门禁。SDK 1.1.0 与独立 1.4.0 的真实会话/基础 UI 对照另见 [运行时证据](native-plugin-runtime-evidence.md)，latest 自动发现导入前隔离仍未完成。

| 本机日志 | SHA-256 |
| --- | --- |
| `/tmp/drone-native-p1-test-final.log` | `8ed7a46c75d0996b2b1b5170e551673a6f4fb75ba6ebb1ebf145f9ee0cb4cd61` |
| `/tmp/drone-native-p1-desktop-final.log` | `6ba0beb899176d1b24b92ff9a2e941dd8339b98969b63e177bac54583829f704` |
| `/tmp/drone-native-p1-typecheck-final.log` | `01c67b03a85ad1311de221b3aa793d5ddbda6fc8a569da50f3db9b0ff3da9065` |
| `/tmp/drone-native-p1-api.log` | `32e5e6a12d0f191dffef681d833ed355a345388e327433952b206f70c4bfdb88` |
| `/tmp/drone-native-p1-build-package.log` | `56bba1e1ec8b4e21a771b5f122d3c9de976bbc93612976b9e81d90ffec5b6369` |
| `/tmp/drone-native-p1-package.log` | `011abf254ecda036bf9c093ecf057d00d6c73640bce7db17e3d39d23149c6f10` |
| `/tmp/drone-plugins-runtime-receipt-check.log` | `6691f616d92f6bdb119f2fe9ed398928835103d98a5b97224a4c331f2196f733` |

## 私有证据位置

安装、截图、AX 回执、进程检查与应用日志保存在 `.local/acceptance/native-plugin-runtime-gui-2026-10-26/`，不提交。`evidence-hashes.json` 列出每份原始文件的 SHA-256；关键截图为 `01-permission.png`、`02-live-receipt.png`、`04-panel-removed.png`、`05-denied-diagnostic.png`、`06-restored-receipt.png`。停用和退出分别有 `03-disabled-process.json` 与 `07-quit-processes.json` 的进程存在性回读。

本次没有 npm 发布、远程推送、正式 Vault 写入或外部账户验收。已发布版本与此前保留的四项未完成状态均不改变。
