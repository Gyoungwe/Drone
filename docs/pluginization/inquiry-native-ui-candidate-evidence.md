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

## 后继：事件 projector 与真实 Discovery 消费

插件 `241e4e0` 只提取原 compute/task/local/decision 的 canonical event→ledger 算法，42 个领域测试包含 Memory/WASM SQLite 同结果对照；尚未将旧 host 自动订阅移到插件。`994abc6` 为 Discovery 声明可选 `inquiry.runtime@1`，新增写工具 `discovery_record_inquiry`，经 actual caller 的 generic provider 把 question/attempt/finding 写入已经绑定的原始 Inquiry 项目；项目映射只是领域数据，不是身份或权限。Discovery 单包 type/build:check、20 tests、clean install smoke 通过 `/tmp/discovery-inquiry-final-check-2.log`。

实际 Discovery tar `/tmp/discovery-inquiry-provider-final-20261029/gyoungwe-pi-discovery-0.2.0.tgz` SHA256 `621c68937de14371de976ed44e353b5a9d9ac8f83122b5189b2cf27acb9ea646`，搭配上面的同一个 Inquiry tar 与 e41 API。`packed-discovery-inquiry-sdk.test.ts` 用生产 manager/factory、两个 SDK 和安装 Inquiry UI 完成真实跨 provider 写入、页面事件与另一个 SDK 回读。把合成安装目录中的 Inquiry 包移出并 production scanAll 后，原会话真实 reload 的调用得到 unavailable，原 DB 字节不变；移回同包/scan/reload 后读回同原库，后续新批准写入重新持有排他租约。日志 `/tmp/discovery-inquiry-recovery-sdk.log` **1/1 PASS**。同新 Discovery tar 的原生只读回归另已通过 `/tmp/discovery-inquiry-final-sdk.log` 中的对应测试；该日志的早期 lease 断言失败也保留，不将总日志报告全通过。

明确区分：UI config 开关只影响页面，不等于整包停用。当前没有完成公开的包启停控制口；本切片只证明**来源撤销/恢复**，不报包开关 PASS。读 owner 本身不取得写者租约，只有实际写入前 reserve；恢复后的排他证明来自新批准写入，不能把只读恢复叫写租约恢复。标准 Pi 跨包服务 transport、无 live caller 的自动 compute/task/rerun provenance 与原宿主 seam 删除仍未完成，后继必须保留自动能力与私有来源/已批准记录范围，不能永久降为手工导入。
