# 知识候选包的原生 / UI 共同 owner 验收

这是 P2 只读切片的独立验收，不属于默认离线门禁。入口为 `packages/backend/test/packed-knowledge-runtime-sdk.test.mjs`；未设置 tarball 时明确跳过，不把跳过记作验收通过。测试使用临时合成 Vault、真实 Pi 1.1.0 SDK 会话和离线 faux provider，不使用个人模型账户或正式 Vault。

## 运行

先安装宿主依赖、构建本地 plugin-api，并准备 `packages/desktop/plugin-runtime/<platform>-<arch>` 的已校验 Node。当前进程清点使用 POSIX `ps`，不作为 Windows 验收。

```sh
DRONE_KNOWLEDGE_TARBALL=/absolute/path/pi-knowledge-0.3.0.tgz \
DRONE_KNOWLEDGE_EVIDENCE=.local/acceptance/packed-knowledge/result.json \
npx vitest run packages/backend/test/packed-knowledge-runtime-sdk.test.mjs
```

可通过 `DRONE_PLUGIN_RUNTIME_DIRECTORY` 指定另一份宿主已准备的 Node runtime 目录。脚本会使用公开 npm registry、`--ignore-scripts --omit=peer`，把传入 tarball 安装到独立临时前缀；实际会话使用宿主锁定的 SDK。安装前缀、合成状态及 Vault 在验收结束后清理。失败阶段写入同路径的 `.failure.json`，只有完整断言及清理都通过才写成功 JSON。

## 实际覆盖

- 从安装后的真实 `plugin.manifest.json` 解析 desktopRuntime、native extension 和 resource entrypoints；校验路径留在包内，并与官方 `package.json` 的 Pi extension 元数据一致。
- `PluginRuntimeBridge` 创建唯一应用 owner；文件和 resource ports 经真实逐调用 broker 授权。没有用静态 `broker.run` scope 代替 coordinator。
- 创建真实 SDK `AgentSession`，先把实际条目加入 `SessionRegistry`，设置 `readOnly: true`，再绑定 native bootstrap。faux model 实际调度 `knowledge_status`、`knowledge_search`，结果与 UI search 一致。
- 独立的合成控制包在同一真实只读会话里注册显式 write 和未声明 effect 的工具，两者都被拒绝，工具执行计数保持 0；未注册 UI operation 同样拒绝。控制包不修改知识 tarball。
- 知识包始终只有同一个领域进程和同一个索引 resource 进程；native 加入及搜索期间 PID 保持一致。控制包自己的进程单独清点。
- 选中真实会话后，UI search 使用可信 `workspaceDirectory`；新增第二条合成方法笔记后可刷新读取。会话身份 `workspaceId` 不能当文件路径。
- 撤销会话、关闭 SDK、释放 native/UI leases 后，两个知识进程和控制进程均已退出，writer reservation 目录为空。回执记录实际 tarball SHA256、包版本和 SDK 版本。

## 已发现并修复的缺口

旧候选 `72806395cf50f5de3d91f13d902d340f058cdf9b39a4e435f0394a9e034caa48` 在实际会话选中后的 UI 刷新失败：macOS 的 canonical workspace identity 被规范化为小写，而插件将该 identity 当真实目录传入 `roots.resolve`。正式授权的目录仍保留大小写，因此正确拒绝了不匹配路径。失败记录保留在本机 `.local/acceptance/native-runtime-packed-2026-10-26/before-directory-fix.json.failure.json`。

修复为候选 scope 明确区分 `workspaceId` 与 `workspaceDirectory`：前者仅作身份匹配，后者来自实际会话条目的目录。插件使用 directory 请求已批准 root；没有通过小写比较扩大文件授权，也没有兼容回退。最终运行的候选指纹及结果以生成回执为准。

## 2026-10-26 最终独立回执

使用候选 `@gyoungwe/pi-knowledge@0.3.0`（SHA256 `352444917a449186596af586664d2e00c2acb317126171e7ffa7c0183e020005`）运行上述入口：1 个实际 SDK 测试通过，退出码 0。实际只读会话的两个知识工具成功；显式 write / 未声明 effect 控制工具都被拒绝且执行次数为 0；UI 与 native 搜索一致，选中会话后的刷新通过。领域和索引进程分别为 52932 / 52934，调用期间保持不变，关闭后均已退出，reservation 已释放。

本机 JSON 回执为 `.local/acceptance/native-runtime-packed-2026-10-26/final-coordinator.json`，SHA256 `6f149b289a5631c991d086742e4ad0dc299115c81c80d48606a67c2e9c92b5a8`；同目录 `final-coordinator.log` 的 SHA256 为 `686ae2f44c7c0871f0ff4c9ab1231ee074202adbacce9d3e5267989d3a6aaf7c`。这条记录仅代表上述真实 SDK / 临时安装包切片；正式安装包 GUI 结果单独登记。

## 能力失败的准确语义

插件必须 await capability 调用，并显式处理允许恢复的错误，例如可选项目配置文件的 `ENOENT`。outer operation 完成时，宿主等待仍在途的已接受能力调用，并把这些调用的失败纳入 outer 回执。已经 settled 的错误保留在各自返回 promise，插件可以明确恢复；宿主不宣称能跨 Promise / IPC 识别所有被忽略的 promise。回归同时覆盖在途失败与正常 catch 恢复。

## 不包含

这不是正式 DMG / GUI 验收，也不是完整知识领域迁移完成。完整原生 hooks、跨进程 publication proof、56 个旧 UI API 的剩余迁移以及真实 Vault 写入仍有后续工作。测试没有屏蔽既有内置研究 hooks；正式安装包验收还需使用旧绑定为空的新 profile，以免把候选只读包与旧 owner 的并存误报为完整替代。
