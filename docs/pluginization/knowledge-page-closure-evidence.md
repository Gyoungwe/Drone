# 知识整页与原生任务回读收口

用户确认采用方案 1：完整知识产品 UI 属于插件；宿主在缺插件、停用或渲染故障时保留绑定状态、打开文件夹及插件管理入口。候选版本与公开 npm 版本分别记录，机器回执见 [本轮证据](../releases/knowledge-page-closure-2026-10-25.json)。

## 实现与边界

- 插件仓库通过非 squash subtree 保留 46 个源文件历史（结构提交 `3d6d33b`），随后调整公开端口和组件行为。页面、笔记阅读、图谱、审阅、设置、Zotero/机构嵌入面板、文案和样式均由插件维护；宿主删除完整产品 UI 副本及其直接图谱依赖。
- 新增有限的 `KnowledgeUiPort`，56 个方法及所需 wire 类型由固定清单生成；公开 store/组件合同、renderer host API、声明、shim 与资源清单同步。新增 `knowledge.surface` 承载嵌入入口；整页仍保留第三方 `knowledge.tab`。没有向插件暴露整个 preload/backend。
- 无插件宿主继续接收知识事件。异步旧 Vault 回包不会覆盖新上下文；插件故障/停用后可恢复。写入、路径检查和权限继续由现有宿主服务执行。
- `pi-core` 按所属 event bus 与当前会话处理文件回读，只复用已批准任务的输出范围。跨会话、无 UI、拒绝、撤销、符号链接和会话切换期间的请求均不放行；Desktop 继续使用既有权限引擎，没有 process 全局账本。
- 正式包验收发现并修复 CSS 污染：主题 token 改为引用宿主值，Tailwind 属性注册与 layer 使用插件专属名字。真实 Chromium 浅/深色 computed-style 回归覆盖宿主布局与启停后的恢复。

## 验证

宿主从干净 `npm ci` 开始完成 lint、typecheck、test、build、check:arch、plugin-api migration/lifecycle、strict extensions、upgrade、Pi locked/latest、公开插件宿主和 UI evidence 检查。插件完成默认 `npm ci`、完整 `npm run check`、51 项产品 UI 回归、干净 pack/install/React shim 加载；组件冒烟另覆盖无插件 4 组和插件产品 30 项。组件、fixture 与 loader 结果不冒充正式 GUI。

最终 suite 候选在真实 Pi 1.1.0 / 1.4.0 `AgentSession` 中分别完成 13 次实际工具调用：批准前阻断 → 一次原生任务批准 → 两源阅读 → 带来源回答 → 候选笔记写后回读 → 交付文件读取 → `task_reconcile: completed`。使用离线脚本模型和合成数据，只证明执行、授权及回执链路，不代表在线模型或科学结论质量通过。

macOS arm64 使用本地 unsigned/adhoc DMG，实际挂载、安装、脱离镜像后启动；不是开发服务器。总览、分类、搜索、笔记行号/哈希、6 节点 2 条边图谱、设置、项目切换和插件停用/重启/恢复均通过实际交互。通过公开运行时生成的合成候选在 GUI 完成差异与来源阅读、勾选、应用和写后 `applied` 回读，已应用候选不能重复提交；原 20 个 Markdown 哈希不变，仅新增两份合成文件。渲染崩溃和第三方页签路由由回归覆盖，未在正式 GUI 注入故障。截图哈希和安装包哈希以机器回执为准。私有原始日志、截图与合成 Vault 保存在本机 `.local/acceptance/`，不提交正文或本机配置。

## 合并后验证

两实现分支已快进合入各自 main 并推送，fetch 后远端 SHA 与本地一致；干净工作区复跑跨仓库 migration/lifecycle 通过，保留迁移历史；本次验证基线为 Drone `f743b41ee64d2a8499332db59d70358ebcd802f4` / drone-plugins `118a01313f7c4bdc9607f4bbff6dae880e75a640`。使用隔离 HOME 和 npm 配置，不设置 `DRONE_PLUGINS_DIR`，通过相邻插件仓库绑定重跑宿主 12 项门禁，以及插件 `npm ci`、完整 `npm run check`。额外浏览器样式检查使用独立临时 profile；精简环境下 Chrome 两次在退出阶段崩溃，恢复桌面环境后相同脚本与浏览器通过，未绕过退出码或断言。命令、退出码和日志摘要保存在机器回执 `implementationMainIntegration`。

插件第一次空缓存安装发现锁文件仍记录较早 API 候选的 integrity，而已提交 tarball 与公开证据 SHA-256 一致；修正锁校验值后独立安装及完整检查通过。未改候选包字节或产品源码。此前缓存下的安装结果不能作为可复现干净安装证明，本次结果替代该项。正式 DMG GUI 和双 SDK 完整流程沿用前轮相同产品源码的真实回执，本次未重新执行 GUI；合并与门禁不表示四个候选版本已发布。

## 仍未完成

候选 `plugin-api@1.2.0`、`pi-core@0.1.9`、`research-suite@0.1.11`、`desktop-ui-pack@0.2.0` 尚未发布 npm，需另行按精确版本发布并验证公开包。公开 suite 0.1.10 仍不含原生回读修复。Zotero 云端、用户自有认证 MCP、Protocols.io 写入、其他平台实机、在线科学质量及 PDF Canvas 警告调查保持原状态。MinerU/GROBID 和 B8/B8-2 继续暂缓。
