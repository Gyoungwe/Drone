# P2 知识设置与修复后的正式安装包验收

2026-10-26 状态：**PASS_SCOPED**。本轮正式 DMG 覆盖审核策略设置、实际模型工具、停用恢复与正常退出，不代表完整 P2 或 P0–P7 完成。旧四项外部验收和暂缓项不变。

## 固定产物

| 项目 | 身份 |
| --- | --- |
| 宿主源码与生成扩展 | `ad3cd189901c602e5fd1aa2a3b69108fcf19ff3a` |
| 插件源码 | `905cd2ddf27da6097c6e2c39a9cf406855b3d381` |
| DMG SHA256 | `c0856d7cd105b002e5c61c76d12a27925ee56b5a57ce01f89e4b5a19163f055a` |
| 安装后 app.asar SHA256 | `576661ae6bd0a1f841d63be91c50c48e7b17e8ebc080ec38ba95e327170a960f` |
| pi-knowledge 0.3.0 候选 tarball SHA256 | `68012bd78a3b5fba644afd1ecef6f73401d0f64f4536fae9ad15a20639cbb6b3` |

这是从只读挂载 DMG 复制后启动的 macOS arm64 安装包，采用独立 profile、合成 Vault/项目和本机离线模型 HTTP 服务。模型通过真实 SDK 会话请求工具；结论依据持久化会话 toolResult，不依据离线模型的摘要文字。候选未发布到 npm，没有更新公开版本或远端 main。

## 已验证行为

1. 启动重新授权独立状态 JSON 读写目录和两个只读数据根；知识页显示全库索引 4 篇、alpha 可见 3 篇，beta 不在当前列表。
2. 设置初始为默认自动。拒绝 `setReviewPolicy` 后界面显示拒绝，磁盘只保留 binding.json，没有生成 review-policy.json。
3. 同意本次操作和 `state.writeJson` 后，界面“当前生效/已保存”均为严格。磁盘回读为 `{"version":1,"mode":"strict"}`，SHA256 `c4f5271a63c41cb60059d30d08e9d80238ce5426890b3659b40632bc5f71d4fc`。
4. 新建真实会话调用 knowledge_status 和 knowledge_search；两个持久化 toolResult 均 `isError:false`，status 课题 alpha，search 返回 alpha/shared 三条。任务守卫修复在正式安装包生效。
5. 知识 UI 插件停用后，系统进程列表中该领域与资源 worker 为零，知识页显示宿主回退页。
6. 重新启用时重新选择同一状态与只读目录，原生选择器可正常提交；插件恢复，已保存严格策略仍存在。上一轮目录提交不可用没有在本轮重现，不声称已定位其根因。
7. 有已打开会话与活跃知识后台时按 Cmd+Q，一次正常退出。日志依次记录 runtime closed、backend disposed、watchers closed、final quit、will-quit(closed)，系统回读主进程和所有该安装包子进程均消失。没有强杀或第二次退出。本轮没有额外声称模型请求进行中退出。

## 门禁与原始记录

宿主 lint/typecheck/test/build/check:arch 全通过，使用 plugins.lock.json 锁定依赖、未设置 DRONE_PLUGINS_DIR；backend 1998 passed/18 skipped、desktop 887 passed。打包前扩展检查发现生成文件过期，使用 build:extensions -- --force 重建后独立 check-extensions-build 通过，生成产物提交 ad3cd189；beforePack 的锁定包和科研资源检查通过。插件候选全仓 check 75 文件/463 测试与 UI 17 文件/77 测试见插件仓库 `docs/native-knowledge-state-2026-10-26.md`。

早先错误地向宿主完整门禁传入候选源码 DRONE_PLUGINS_DIR，导致 fetch:plugins 重装旧 API 并失败；该失败保留，不算 PASS。修正为锁定依赖门禁后全通过；候选只在隔离安装与 opt-in 会话中消费。

原始 GUI、安装、进程、日志及合成会话回执保存在忽略的 `.local/acceptance/native-plugin-knowledge-state-gui-2026-10-26/`，manifest SHA256 `93d9acf9091c8cb341222b20c9952b3ac70e0de164784f2d15b3573372face0c`。仓库不提交 Vault/会话正文或本机状态。完整原始会话与 trace 回执分开保存，正式结论使用排除 traces 目录后的实际会话文件。

## 保留缺口

- [上一轮阅读 GUI](native-plugin-knowledge-reading-gui-evidence.md)的历史失败保留；阅读分页、链接、图谱的完整交互证据仍属于那一轮。本轮是其工具与恢复/退出修复复验。
- 首次 SDK reading cleanup AggregateError 仍为 UNRESOLVED_NOT_REPRODUCED，压力回归通过不等于根因已定位。
- 完整知识服务、原生 hooks/发布证明、绑定初始化/切换、实际审核写操作与旧宿主领域代码删除仍未完成。
- 2405d2d2 的新 activation 资源关闭合同是在本安装包固定后实现，不包含在此 DMG，需下一轮集成门禁及实际包验证。
- 同一路径覆盖包的不可变安装代次、零领域插件宿主、P3–P7 仍待实现。设置 UI 的双层操作/能力授权仍按当前合同逐次显示，没有绕过或缓存授权。
