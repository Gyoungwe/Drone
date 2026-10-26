# P2 知识只读共享 owner 验收

2026-10-26。状态：**双仓库门禁与真实 SDK 协调器验收通过；正式安装包回执补充中。P2 未完成。**

## 本片交付

知识包的原生 CLI 完整 owner 保留，新增 Desktop 只读适配：页面总览、搜索、刷新以及 `knowledge_status` / `knowledge_search` 共用同一领域后台与索引资源。宿主按安装包声明发现入口，不增加知识专用 IPC。UI v2 要求经过核验的已安装 runtime；旧宿主明确拒绝该版本。

领域后台不直接访问数据目录或网络。每次启用通过原生目录选择器批准一个状态目录和数据目录；通用文件能力只接受已批准的根句柄。索引资源在另一个受限进程中运行，只写宿主私有缓存。状态/文件路径引用不能自动扩大授权；停用撤销调用并等待真实进程退出，整个 owner 完成清理后释放写者租约。

真实会话提供不透明 `workspaceId`、保留实际大小写的 `workspaceDirectory` 与 session identity。路径仍需匹配已授权根；`workspaceDirectory` 本身不是授权。原实现误把规范化身份当路径，真实协调器测试在 macOS 临时路径上复现并修复。UI 索引变更通知现在会刷新总览并重新执行当前查询；新查询、绑定变化与会话变化撤销旧重搜。

## 固定候选（未发布）

插件源码提交 `3f668f6`。插件仓库完整 `DRONE_PLUGIN_API_TARBALL=… npm run check` 通过，其中知识包 69 个测试文件、439 项测试。该候选使用本地 API 1.3.0 tarball；不是公开 npm 干净安装通过的声明。

| 包 | 候选版本 | tarball SHA-256 |
| --- | --- | --- |
| `@gyoungwe/pi-knowledge` | 0.3.0 | `352444917a449186596af586664d2e00c2acb317126171e7ffa7c0183e020005` |
| `@gyoungwe/desktop-ui-pack` | 0.3.0 | `557cbd5ab4e9f6ec855e15cad90fb607639f88a13fc6e0bcc2af9bbc9a1b762e` |
| `@gyoungwe/research-suite` | 0.2.0 | `8aec32de50debacc976a65c0c768d3f59c69f3f53dfc0d5720e2336e27f30d2a` |

插件完整检查日志 SHA-256：`ea0f31133d656f9a21975fd239f53a60ad816f70c0d15f4b76a5f5cd47797999`。候选资源文件、源指纹和 integrity 另见插件仓库 `docs/knowledge-ui-co-package-2026-10-26.json`。

## 宿主检查与真实会话

宿主完整 lint/typecheck/test/build/check:arch 通过，backend 1,988 项、desktop 878 项测试通过；未配置的外部/显式 artifact 测试仍明确跳过。末尾将会话通知的旧空 catch 改为诊断日志后，补跑 lint、backend typecheck、4 项真实 SDK 会话回归和 Desktop 构建，全部通过。已有大 HTML 文件大小警告保留。架构检查零基线违规，不等于本目标领域耦合已清零。

[独立 artifact 验收](packed-knowledge-runtime-acceptance.md)使用上述 tarball、真实 SDK 1.1.0 与 SessionRegistry 只读会话：两个知识工具成功、UI 与工具搜索一致、选择会话后刷新成功；未知和 write effect 的控制工具被拒绝且执行数为 0；两进程复用且退出后租约为空。成功回执 SHA-256：`6f149b289a5631c991d086742e4ad0dc299115c81c80d48606a67c2e9c92b5a8`。

API 候选 tarball SHA-256：`da1ce7c766ae62045ed757f9d0120428a7385e599452d9919cceb7ee014b76a0`。严格类型复核 `skipLibCheck:false`：未安装 Pi SDK 的根/UI/runtime consumer 通过；native consumer 使用 SDK 1.1.0 和其实际可选 MCP peer 通过。API 门禁只允许 native.d.ts 的官方 ExtensionFactory 类型引用，拒绝运行时引用及其他子路径的 SDK 引用。API 本地安装/升级/回滚/卸载门禁通过；这不表示 npm 已发布。

## 边界和未完成项

- Desktop 此片只有两项只读工具与只读页面；完整阅读/出版证明、审阅、维护、发现、写入、模型服务和研究 hooks 尚未完成迁移。
- 宿主仍装配旧知识领域实现。旧 0.2.1 的研究 hook 不参加新写者租约协议；已有绑定用户可能形成两套 owner。此片正式 GUI 使用新隔离 profile、空的旧状态目录及显式批准的合成数据，保留原内置扩展，不作为已有绑定用户升级或完整 P2 PASS。
- API 根/UI/runtime 入口不依赖官方 SDK；仅 `native` 的类型入口引用官方 `ExtensionFactory`。严格类型消费检查保留官方 SDK 可选 MCP 类型依赖缺失的原始失败及补齐官方可选 peer 后的结果。
- 候选 API 1.3.0 尚未公开。正式发布前需先发布 API，再提升消费者最低版本并重新做公共注册表安装验收。
- P2 删除宿主知识业务装配/具名 API、P3–P7、完整不可变包及依赖安装代次仍未完成。旧四项外部验收与暂缓事项状态不变。
