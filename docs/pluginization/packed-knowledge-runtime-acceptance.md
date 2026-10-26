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
- 接入生产 `CapabilityRuntime`，激活知识分类后断言插件工具实际进入 active tools；工具分类元数据不能替代 broker 的 effect 授权。
- 创建真实 SDK `AgentSession`，先把实际条目加入 `SessionRegistry`，设置 `readOnly: true`，再绑定 native bootstrap。faux model 实际调度 `knowledge_status`、`knowledge_search`，结果与 UI search 一致。
- 独立的合成控制包在同一真实只读会话里注册显式 write 和未声明 effect 的工具，两者都被拒绝，工具执行计数保持 0；未注册 UI operation 同样拒绝。控制包不修改知识 tarball。
- 知识包始终只有同一个领域进程和同一个索引 resource 进程；native 加入及搜索期间 PID 保持一致。控制包自己的进程单独清点。
- 选中真实会话后，UI search 使用可信 `workspaceDirectory`；新增合成方法笔记后可刷新读取。会话身份 `workspaceId` 不能当文件路径。
- 阅读切片使用共享、当前 alpha 课题和 beta 课题三类合成笔记：应用范围只返回共享列表，真实会话范围只返回共享与当前课题；覆盖 `readNote`、`links`、`graph`、`jobs`、`recentByCategory` 的输入及结果 schema。额外输入 project 不能伪造调用身份。
- 跨课题直接读取/链路请求拒绝，图谱、出反链、类别数量和任务分页不包含 beta 内容；读取分页核对文件 SHA256、精确行号和片段，源文件改变后旧 hash 明确拒绝。应用 → 会话 → 应用切换重新验证隔离，旧 selection lease 不可复用。
- `overview.index.noteCount` 是整个已批准 Vault 的索引维护统计；可见笔记数量使用 `recentByCategory.counts` 和 `graph.totalNotes`，不把索引总数标作当前课题笔记数。
- 撤销会话、关闭 SDK、释放 native/UI leases 后，两个知识进程和控制进程均已退出，writer reservation 目录为空。回执记录实际 tarball SHA256、包版本和 SDK 版本。

## 已发现并修复的缺口

旧候选 `72806395cf50f5de3d91f13d902d340f058cdf9b39a4e435f0394a9e034caa48` 在实际会话选中后的 UI 刷新失败：macOS 的 canonical workspace identity 被规范化为小写，而插件将该 identity 当真实目录传入 `roots.resolve`。正式授权的目录仍保留大小写，因此正确拒绝了不匹配路径。失败记录保留在本机 `.local/acceptance/native-runtime-packed-2026-10-26/before-directory-fix.json.failure.json`。

修复为候选 scope 明确区分 `workspaceId` 与 `workspaceDirectory`：前者仅作身份匹配，后者来自实际会话条目的目录。插件使用 directory 请求已批准 root；没有通过小写比较扩大文件授权，也没有兼容回退。最终运行的候选指纹及结果以生成回执为准。

## 2026-10-26 初始只读切片回执

使用候选 `@gyoungwe/pi-knowledge@0.3.0`（SHA256 `352444917a449186596af586664d2e00c2acb317126171e7ffa7c0183e020005`）运行上述入口：1 个实际 SDK 测试通过，退出码 0。实际只读会话的两个知识工具成功；显式 write / 未声明 effect 控制工具都被拒绝且执行次数为 0；UI 与 native 搜索一致，选中会话后的刷新通过。领域和索引进程分别为 52932 / 52934，调用期间保持不变，关闭后均已退出，reservation 已释放。

本机 JSON 回执为 `.local/acceptance/native-runtime-packed-2026-10-26/final-coordinator.json`，SHA256 `6f149b289a5631c991d086742e4ad0dc299115c81c80d48606a67c2e9c92b5a8`；同目录 `final-coordinator.log` 的 SHA256 为 `686ae2f44c7c0871f0ff4c9ab1231ee074202adbacce9d3e5267989d3a6aaf7c`。这条记录仅代表上述真实 SDK / 临时安装包切片；正式安装包 GUI 结果单独登记。

## 2026-10-26 五项阅读操作回执

候选 `@gyoungwe/pi-knowledge@0.3.0` 的 tarball SHA256 为 `f26ce487965dd5b96bbb8b08c99a07bf770baddcdee1d8ff046d771d26a9dd60`。以实际安装包运行上述扩展测试，连续两轮退出 0：共享范围为 1 条笔记 / 2 个待办，alpha 会话范围为 2 条笔记 / 4 个待办，切回应用后恢复共享范围。五项操作的 schema、图谱/链路/分类/待办隔离、读取分页 SHA256 和精确行号、源改变后拒绝旧 hash 均通过。生产 CapabilityRuntime 下两原生读工具实际可见且成功，伪报 readOnly 的未知/write effect 工具仍未执行。每轮同 owner 双进程实际退出，reservation 已释放。

本机证据目录为 `.local/acceptance/native-runtime-reading-2026-10-26/`。`coordinator.json` / `coordinator.log` 的 SHA256 分别为 `6a5c3dfb2e53c7f842a02fa45f4000522686a7365084b61efce9e4714bf065be` / `3ea445af5c3820ea42d56f0ec8615329ed0dfe0b1617f79032f363a23e4ea6bb`；第二轮 `coordinator-repeat.json` / `coordinator-repeat.log` 分别为 `7e98096dbb89144f1ed32ed09310f5d3a59042c9f76d8d8a1e70266f835f75b3` / `8286a2a6256ef88643de542202f227719c66e48713abc4e24a1b15df82204c1b`。

保留未定位观察：首轮于全部功能断言结束后出现 `Packed knowledge cleanup failed` AggregateError，测试框架未展开子错误。之后只给测试补充 `.cleanup-failure.txt` 详细诊断，同一 tarball 连续两轮通过，未修改生产关闭机制，也不将重跑成功称为已修复该异常。首轮原日志被重跑覆盖，现有 `first-cleanup-observation.json` 仅是根据当时工具输出整理的观察记录，不冒充原始日志。若再次发生，应按新增详细回执定位；正式安装包关闭验收单独记录。

针对该关闭观察，追加 **3 个并发独立安装/临时数据夹具 × 3 轮，共 9 次**同包验收，9/9 退出 0。测试现分开记录 SDK dispose、native bootstrap dispose、coordinator close、知识/控制进程清点、reservation 清点和目录清理；九次全部阶段 fulfilled。观测最大耗时分别为 2 / 0 / 10 / 67 / 73 / 1 / 79 毫秒，没有复现可供定位的子错误，不能据此声称首轮问题已经修复。

压力回执保存在上述目录的 `stress/`，每次独立 JSON/log，`run.py` 为本机复现入口；逐份指纹汇总 `manifest.json` 的 SHA256 为 `d71704868a045bb9496606c8f6967af79385a689ab3f8eebd63afc0bf5f6e3d5`。首轮观察状态继续为 `UNRESOLVED_NOT_REPRODUCED`，正式 GUI 退出回执仍由安装包验收给出。

## 能力失败的准确语义

插件必须 await capability 调用，并显式处理允许恢复的错误，例如可选项目配置文件的 `ENOENT`。outer operation 完成时，宿主等待仍在途的已接受能力调用，并把这些调用的失败纳入 outer 回执。已经 settled 的错误保留在各自返回 promise，插件可以明确恢复；宿主不宣称能跨 Promise / IPC 识别所有被忽略的 promise。回归同时覆盖在途失败与正常 catch 恢复。

## 不包含

这不是正式 DMG / GUI 验收，也不是完整知识领域迁移完成。完整原生 hooks、跨进程 publication proof、56 个旧 UI API 的剩余迁移以及真实 Vault 写入仍有后续工作。测试没有屏蔽既有内置研究 hooks；正式安装包验收还需使用旧绑定为空的新 profile，以免把候选只读包与旧 owner 的并存误报为完整替代。

后续正式 DMG 发现 native 注册运输丢失 `drone` 分类元数据，直接 SDK 验收没有覆盖生产能力筛选。已扩充同一测试先复现 active tools 缺少知识工具，再通过通用协议保留可选元数据修复；控制工具故意声明 readOnly，仍验证未知/write effect 不得绕过只读授权。初始正式 DMG 不据此记为完整工具 PASS。


## 2026-10-26 显式 JSON 状态写入回执

新设置候选 `@gyoungwe/pi-knowledge@0.3.0` 的 tarball SHA256 为 `68012bd78a3b5fba644afd1ecef6f73401d0f64f4536fae9ad15a20639cbb6b3`。同一实际 coordinator / 真实 Pi 1.1.0 只读 SDK 会话验收退出 0，仍覆盖前述五项阅读操作、跨课题隔离和同 owner 双进程。

新增 `preferences` / `setReviewPolicy` 切片：旧只读 state grant 拒写；显式 read-write grant 后仍需每次审批，审批拒绝不产生文件；严格模式写后从实际文件重新读取，原始字节 SHA256 与返回版本相符；旧预期版本明确拒绝且不覆盖；损坏文件显示严格模式和 `invalid-json`，保存不得覆盖它；停用旧 binding 被拒，重新启用读取到已保存设置；真实只读 SDK 会话中的写请求仍被 coordinator 拒绝。领域进程与索引进程最终退出，reservation 已释放。

回执为 `.local/acceptance/native-runtime-state-2026-10-26/coordinator.json`，SHA256 `d5e9f8fb49aa41b5dfe1591c43cd42d05d7423161fb7c8d4cd9eb5b6edaadb82`；同目录 `coordinator.log` SHA256 `31326dfa27cd127a7203e7b78fd3f0f1caa77062aedfa507dd265f2e15369b88`。宿主实际文件系统与 production picker/source 的 103 项聚焦测试见 `focused.log`，SHA256 `179516b402662aa00591ee3272f2e6ae67fec8c526c9cd5ecfad357758ff9b09`。状态能力的授权、原子写与并发范围见 [state capabilities](native-plugin-state-capabilities.md)。本测试使用明确的测试授权器，不能代替正式 GUI 目录选择与审批验收。

本轮两个非最终运行保留：`initial-test-assertion.log` 是旧验收断言未计入新增 `capability:state.writeJson` 审批而失败；`during-protocol-edit.log` 是并行修改 native events 协议期间两端瞬时不一致导致声明拒绝。协议冻结后上述完整验收通过，未为测试加入旧协议 fallback，也未修改候选 tarball。它们与上一轮尚未定位的 cleanup 观察是不同事件。
