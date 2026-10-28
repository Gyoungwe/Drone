# Inquiry 原生入口与同包 UI 候选证据

状态：**INCOMPLETE**。插件 `dceabb3`（父 `eb36c21`）补上官方 Pi 根入口和同包 `panel.tab`，保留原 Inquiry SQL、SQLite 文件格式、原 project identity 和 SHA 原始备份。subtree 历史从 `895b2f0` 的第二父 `b69e05ff` 保留。本切片没有删除宿主旧 Inquiry 组合，也没有发布 npm 或完成正式 DMG GUI。

## 实际安装与运行

同一个私有包 `/tmp/inquiry-native-ui-final-20261029/gyoungwe-pi-inquiry-0.1.0.tgz`，SHA256 `5908bdf6d91e8ef053d9294a6a5e02cc3517e283e7fb5baea6a1cd61f9d69dea`。公开 API 候选 `/tmp/drone-native-domain-owner-integration/vendor/gyoungwe-plugin-api-1.3.0-e41cf906.tgz`，SHA256 `fd122af6a71432edd552dcb113dbd03189d04c30f2158ae0a3179eeefada4a2e`。二者均从 npm 干净安装，禁止 install scripts，并使用真实固定 Pi 1.1.0 会话及离线 faux 模型。

- `packed-inquiry-native-sdk.test.mjs`：标准 Pi 根入口真实加载；清单恰好声明 `inquiry_read` / `inquiry_write`；真实 SDK UI 确认包含实际 workspace/session；拒绝保持原库；批准等待期间 abort 后迟到同意没有提交；原路径精确恢复；shutdown 后旧 SQLite writer 才能接管。原生默认目录是工作区 `runs/.drone-inquiry`，与 Desktop 旧目录不同，不默称接管。
- `packed-inquiry-managed-ui-sdk.test.ts`：实际 UiPluginManager 扫描、`nativeRuntimeName`、production Desktop factory、普通受限 worker 和两个真实 SDK；生产 buildPlugin 构建安装包 UI 后用真实 registry/client/RegionHost 渲染。页面写→SDK 读，第二 SDK 写→页面事件更新，页面精确恢复原始字节；旧 writer 在 owner 存活时被同一个租约协议拒绝，停用后接管，重启重新读同原目录。fixture 的 Electron dialog 是明确授权测试端，不代表人工图形验收。
- `packed-inquiry-provider-sdk.test.mjs`：独立消费者通过唯一 generic provider 访问同 canonical SQL，实际宿主 JsonStore、binary ports、备份/恢复和 legacy writer handoff；不把该 fixture 的直接 bridge attachment 当成 UI 证据。

以上同包三个实际 SDK 文件共 **3/3 PASS**，日志 `/tmp/inquiry-native-ui-provider-final-sdk.log`。早期 UI fixture 的文本定位、错误 legacy 构造参数和 textarea 匹配失败日志均保留；没有以修改成功语义掩盖领域失败。

## 持久化与取消

Desktop JSON 走真正 JsonStore；原生 Node adapter 经公开 `node/binary-state` 的同一 bounded bytes/CAS/原子提交/写后回读协议持久化自身 JSON，严格报损坏。两者不是同一 JsonStore 实现，测试和证据分开。普通 worker 不 import Node SQLite，WASM 只在内存使用 canonical SQL。

原始 SQLite、JSON 元数据各需独立根授权，绑定时必须为同一 canonical directory；写权限仍逐次检查实际 caller。任何 postcommit 取消都可能已提交，必须重新读取并显式 reconcile。新回归实测 pending JSON 已落盘但取消丢失回执：原 DB 不变，普通读拒绝 metadata 版本差异，下一合法 caller 明确 reconcile 后记录 not-committed，二进制写次数没有增加。shutdown 清理失败不得释放 lease。

## 本切片检查

插件 `check:domain`（typecheck + build:check + **40 tests**）、单包真实 manifest 检查、manifest checker **24 tests**、host backend typecheck、改动文件 lint 均通过。完整插件 manifest 命令在本隔离树因 research-suite 的既有 bundled 子包缺失而失败，日志 `/tmp/inquiry-native-ui-manifests.log`；它不是整仓 PASS，整仓集成门禁由 root 的统一 cohort 执行。

## 未完成

1. 移走 backend `services/inquiry.ts` 的 canonical 事件投影/重跑组合并删除旧域写入 seam；Discovery/provider 消费接线。
2. 实际 rerun executor、workspace promotion 及完整领域 UI，不以当前明确 unavailable 文字替代功能。
3. 新候选正式 DMG GUI、最终零领域宿主和双仓库完整门禁。
4. 大于 4 MiB 的 DB 支持保持拒绝；knowledge index resource 的 Node SQLite 例外仍需独立迁移，普通 worker 防御不能代替资源隔离。
